# Mozilla Add-ons listing

## Name

Paletmin Palette Toggle

## Summary

Switch the current tab between light and dark palettes with one click. No popup, no settings, no data collection.

## Description

Paletmin Palette Toggle switches the current tab between a website's light and dark palettes.

Click the toolbar icon to cycle through three modes:

• Auto: follow Firefox's website appearance preference.
• Dark: ask the website to use its dark palette.
• Light: ask the website to use its light palette.

Each tab keeps its mode until you close it or quit Firefox. One site can be dark while the rest stay light. The icon shows the current mode and adapts to Firefox's light or dark toolbar. You can also assign a keyboard shortcut through Manage Extension Shortcuts in about:addons.

The extension changes the color scheme a website thinks you prefer. It rewrites the website's matching media queries and does not add a theme of its own. If a website has no dark theme or ignores the system preference, nothing changes. Rules inside inaccessible cross-origin stylesheets are left unchanged.

Tabs already open when you install the extension show a disabled, slashed A. Reload the page once to enable Paletmin, or navigate to a new page. New pages work normally. Firefox's protected pages stay disabled and show an unavailable message. Paletmin never reloads pages automatically.

No popup, settings page, or account. No data collection, analytics, tracking, or network requests.

Why it needs access to all websites: its scripts must run before each page's own scripts, including after navigation. They read and rewrite accessible stylesheet rules inside the tab without sending the data anywhere.

Requires Firefox 140 or later on desktop. Open source under the MIT license.

## Links

Publish the repository before using these links:

- Homepage: https://github.com/min-tools/paletmin-firefox
- Support: https://github.com/min-tools/paletmin-firefox/issues
- Privacy policy: https://github.com/min-tools/paletmin-firefox/blob/main/PRIVACY.md

## License

MIT

## Category

Appearance

## Screenshots

promo/screenshot.png (1280×800) and promo/screenshot-small.png (640×400)

## Notes to reviewers

The extension has one purpose: switch a tab's prefers-color-scheme between Auto, Dark, and Light. It needs access to all websites so its scripts can start before page scripts and remain available after navigation. The scripting permission checks and calls the page controller and reconnects missing relays after an update or re-enabling. Pages without a document-start controller stay disabled with a reload message. Session storage holds per-tab modes, readiness states, and an initialization flag. Local storage holds the last reported Firefox page scheme.

All JavaScript is included as readable source. There is no remote code, bundling, minification, data collection, or network access by the extension. The SVG toolbar icons embed the original PNG glyphs as image data, not executable code. No build step is needed beyond ZIP packaging, so the uploaded files are the source files.
