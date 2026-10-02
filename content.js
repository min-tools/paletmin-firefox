// Relays this frame's mode to the persistent controller in page.js.
// Runs in Firefox's isolated world, so matchMedia() here still reports the
// native page scheme. No page data crosses the extension message channel.
(() => {
  const RESET = 'palette-toggle:content-reset';
  let active = true;

  // system()
  // Return Firefox's native page scheme for the click cycle order.
  const system = () =>
    matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  // setMode(mode)
  // Tell the page controller which scheme to expose. Separate event types
  // avoid passing JavaScript objects between the isolated and page worlds.
  function setMode(mode) {
    document.dispatchEvent(new Event(`palette-toggle:${mode}`));
  }

  // Report a changed native page scheme without reading the patched API.
  const onScheme = () => {
    if (window === top) {
      browser.runtime.sendMessage({ type: 'scheme', scheme: system() })
        .catch(() => {});
    }
  };

  // Apply modes sent after a toolbar click or keyboard shortcut.
  const onMessage = (message, sender, respond) => {
    if (sender.id !== browser.runtime.id || message.type !== 'set') return;
    setMode(message.mode);
    respond(true);
  };

  // retire()
  // Stop this copy before a replacement starts. The page controller restores
  // CSS even when Firefox has already discarded this isolated script.
  const retire = () => {
    active = false;
    window.removeEventListener(RESET, retire);
    schemeList.removeEventListener('change', onScheme);
    try {
      browser.runtime.onMessage.removeListener(onMessage);
    } catch {
      // The old runtime may already be unavailable after an extension reload.
    }
    setMode('auto');
  };

  // A window can outlive its initial about:blank document. Listen there so
  // the old copy can retire even after its document was replaced.
  window.addEventListener(RESET, retire);
  const schemeList = matchMedia('(prefers-color-scheme: dark)');
  schemeList.addEventListener('change', onScheme);
  browser.runtime.onMessage.addListener(onMessage);

  // Ignore a late response if a newer copy has retired this one.
  browser.runtime.sendMessage({ type: 'get', scheme: system() })
    .then((reply) => {
      if (active && ['auto', 'dark', 'light'].includes(reply?.mode)) {
        setMode(reply.mode);
      }
    })
    .catch(() => {}); // The background may be unavailable during an update.
})();
