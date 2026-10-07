# Privacy policy

Paletmin Palette Toggle does not collect, store, or share personal data. It has no analytics, accounts, or servers. It sends nothing about you or the pages you visit to the developer or anyone else.

## What the extension processes

The extension runs scripts in each tab to switch between a page's light and dark palettes. These scripts read accessible stylesheet rules and `media` attributes, then swap `dark` and `light` in the `prefers-color-scheme` queries they find. They also patch the page's `matchMedia()` so its scripts see the same preference. This processing stays inside the tab and is not recorded or sent anywhere.

## Network requests

The extension makes no network requests. It cannot read rules inside cross-origin stylesheets, so it leaves them unchanged.

## What is stored

- Each tab's mode is kept in Firefox's extension session storage. It is removed when the tab closes or Firefox quits.
- Each tab's readiness state is kept in session storage: ready, reload required, or unavailable. It contains no page content or URL and is removed when the tab closes or Firefox quits.
- The last reported Firefox website appearance scheme is cached in extension local storage. Toolbar clicks read the current tab's native scheme directly.
- A session flag records whether open tabs have been initialized. It prevents repeated setup when the background script wakes and is cleared when the extension is disabled or Firefox quits.

No page content, URLs, or browsing history are stored.

## Permissions

- **Access your data for all websites**: lets the scripts run in each tab and frame.
- **scripting**: checks whether a tab's page controller is ready, applies the selected mode, and reconnects the relay after an extension update or re-enabling. Pages without a document-start controller stay disabled until reloaded.
- **storage**: used for the items listed above.

The manifest declares that no data is collected or transmitted outside the extension.

## Changes

Changes to this policy are published in the [extension's repository](https://github.com/min-tools/paletmin-firefox). To ask a question, [open an issue](https://github.com/min-tools/paletmin-firefox/issues).
