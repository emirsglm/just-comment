# Privacy Policy — Just Comment

_Last updated: 2026-09-29_

Just Comment is a Chrome extension for leaving screenshots and comments on web pages
while manually testing them. It is designed to never send data anywhere.

## Data the extension handles

When **you** click an element in comment mode, or select an area in screenshot mode, the
extension creates a record containing:

- a screenshot of the visible part of the current tab (cropped to your selection in
  screenshot mode),
- the comment you type,
- the page URL and title,
- in comment mode only: a CSS selector, tag name, id, class names, up to 160 characters
  of the element's text, and its on-screen position,
- in screenshot mode only: the selection type and its on-screen position.

## Where it is stored

Records are stored only in `chrome.storage.local` on your computer. `chrome.storage.sync`
is intentionally **not** used, so nothing is synced to your Google account.

When you click **Download report**, an HTML file is generated in the browser and saved
through Chrome's download dialog to a location you choose.

## What the extension does not do

- It makes **no network requests** (no `fetch`, `XMLHttpRequest`, WebSocket, analytics,
  or remote code).
- It does not collect, sell, or transfer any data to the developer or third parties.
- It does not run on any page until you open the popup and start a mode for that tab. It declares no `host_permissions` and no always-on content scripts.

## Permissions

| Permission | Why it is needed |
|---|---|
| `activeTab` | Temporary access to the tab you invoke the extension on, to capture its screenshot. |
| `scripting` | Injects the comment-mode UI into that tab only when you turn it on. |
| `storage` | Keeps your comments locally until you delete them. |
| `downloads` | Saves the HTML report you ask for. |

## Deleting your data

Delete individual comments or use **Clear all** in the popup. Removing the extension
also deletes all of its stored data.

## Contact

Questions: open an issue in the project's GitHub repository.
