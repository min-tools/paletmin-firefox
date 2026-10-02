// Runs in the page's JavaScript world before its scripts. Patches matchMedia()
// and rewrites accessible prefers-color-scheme queries in styles and media
// attributes. content.js announces modes with "palette-toggle:<mode>" events.
// Pages that support both schemes also get a forced color-scheme property.
//
// Keep CSS originals and the controller in the page across extension updates
// and reloads. Existing MediaQueryList objects keep their values and events.
(() => {
  const CONTENT_RESET = 'palette-toggle:content-reset';
  const CONTROLLER = Symbol.for('tools.min.paletmin.palette-toggle');

  // Retire the previous content script, including one attached to an earlier
  // document in a reused window. Keep the page controller and its query lists.
  window.dispatchEvent(new Event(CONTENT_RESET));
  if (window[CONTROLLER]) {
    window[CONTROLLER]('auto');
    return;
  }

  const native = window.matchMedia;
  const real = native.bind(window);
  const tracked = new Set(); // WeakRefs to color-scheme query lists.
  const synthetic = new WeakSet(); // Change events created by this script.
  let forced = null; // 'dark', 'light', or null for Auto.

  // mentions(query)
  // Return whether a media query uses prefers-color-scheme.
  const mentions = (query) => /prefers-color-scheme/i.test(query);

  // system()
  // Return Firefox's current scheme: 'dark' or 'light'.
  const system = () =>
    real('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

  // swap(query)
  // Exchange dark and light. Evaluating the result against Firefox's scheme
  // gives the answer for the opposite scheme.
  const swap = (query) => query.replace(
    /(prefers-color-scheme\s*:\s*)(dark|light)/gi,
    (_, prefix, value) =>
      prefix + (value.toLowerCase() === 'dark' ? 'light' : 'dark'));

  // evaluate(query)
  // Evaluate a query using the mode the page should see.
  const evaluate = (query) =>
    real(forced && forced !== system() ? swap(query) : query).matches;

  // matchMedia(query)
  // Replace window.matchMedia(). Return a native list whose matches getter
  // uses the forced scheme. Hide its native change events while forced.
  const patched = function matchMedia(query) {
    const list = real(query);
    if (!mentions(list.media)) return list;
    const media = list.media;
    Object.defineProperty(list, 'matches', {
      get: () => evaluate(media),
      configurable: true,
    });
    // While forced, Firefox's scheme cannot change the visible answer. Register
    // this listener first so it can suppress the native event.
    list.addEventListener('change', (event) => {
      if (forced && !synthetic.has(event)) event.stopImmediatePropagation();
    });
    tracked.add(new WeakRef(list));
    return list;
  };
  window.matchMedia = patched;

  // Keep CSS originals in the page too. Firefox discards isolated-world state
  // on an add-on reload while stylesheet edits remain in the document.
  const styles = (() => {
    let mode = 'auto'; // 'auto', 'dark', or 'light'
    let observer; // Watches for new styles while a scheme is forced.
    let pending; // Pending apply() timer.
    const applied = new WeakMap(); // Rule or element -> { original, applied }
    const schemeSheet = new CSSStyleSheet(); // Holds the forced color-scheme rule.

    // swapNeeded()
    // Return true when the forced scheme differs from Firefox's scheme.
    const swapNeeded = () => mode !== 'auto' && mode !== system();

    // rewrite(key, get, set)
    // Rewrite one media query for the current mode. get and set access its
    // text. key identifies the rule or element whose original text must be
    // restored. Treat external changes as a new original and skip queries
    // that do not mention prefers-color-scheme.
    function rewrite(key, get, set) {
      const current = get();
      let entry = applied.get(key);
      // Record a new query or one the page changed after the last rewrite.
      if (!entry || entry.applied !== current) {
        if (!mentions(current)) return;
        entry = { original: current, applied: current };
        applied.set(key, entry);
      }
      const wanted = swapNeeded() ? swap(entry.original) : entry.original;
      if (wanted === current) return;
      try {
        set(wanted);
        entry.applied = get();
      } catch {
        // Leave rules unchanged when they reject the new media text.
      }
    }

    // visitRules(rules)
    // Rewrite each rule in a CSSRuleList, including @import sheets and nested
    // groups such as @supports and @layer.
    function visitRules(rules) {
      for (const rule of rules) {
        // @media and @import rules can carry a media list.
        if (rule.media) {
          rewrite(rule, () => rule.media.mediaText,
            (text) => { rule.media.mediaText = text; });
        }
        if (rule.styleSheet) visitSheet(rule.styleSheet);
        if (rule.cssRules) visitRules(rule.cssRules);
      }
    }

    // visitSheet(sheet)
    // Rewrite accessible stylesheet rules. Leave cross-origin sheets unchanged.
    function visitSheet(sheet) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        return; // Reading rules throws for cross-origin sheets.
      }
      visitRules(rules);
    }

    // applyColorScheme()
    // Force color-scheme on the root and body only when their computed values
    // support both schemes. Forcing a single-scheme page could incorrectly
    // change its canvas and form controls.
    function applyColorScheme() {
      // Remove the previous rule before reading the page's computed value.
      const sheets = document.adoptedStyleSheets;
      if (sheets.includes(schemeSheet)) {
        document.adoptedStyleSheets = sheets.filter((s) => s !== schemeSheet);
      }
      if (mode === 'auto') return;

      // Return whether an element supports both light and dark.
      const both = (element) => {
        if (!element) return false;
        const scheme = getComputedStyle(element).colorScheme;
        return /\blight\b/.test(scheme) && /\bdark\b/.test(scheme);
      };
      const selectors = [];
      if (both(document.documentElement)) selectors.push(':root');
      if (both(document.body)) selectors.push('body');
      if (!selectors.length) return;

      // Use an adopted sheet so an inline-style CSP cannot block the rule.
      schemeSheet.replaceSync(
        `${selectors.join(', ')} { color-scheme: ${mode} !important; }`);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, schemeSheet];
    }

    // apply()
    // Apply the current mode to stylesheets, media attributes, and
    // color-scheme. Auto restores the original values.
    function apply() {
      pending = undefined;
      if (!document.documentElement) return;
      for (const sheet of document.styleSheets) visitSheet(sheet);
      for (const sheet of document.adoptedStyleSheets) visitSheet(sheet);
      // Rewrite media attributes on any element that has one.
      for (const element of document.querySelectorAll('[media]')) {
        rewrite(element, () => element.getAttribute('media'),
          (text) => element.setAttribute('media', text));
      }
      applyColorScheme();
    }

    // schedule()
    // Schedule apply(), combining several requests into one run.
    function schedule() {
      pending ??= setTimeout(apply, 0);
    }

    // watch()
    // Watch for styles added by the parser or page scripts. Repeated calls are
    // safe.
    function watch() {
      observer ??= new MutationObserver((records) => {
        for (const record of records) {
          // Reapply after a media attribute changes.
          if (record.type === 'attributes') return schedule();
          // Reapply when text is added inside a style element.
          if (record.target.nodeName === 'STYLE') return schedule();
          // Reapply when a new subtree contains styles or media attributes.
          for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches('style, link, [media]') ||
                node.querySelector('style, link, [media]')) {
              return schedule();
            }
          }
        }
      });
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['media'],
      });
    }

    // setMode(next)
    // Switch the document to the requested mode and update its styles.
    function setMode(next) {
      mode = next;
      if (mode === 'auto') {
        // Stop watching because Auto does not rewrite later changes.
        observer?.disconnect();
      } else {
        watch();
      }
      apply();
    }

    // A linked stylesheet loads after its element. Capture its non-bubbling
    // load event so the new rules are rewritten.
    const onLoad = (event) => {
      if (mode !== 'auto' && event.target.nodeName === 'LINK') schedule();
    };

    // Reapply styles when the native page scheme changes while a mode is forced.
    const schemeList = real('(prefers-color-scheme: dark)');
    schemeList.addEventListener('change', () => {
      if (mode !== 'auto') schedule();
    });
    document.addEventListener('load', onLoad, true);
    return { setMode };
  })();

  // setMode(mode)
  // Apply 'auto', 'dark', or 'light'. Dispatch a change event for each
  // tracked list whose answer changes and discard collected lists.
  function setMode(mode) {
    // Save each live list's answer before changing the mode.
    const before = [];
    for (const ref of tracked) {
      const list = ref.deref();
      if (list) before.push([list, list.matches]);
      else tracked.delete(ref);
    }
    forced = mode === 'auto' ? null : mode;
    styles.setMode(mode);
    // Notify listeners as a native scheme change would.
    for (const [list, was] of before) {
      if (list.matches === was) continue;
      const event = new MediaQueryListEvent('change', {
        media: list.media,
        matches: list.matches,
      });
      synthetic.add(event);
      list.dispatchEvent(event);
    }
  }

  // Separate event types avoid passing data between JavaScript worlds.
  const handlers = ['auto', 'dark', 'light'].map((mode) =>
    [`palette-toggle:${mode}`, () => setMode(mode)]);
  for (const [type, handler] of handlers) {
    document.addEventListener(type, handler);
  }

  // Later copies restore the originals through this controller before the
  // new content script requests its mode. Its query lists and CSS state survive.
  Object.defineProperty(window, CONTROLLER, {
    value: setMode,
    configurable: false,
    enumerable: false,
    writable: false,
  });
})();
