# Privacy policy

Paletmin Palette Toggle does not collect, store, or share personal data. It has no analytics, accounts, or servers. It sends nothing about you or the pages you visit to the developer or anyone else.

## What the extension processes

The extension runs scripts in each tab to switch between a page's light and dark palettes. These scripts read accessible stylesheet rules and `media` attributes, then swap `dark` and `light` in the `prefers-color-scheme` queries they find. They also patch the page's `matchMedia()` so its scripts see the same preference. This processing stays inside the tab and is not recorded or sent anywhere.

## Network requests

The extension makes no network requests. It cannot read rules inside cross-origin stylesheets, so it leaves them unchanged.

## What is stored

- Each tab's mode is kept in Firefox's extension session storage. It is removed when the tab closes or Firefox quits.
- Firefox's website appearance scheme is kept in extension local storage so the first click selects the opposite scheme, even before a page reports its preference after a restart.

No page content, URLs, or browsing history are stored.

## Permissions

- **Access your data for all websites**: lets the scripts run in each tab and frame.
- **scripting**: adds the scripts to tabs that are already open after installation or an update.
- **storage**: used for the two items listed above.

The manifest declares that no data is collected or transmitted outside the extension.

## Changes

Changes to this policy are published in the [extension's repository](https://github.com/min-tools/paletmin-firefox). To ask a question, [open an issue](https://github.com/min-tools/paletmin-firefox/issues).
