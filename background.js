// Stores each tab's mode and updates the toolbar icon. content.js and
// page.js apply the override inside each tab and report Firefox's page scheme.
// The SVG icons adapt to the toolbar's scheme independently.

const TITLES = {
  auto: 'Auto palette',
  dark: 'Dark palette',
  light: 'Light palette',
};

let queue = Promise.resolve();

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
// Read Firefox's page scheme and the saved per-tab modes. Local storage
// preserves the scheme across browser restarts. Session storage preserves
// modes across background restarts and clears them when Firefox quits.
async function load() {
  const [{ scheme = 'light' }, { modes = {} }] = await Promise.all([
    browser.storage.local.get('scheme'),
    browser.storage.session.get('modes'),
  ]);
  return { scheme, modes };
}

// nextMode(mode, scheme)
// Put the scheme opposite Firefox's first so the first click changes the page.
function nextMode(mode, scheme) {
  const other = scheme === 'dark' ? 'light' : 'dark';
  return { auto: other, [other]: scheme, [scheme]: 'auto' }[mode];
}

// paint(mode, [tabId])
// Show a mode's icon and tooltip for one tab, or set the default when tabId
// is omitted. Each SVG contains the original light and dark glyphs; Firefox
// selects the one that matches its toolbar.
function paint(mode, tabId) {
  const icon = (size) => `icons/${mode}-${size}.svg`;
  return Promise.all([
    browser.action.setIcon({ tabId, path: { 16: icon(16), 32: icon(32) } }),
    browser.action.setTitle({ tabId, title: TITLES[mode] }),
  ]);
}

// setMode(tabId, mode)
// Save a tab's mode and repaint its icon. Do not store Auto tabs.
async function setMode(tabId, mode) {
  const { modes } = await load();
  if (mode === 'auto') delete modes[tabId];
  else modes[tabId] = mode;
  await browser.storage.session.set({ modes });
  await paint(mode, tabId).catch(() => {}); // The tab may have closed.
}

// setScheme(scheme)
// Store a page's native scheme for the next click's cycle order.
// Ignore invalid values.
async function setScheme(scheme) {
  if (scheme !== 'dark' && scheme !== 'light') return;
  const { scheme: previous } = await browser.storage.local.get('scheme');
  if (previous === scheme) return;
  await browser.storage.local.set({ scheme });
}

// restore()
// Repaint existing tabs after the background starts. The default SVG already
// follows the toolbar, including on protected pages.
async function restore() {
  const { modes } = await load();
  const tabs = await browser.tabs.query({});
  await paint('auto');
  await Promise.all(tabs.map((tab) =>
    paint(modes[tab.id] ?? 'auto', tab.id).catch(() => {})));
}

// handleClick(tab)
// Move the clicked tab to its next mode. Shortcuts use the same listener.
function handleClick(tab) {
  return serial(async () => {
    const { scheme, modes } = await load();
    let mode = nextMode(modes[tab.id] ?? 'auto', scheme);
    try {
      // Apply the mode in every frame that has a content script.
      await browser.tabs.sendMessage(tab.id, { type: 'set', mode });
    } catch (err) {
      // Protected pages, such as about: pages and Mozilla Add-ons, cannot run
      // content scripts. Keep their mode on Auto.
      console.warn(`Tab ${tab.id}: ${err.message}`);
      mode = 'auto';
    }
    await setMode(tab.id, mode);
  });
}
browser.action.onClicked.addListener(handleClick);

// Forget a closed tab before Firefox reuses its ID.
browser.tabs.onRemoved.addListener((tabId) => serial(async () => {
  const { modes } = await load();
  if (!modes[tabId]) return;
  delete modes[tabId];
  await browser.storage.session.set({ modes });
}));

// Repaint per-tab icons after navigation because Firefox may reset them.
browser.tabs.onUpdated.addListener((tabId, { status }) => {
  if (!status) return;
  serial(async () => {
    const { modes } = await load();
    await paint(modes[tabId] ?? 'auto', tabId).catch(() => {});
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

  // Return a loading frame's mode and repaint its tab's icon.
  if (message.type === 'get') {
    return serial(async () => {
      await setScheme(message.scheme);
      const { modes } = await load();
      const tabId = sender.tab?.id;
      const mode = modes[tabId] ?? 'auto';
      if (tabId !== undefined) await paint(mode, tabId).catch(() => {});
      return { mode };
    });
  }
});

// Restore per-tab icons after Firefox starts.
browser.runtime.onStartup.addListener(() => serial(restore));

// Inject scripts into tabs that were already open when the extension was
// installed or updated. Each new page script retires its old content script.
browser.runtime.onInstalled.addListener(async () => {
  serial(restore);
  const tabs = await browser.tabs.query({
    url: ['http://*/*', 'https://*/*', 'file:///*'],
  });
  for (const tab of tabs) {
    const target = { tabId: tab.id, allFrames: true };
    // Install page.js before content.js announces a mode. Ignore failures on
    // protected pages.
    browser.scripting.executeScript({
      target, files: ['page.js'], world: 'MAIN', injectImmediately: true,
    })
      .then(() => browser.scripting.executeScript({
        target, files: ['content.js'], injectImmediately: true,
      }))
      .catch(() => {});
  }
});

// Event pages can restart without an onStartup event. Restore their icons too.
serial(restore);
