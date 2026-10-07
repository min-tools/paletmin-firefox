// Stores each tab's mode and updates the toolbar icon. Calls the controller
// in page.js; content.js restores saved modes and reports Firefox's page scheme.
// The SVG icons adapt to the toolbar's scheme independently.

const TITLES = {
  auto: 'Auto palette',
  dark: 'Dark palette',
  light: 'Light palette',
};
const PAGE_TITLES = {
  reload: 'Reload this page to enable palette switching',
  unavailable: 'Palette switching is unavailable on this page',
};

let queue = Promise.resolve();
const connecting = new Map(); // Share an in-flight connection for each tab.
let initialization;

// serial(task)
// Run a task after earlier tasks finish. This prevents rapid clicks and
// messages from interleaving storage operations. Log failures without
// blocking the queue.
function serial(task) {
  const result = queue.then(task);
  queue = result.catch((err) => console.error(err));
  return result;
}

// load()
// Read the cached page scheme, modes, and toolbar states. Session storage
// preserves tab state across background restarts and clears it on browser exit.
async function load() {
  const [{ scheme = 'light' }, { modes = {}, pages = {} }] = await Promise.all([
    browser.storage.local.get('scheme'),
    browser.storage.session.get(['modes', 'pages']),
  ]);
  return { scheme, modes, pages };
}

// nextMode(mode, scheme)
// Put the scheme opposite Firefox's first so the first click changes the page.
function nextMode(mode, scheme) {
  const other = scheme === 'dark' ? 'light' : 'dark';
  return { auto: other, [other]: scheme, [scheme]: 'auto' }[mode];
}

// paint(mode, [tabId], [page])
// Enable only connected pages. Other pages get a slashed A and a reason.
// Without tabId, set the default for tabs that have not reported readiness.
function paint(mode, tabId, page = 'unavailable') {
  const ready = page === 'ready';
  const icon = (size) => `icons/${ready ? mode : 'unavailable'}-${size}.svg`;
  return Promise.all([
    browser.action.setIcon({ tabId, path: { 16: icon(16), 32: icon(32) } }),
    browser.action.setTitle({ tabId, title: ready ? TITLES[mode] : PAGE_TITLES[page] }),
    ready ? browser.action.enable(tabId) : browser.action.disable(tabId),
  ]);
}

// setPage(tabId, page)
// Remember readiness without storing URLs or page content, then repaint.
async function setPage(tabId, page) {
  const { modes, pages } = await load();
  pages[tabId] = page;
  await browser.storage.session.set({ pages });
  await paint(modes[tabId] ?? 'auto', tabId, page).catch(() => {});
}

// setMode(tabId, mode)
// Save a tab's mode and repaint its icon. Do not store Auto tabs.
async function setMode(tabId, mode) {
  const { modes, pages } = await load();
  if (mode === 'auto') delete modes[tabId];
  else modes[tabId] = mode;
  await browser.storage.session.set({ modes });
  await paint(mode, tabId, pages[tabId]).catch(() => {}); // The tab may have closed.
}

// setScheme(scheme)
// Cache the last reported native scheme. Ignore invalid values; toolbar clicks
// ask the active page directly so another tab cannot change their cycle order.
async function setScheme(scheme) {
  if (scheme !== 'dark' && scheme !== 'light') return;
  const { scheme: previous } = await browser.storage.local.get('scheme');
  if (previous === scheme) return;
  await browser.storage.local.set({ scheme });
}

// restore()
// Restore both enabled and disabled toolbar states after a background restart.
async function restore() {
  const { modes, pages } = await load();
  const tabs = await browser.tabs.query({});
  await paint('auto');
  await Promise.all(tabs.map((tab) =>
    paint(modes[tab.id] ?? 'auto', tab.id, pages[tab.id]).catch(() => {})));
}

// runController(tabId, [mode])
// Check the top frame's controller, or apply a mode in all accessible frames.
// Require the top frame to finish successfully; an iframe cannot confirm for it.
async function runController(tabId, mode) {
  const frames = await browser.scripting.executeScript({
    target: mode ? { tabId, allFrames: true } : { tabId, frameIds: [0] },
    world: 'MAIN', injectImmediately: true,
    func: (next) => {
      const controller = window[Symbol.for('tools.min.paletmin.palette-toggle')];
      if (typeof controller !== 'function') return false;
      // Older copies may have been installed after page scripts ran. They
      // cannot prove readiness until a fresh document_start injection occurs.
      if (!document[Symbol.for('tools.min.paletmin.document-ready')]) return false;
      // A readiness check must not reset the page or notify its listeners.
      if (next !== null) controller(next);
      return true;
    },
    args: [mode ?? null],
  });
  return frames.some((frame) =>
    frame.frameId === 0 && !frame.error && frame.result === true);
}

// ensureContent(tabId)
// Reconnect a relay only when a page controller already exists. Never install
// page.js late: it would miss the site's existing media-query listeners.
// An accessible page without a controller needs a full reload or navigation.
function ensureContent(tabId) {
  if (connecting.has(tabId)) return connecting.get(tabId);
  const probe = async () => {
    const reply = await browser.tabs.sendMessage(tabId, { type: 'probe' }, { frameId: 0 });
    if (!['dark', 'light'].includes(reply?.scheme)) {
      throw new Error('The page relay is unavailable');
    }
    return { page: 'ready', scheme: reply.scheme };
  };
  const connection = (async () => {
    // A successful injection with no controller means the site predates us.
    // Rejected injections instead mean a restricted page or denied access.
    if (!await runController(tabId)) return { page: 'reload' };
    try {
      return await probe();
    } catch {
      // Extension reloads discard relays but leave the page controller intact.
    }

    // Restore the relay without replacing the persistent controller or its
    // tracked query lists. Require the top frame, not an iframe's success.
    const relays = await browser.scripting.executeScript({
      target: { tabId, allFrames: true }, files: ['content.js'], injectImmediately: true,
    });
    if (!relays.some((frame) => frame.frameId === 0 && !frame.error)) {
      throw new Error('Cannot connect to this page');
    }
    // A navigation during injection may have replaced the checked document.
    if (!await runController(tabId)) return { page: 'reload' };
    return probe();
  })().catch(() => ({ page: 'unavailable' }))
    .finally(() => connecting.delete(tabId));
  connecting.set(tabId, connection);
  return connection;
}

// initialize()
// Classify open tabs once per extension session, including after re-enable.
// Old pages stay disabled until a manifest-injected controller is available.
// Do not reset their readiness when the event page merely wakes from sleep.
function initialize() {
  initialization ??= serial(restore).then(async () => {
    const { initialized } = await browser.storage.session.get('initialized');
    if (initialized) return;
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map((tab) => serial(() => refreshPage(tab.id))));
    await serial(() => browser.storage.session.set({ initialized: true }));
  }).catch((err) => {
    initialization = undefined;
    throw err;
  });
  return initialization;
}

// refreshPage(tabId)
// Inspect the current document, not the navigation status or URL. Hash changes
// and SPA loading events must not enable a page that still needs a reload.
async function refreshPage(tabId) {
  const { page } = await ensureContent(tabId);
  await setPage(tabId, page);
}

// handleClick(tab)
// Move the clicked tab to its next mode. Shortcuts use the same listener.
function handleClick(tab) {
  return serial(async () => {
    let mode = 'auto';
    try {
      // Recheck access even when an already-queued click races navigation.
      const { scheme, page } = await ensureContent(tab.id);
      await setPage(tab.id, page);
      if (page !== 'ready') return;
      const { modes } = await load();
      mode = nextMode(modes[tab.id] ?? 'auto', scheme);
      // Confirm the controller finished before saving the mode or icon.
      if (!await runController(tab.id, mode)) {
        throw new Error('Could not apply the palette to this page');
      }
    } catch (err) {
      // Do not show success when the page controller could not finish.
      console.warn(`Tab ${tab.id}: ${err.message}`);
      mode = 'auto';
      // Restore any frames that changed before the top frame failed.
      await runController(tab.id, 'auto').catch(() => {});
      await setPage(tab.id, 'unavailable');
    }
    await setMode(tab.id, mode);
  });
}
browser.action.onClicked.addListener(handleClick);

// Forget a closed tab before Firefox reuses its ID.
browser.tabs.onRemoved.addListener((tabId) => serial(async () => {
  const { modes, pages } = await load();
  delete modes[tabId];
  delete pages[tabId];
  await browser.storage.session.set({ modes, pages });
}));

// New protected tabs never send a content-script message. Classify them too.
browser.tabs.onCreated.addListener((tab) => serial(() => refreshPage(tab.id)));

// Firefox resets toolbar properties on navigation. A top-frame ready message
// enables ordinary pages early; completion also catches restricted pages.
browser.tabs.onUpdated.addListener((tabId, { status }) => {
  if (!status) return;
  serial(async () => {
    if (status === 'complete') {
      await refreshPage(tabId);
    } else {
      const { modes, pages } = await load();
      await paint(modes[tabId] ?? 'auto', tabId, pages[tabId]).catch(() => {});
    }
  });
});

// Return a promise for a loading frame so Firefox keeps the response channel
// open until its mode is ready. Ignore messages from other extensions.
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id) return;

  // Update the cycle order when Firefox's page scheme changes.
  if (message.type === 'scheme') {
    return serial(() => setScheme(message.scheme));
  }

  // Only the top frame can enable its tab. An iframe reloading is not enough
  // to clear the top page's reload-required state.
  if (message.type === 'get') {
    return serial(async () => {
      await setScheme(message.scheme);
      const { modes } = await load();
      const tabId = sender.tab?.id;
      const mode = modes[tabId] ?? 'auto';
      if (tabId !== undefined && sender.frameId === 0) await refreshPage(tabId);
      return { mode };
    });
  }
});

// onInstalled does not cover re-enabling. The top-level call covers that path
// too; the session marker avoids reinjection after ordinary event-page wakes.
browser.runtime.onStartup.addListener(() => initialize().catch(console.error));
browser.runtime.onInstalled.addListener(() => initialize().catch(console.error));
initialize().catch(console.error);
