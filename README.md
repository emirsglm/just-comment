# Just Comment

Point, click, comment. A Chrome extension (Manifest V3) for manual web testing. Click any
element on a live site to capture an **annotated screenshot**, your **comment**, and the
element's **CSS selector**, or snip any area of the page, then export everything as a
single offline HTML report.

**100% local.** No network requests, no analytics, no external libraries, no
`host_permissions`. Everything stays in `chrome.storage.local` on your machine.

Light and dark themes follow your system setting.

## Features

- **Comment mode**: hover to highlight, click to capture. The clicked element is outlined
  on the screenshot, and its selector, tag, classes, text and position are recorded.
- **Screenshot mode**: snipping-tool style selection drawn over the live page:
  | Method | How | Result |
  |---|---|---|
  | Rectangle (default) | Click + drag | Cropped to the rectangle |
  | Freeform | Alt + drag | Cropped to the shape's bounds, outside of the shape dimmed |
  | Full page | Ctrl + click (Cmd + click on macOS) | The whole visible viewport |
- The two modes are mutually exclusive: starting one stops the other.
- **Comment list** in the popup with thumbnails, per-item delete and "Clear All", both
  with inline confirmation.
- **HTML report**: one self-contained file with embedded images, dark mode and print styles.
- **Keyboard friendly**: `Esc` cancels a selection, closes the dialog or exits the mode;
  `Ctrl/Cmd + Enter` saves; focus is trapped inside the dialog.

## Installation

### From the Chrome Web Store

_Coming soon._

### Load unpacked (development)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`).
4. Pin **Just Comment** from the puzzle-piece menu so it's always in the toolbar.

After changing the code, click the reload icon on `chrome://extensions` and reload the
tab you are testing.

## Usage

1. Open the site you want to test (must be `http` or `https`).
2. Click the toolbar icon and choose **Start comment mode** or **Start screenshot mode**.
3. Close the popup, then click an element (comment mode) or select an area (screenshot mode).
   The screenshot is taken and the comment dialog opens.
4. Type your comment and press **Save** (or `Ctrl/Cmd + Enter`).
5. Back in the popup, **Download Report** to get the HTML file, or delete comments.

Clicking the active mode's button again (or pressing `Esc` on the page) turns it off.

Each saved record looks like:

```json
{
  "id": "1759150000000-abc123",
  "createdAt": "2026-09-29T12:00:00.000Z",
  "mode": "comment",
  "pageUrl": "https://example.com/",
  "pageTitle": "Example",
  "element": { "selector": "...", "tagName": "button", "id": null, "classes": [], "text": "...", "rect": {} },
  "selection": null,
  "screenshot": "data:image/jpeg;base64,...",
  "comment": "..."
}
```

In screenshot mode, `mode` is `"screenshot"`, `element` is `null`, and `selection` is
`{ "type": "rect" | "freeform" | "full", "rect": { "x", "y", "width", "height" } }`
in CSS pixels relative to the viewport.

## Architecture

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest, minimal permissions (`activeTab`, `scripting`, `storage`, `downloads`) |
| `constants.js` | Shared constants, message types and helpers (`globalThis.JC`) |
| `background.js` | Service worker: content-script injection, mode toggling, screenshot capture, saving |
| `content.js` | Shadow-DOM UI, hover highlight, selection overlay, selector generation, crop/annotation, comment dialog |
| `content.css` | Isolates the shadow host from the page |
| `popup.html/js/css` | Mode toggles, comment list, report generation, deletion |
| `icons/` | Toolbar and store icons (the Offset mark) |
| `fonts/` | Bundled IBM Plex Sans / Mono (Latin subset, `.woff2`) and their OFL license |
| `store-assets/` | Chrome Web Store listing text and asset checklist |

### Design system

The UI follows the Just Comment design system: Signal Orange accent, Inspector Cyan for
selection, a warm Ink 900 neutral, and IBM Plex Sans / Mono.

- **In-page overlay** (`content.js`): always light and opaque with an ink border, so it holds up
  on any host page. The only transparency is the 12% cyan inspector fill. The hover highlight,
  committed-anchor outline, mode indicator (the expanded FAB pill) and comment popover match
  the spec's core components.
- **Popup and report**: the neutral ramp with borders instead of shadows, one primary action
  per view, and a dark theme (Ink panel, inverted logo) that follows the system setting.
- **Fonts** ship inside the extension and never load from a CDN. The content script registers
  them via the `FontFace` API under private family names (`JC Plex Sans`/`JC Plex Mono`) so they
  can't clash with the page's fonts. This is why `fonts/*.woff2` is listed in
  `web_accessible_resources`. The downloaded HTML report uses IBM Plex only if it's installed
  on the viewer's machine and falls back to system fonts otherwise.

The content script is **not** declared in `content_scripts`. It is injected with
`chrome.scripting.executeScript` only into the tab where you start a mode. That's why no
`host_permissions` are required.

### Why `captureVisibleTab` instead of html2canvas

- **Accuracy**: it's the browser's own compositor output. html2canvas re-renders from CSS
  and regularly breaks on `<canvas>`, iframes, shadow DOM, web fonts, filters and masks.
- **CSP**: html2canvas relies on SVG `foreignObject` → data URL → `<img>`, which strict
  `img-src`/`style-src` policies block. `captureVisibleTab` ignores page CSP.
- **No dependencies**: nothing to bundle, and the "no network requests" guarantee stays
  verifiable by reading the code.

The element outline (`annotate`) and the crop/freeform mask (`cropScreenshot`) are drawn
on a local `<canvas>` in `content.js`.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: no data leaves your computer.

## Known limitations

- **Visible area only**: scroll the element or area into view before capturing.
- **Restricted pages**: `chrome://`, `chrome-extension://`, the Chrome Web Store and
  `view-source:` pages can't be scripted by any extension. The popup tells you when this happens.
- **`file://` pages** are not supported.
- **`activeTab` lifetime**: access lasts until the tab navigates. After a reload, start the
  mode again.
- **Cross-origin iframes**: the selector points at the iframe itself, not elements inside
  it (they still appear in the screenshot).
- **Freeform masking**: screenshots are stored as JPEG, which has no transparency, so the
  area outside a freeform shape is dimmed rather than removed.
- **Alt key on Windows**: releasing Alt can occasionally focus Chrome's menu after a
  freeform drag. Press `Esc` or click the page to return.
- **Storage quota**: `chrome.storage.local` is ~10 MB. Screenshots are stored as JPEG
  (max 1400 px wide), which fits a few hundred comments. When it's full the dialog shows
  an error: download the report and clear the list.
- **Selector fragility**: selectors are unique at capture time (`id > tag+class >
  nth-child`). Sites with hashed class names (CSS Modules, Tailwind JIT, styled-components)
  may produce selectors that break on the next build.
- **Page keyboard shortcuts**: pointer events are swallowed, but the page may still react
  to keys pressed outside the dialog.

## License

MIT. IBM Plex fonts in `fonts/` are © IBM Corp. and licensed under the SIL Open Font
License 1.1 (`fonts/OFL.txt`).
