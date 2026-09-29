# Store assets

Chrome Web Store listing material. PNG exports are git-ignored; regenerate or capture them
before uploading.

## Required

| Asset | Size | Notes |
|---|---|---|
| Store icon | 128×128 | Use `icons/icon-128.png` |
| Screenshots (1–5) | 1280×800 (or 640×400) | See list below |
| Small promo tile | 440×280 | `promo-small.html` → screenshot at 440×280 |

## Screenshots to capture

1. **Popup with comments** — several comments in the list, both comment-mode and screenshot-mode entries.
2. **Hover highlight** — comment mode on, badge visible, an element highlighted.
3. **Screenshot selection** — screenshot mode on, a rectangle or freeform selection being dragged.
4. **Comment dialog** — screenshot preview, element info and a comment typed.
5. **HTML report** — the downloaded report open in a tab (light theme).
6. **Dark mode** (optional; the store allows 5) — popup or report with the system in dark mode.

Use a clean demo site, 1280×800 window, and hide personal bookmarks/extensions.

## Promo tile

Open `promo-small.html` in Chrome, set the viewport to 440×280 (DevTools device toolbar),
and capture a screenshot with "Capture node screenshot" on `#tile`. Save as
`promo-small.png`.
