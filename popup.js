// Popup — mode toggles, comment list, report download, deletion.
// No network requests; data is only read from chrome.storage.local.

const { MODE, MSG, SELECTION, STORAGE_KEY } = JC;

const MODES = {
  [MODE.COMMENT]: {
    button: document.getElementById("toggle"),
    message: MSG.TOGGLE_FROM_POPUP,
    startLabel: "Start comment mode",
    stopLabel: "Stop comment mode",
    startedStatus: "Comment mode started. Close this popup and click any element on the page."
  },
  [MODE.SCREENSHOT]: {
    button: document.getElementById("screenshot-toggle"),
    message: MSG.TOGGLE_SCREENSHOT_MODE,
    startLabel: "Start screenshot mode",
    stopLabel: "Stop screenshot mode",
    startedStatus:
      "Screenshot mode started. Close this popup, then drag to select an area (Alt+drag: freeform, Ctrl+click: full page)."
  }
};

const SELECTION_LABELS = {
  [SELECTION.RECT]: "Screenshot · area",
  [SELECTION.FREEFORM]: "Screenshot · freeform",
  [SELECTION.FULL]: "Screenshot · full page"
};

const els = {
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  list: document.getElementById("list"),
  download: document.getElementById("download"),
  clear: document.getElementById("clear"),
  barDefault: document.getElementById("bar-default"),
  barConfirm: document.getElementById("bar-confirm"),
  clearQuestion: document.getElementById("clear-question"),
  clearYes: document.getElementById("clear-yes"),
  clearCancel: document.getElementById("clear-cancel")
};

const ICONS = {
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>',
  // Offset glyph (tile-less mark); the gap takes the panel color.
  empty:
    '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="9" y="9" width="22" height="22" rx="7" stroke="#FF5C1A" stroke-width="3"/><rect x="18.5" y="18.5" width="23" height="23" rx="8.5" fill="var(--panel)"/><rect x="21" y="21" width="18" height="18" rx="6" fill="#FF5C1A"/></svg>'
};

// Writes we make ourselves re-render explicitly (to manage focus), so the
// resulting storage.onChanged event is skipped.
let ignoreNextStorageChange = false;

function showStatus(message, ok = false) {
  els.status.textContent = message;
  els.status.className = "status show" + (ok ? " ok" : "");
}

function clearStatus() {
  els.status.className = "status";
  els.status.textContent = "";
}

async function getComments() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
}

async function setComments(list) {
  ignoreNextStorageChange = true;
  if (list.length) {
    await chrome.storage.local.set({ [STORAGE_KEY]: list });
  } else {
    await chrome.storage.local.remove(STORAGE_KEY);
  }
}

function commentKey(c) {
  return c.id || c.createdAt;
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString();
}

function countLabel(n) {
  return n === 1 ? "1 comment" : `${n} comments`;
}

/** Host + path without the protocol, for compact meta lines. */
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch (e) {
    return url || "";
  }
}

/** Short label describing what a record points at. */
function targetLabel(c) {
  if (c.element) return c.element.selector;
  const type = c.selection && c.selection.type;
  return SELECTION_LABELS[type] || "Page screenshot";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
function renderEmpty() {
  const li = document.createElement("li");
  li.className = "empty";
  li.innerHTML = ICONS.empty;
  const title = document.createElement("p");
  title.className = "empty-title";
  title.textContent = "No comments yet.";
  const text = document.createElement("p");
  text.className = "empty-text";
  text.textContent =
    "Start comment mode to click on an element, or screenshot mode to select an area of the page.";
  li.append(title, text);
  els.list.appendChild(li);
}

function renderDeleteButton(actions, c) {
  actions.className = "item-actions";
  actions.textContent = "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn delete";
  btn.title = "Delete comment";
  btn.setAttribute("aria-label", "Delete comment");
  btn.innerHTML = ICONS.trash;
  btn.addEventListener("click", () => renderDeleteConfirm(actions, c));
  actions.appendChild(btn);
  return btn;
}

function renderDeleteConfirm(actions, c) {
  actions.className = "item-actions confirming";
  actions.textContent = "";

  const question = document.createElement("span");
  question.className = "question";
  question.textContent = "Delete?";

  const btns = document.createElement("span");
  btns.className = "btns";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-secondary";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => renderDeleteButton(actions, c).focus());

  const yes = document.createElement("button");
  yes.type = "button";
  yes.className = "btn btn-destructive";
  yes.textContent = "Delete";
  yes.addEventListener("click", () => deleteComment(commentKey(c)));

  btns.append(cancel, yes);
  actions.append(question, btns);
  yes.focus();
}

/**
 * Re-renders the list from storage.
 * @param {string} [focusKey]  Comment whose delete button should receive focus.
 */
async function render(focusKey) {
  const comments = await getComments();
  els.count.textContent = countLabel(comments.length);
  els.download.disabled = comments.length === 0;
  els.clear.disabled = comments.length === 0;
  els.list.textContent = "";

  if (comments.length === 0) {
    hideClearConfirm();
    renderEmpty();
    return;
  }

  // Newest first.
  for (const c of [...comments].reverse()) {
    const li = document.createElement("li");
    li.className = "item";
    li.dataset.key = commentKey(c);

    const img = document.createElement("img");
    img.className = "thumb";
    if (c.screenshot) img.src = c.screenshot;
    img.alt = "";
    li.appendChild(img);

    const body = document.createElement("div");
    body.className = "body";

    const p = document.createElement("p");
    p.className = "comment";
    p.textContent = c.comment;
    body.appendChild(p);

    const chip = document.createElement("span");
    chip.className = c.element ? "chip chip-selector" : "chip chip-screenshot";
    chip.textContent = targetLabel(c);
    chip.title = targetLabel(c);
    body.appendChild(chip);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${formatDate(c.createdAt)} · ${shortUrl(c.pageUrl)}`;
    meta.title = c.pageUrl;
    body.appendChild(meta);

    li.appendChild(body);

    const actions = document.createElement("div");
    renderDeleteButton(actions, c);
    li.appendChild(actions);

    els.list.appendChild(li);
  }

  if (focusKey) {
    const target = els.list.querySelector(`li[data-key="${CSS.escape(focusKey)}"] .delete`);
    if (target) target.focus();
  }
}

async function deleteComment(key) {
  clearStatus();
  const comments = await getComments();
  const idx = comments.findIndex((c) => commentKey(c) === key);
  if (idx === -1) return render();

  // The list is displayed newest first, so the "next" item on screen is the
  // one saved just before this one; fall back to the one after it.
  const neighbor = comments[idx - 1] || comments[idx + 1];
  comments.splice(idx, 1);
  await setComments(comments);
  showStatus("Comment deleted.", true);
  await render(neighbor ? commentKey(neighbor) : undefined);
  if (!neighbor) MODES[MODE.COMMENT].button.focus();
}

// ---------------------------------------------------------------------------
// Mode toggles (mutually exclusive; the content script owns the state)
// ---------------------------------------------------------------------------
function setModeState(activeMode) {
  for (const [m, cfg] of Object.entries(MODES)) {
    const on = m === activeMode;
    cfg.button.classList.toggle("on", on);
    cfg.button.setAttribute("aria-pressed", String(on));
    cfg.button.querySelector(".mode-label").textContent = on ? cfg.stopLabel : cfg.startLabel;
  }
}

function setModeButtonsDisabled(disabled) {
  for (const cfg of Object.values(MODES)) cfg.button.disabled = disabled;
}

async function refreshModeState() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || "")) {
      setModeButtonsDisabled(true);
      showStatus("Cannot work on this page. Open an http(s) site.");
      return;
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: MSG.PING });
    setModeState(res && res.mode);
  } catch (e) {
    // Content script not injected yet — expected.
    setModeState(null);
  }
}

async function toggleMode(mode) {
  clearStatus();
  setModeButtonsDisabled(true);
  try {
    const res = await chrome.runtime.sendMessage({ type: MODES[mode].message });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Unknown error.");
    setModeState(res.mode);
    if (res.mode) showStatus(MODES[res.mode].startedStatus, true);
  } catch (err) {
    showStatus("Could not start: " + JC.getErrorMessage(err));
  } finally {
    setModeButtonsDisabled(false);
  }
}

for (const [mode, cfg] of Object.entries(MODES)) {
  cfg.button.addEventListener("click", () => toggleMode(mode));
}

// ---------------------------------------------------------------------------
// Self-contained HTML report
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Offset mark lockups: ink tile on light, inverted tile on ink.
const LOGO_SVG =
  '<svg class="logo logo-light" viewBox="0 0 48 48" width="32" height="32" fill="none" aria-hidden="true">' +
  '<rect width="48" height="48" rx="10" fill="#16110D"/>' +
  '<rect x="8.5" y="8.5" width="23" height="23" rx="7.5" stroke="#FF5C1A" stroke-width="4"/>' +
  '<rect x="18" y="18" width="24" height="24" rx="9" fill="#16110D"/>' +
  '<rect x="21" y="21" width="19" height="19" rx="6.5" fill="#FF5C1A"/></svg>' +
  '<svg class="logo logo-dark" viewBox="0 0 48 48" width="32" height="32" fill="none" aria-hidden="true">' +
  '<rect width="48" height="48" rx="10" fill="#FF5C1A"/>' +
  '<rect x="8.5" y="8.5" width="23" height="23" rx="7.5" stroke="#16110D" stroke-width="4"/>' +
  '<rect x="18" y="18" width="24" height="24" rx="9" fill="#FF5C1A"/>' +
  '<rect x="21" y="21" width="19" height="19" rx="6.5" fill="#16110D"/></svg>';

function formatRect(r) {
  return r ? `${r.x},${r.y} · ${r.width}×${r.height}` : "—";
}

/**
 * Builds a single-file HTML report with all screenshots embedded.
 * @param {object[]} comments  Records from storage, oldest first.
 * @returns {string}
 */
function buildReportHtml(comments) {
  const generatedAt = new Date().toLocaleString();

  const items = comments
    .map((c, i) => {
      const el = c.element;
      const shot = c.screenshot
        ? `<img src="${escapeHtml(c.screenshot)}" alt="Screenshot ${i + 1}">`
        : `<div class="noshot">No screenshot was captured.</div>`;

      let chip;
      let targetRows;
      if (el) {
        const classes = Array.isArray(el.classes) && el.classes.length ? el.classes.join(" ") : "—";
        chip = `<span class="chip chip-selector" title="${escapeHtml(el.selector || "")}">${escapeHtml(
          el.selector || "—"
        )}</span>`;
        targetRows = `
          <dt>Element</dt><dd class="mono">&lt;${escapeHtml(el.tagName || "?")}&gt;${
            el.id ? " #" + escapeHtml(el.id) : ""
          }</dd>
          <dt>Class</dt><dd class="mono">${escapeHtml(classes)}</dd>
          <dt>Text</dt><dd>${escapeHtml(el.text || "—")}</dd>
          <dt>Position</dt><dd class="mono">${escapeHtml(formatRect(el.rect))}</dd>`;
      } else {
        const sel = c.selection || {};
        chip = `<span class="chip chip-screenshot">${escapeHtml(targetLabel(c))}</span>`;
        targetRows = `
          <dt>Area</dt><dd class="mono">${escapeHtml(formatRect(sel.rect))}</dd>`;
      }

      return `
    <article class="item">
      <div class="shot">${shot}</div>
      <div class="info">
        <div class="item-head">
          <span class="pin" aria-label="Comment ${i + 1}">${i + 1}</span>
          ${chip}
        </div>
        <p class="comment">${escapeHtml(c.comment)}</p>
        <dl>${targetRows}
          <dt>Page</dt><dd class="url">${escapeHtml(c.pageUrl || "—")}</dd>
          <dt>Date</dt><dd class="mono">${escapeHtml(formatDate(c.createdAt))}</dd>
        </dl>
      </div>
    </article>`;
    })
    .join("\n");

  // Fully self-contained: no external CSS/JS/images. IBM Plex is used when
  // installed on the viewer's machine, otherwise the system fallback stack.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Test Comments Report</title>
<style>
  :root {
    --orange-500: #FF5C1A; --orange-700: #B83A08;
    --cyan-50: #E6F8FB; --cyan-100: #BEEAF1; --cyan-700: #0E7C90;
    --ink: #16110D;
    --panel: #FFFFFF; --page: #F6F7F9; --row: #F6F7F9; --divider: #EDEFF3; --border: #DDE1E8;
    --text: #16110D; --text-body: #252B36; --text-muted: #6B7280; --text-code: #414A5A;
    --chip-bg: #F6F7F9; --chip-text: #414A5A;
    --font-sans: "IBM Plex Sans", -apple-system, "Segoe UI", system-ui, sans-serif;
    --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --panel: #16110D; --page: #0E0B09; --row: #252B36; --divider: #252B36; --border: #414A5A;
      --text: #EDEFF3; --text-body: #EDEFF3; --text-muted: #DDE1E8; --text-code: #DDE1E8;
      --chip-bg: #252B36; --chip-text: #EDEFF3;
    }
  }
  * { box-sizing: border-box; }
  html { font-size: 16px; }
  body {
    margin: 0; padding: 32px 20px;
    font: 400 13px/1.55 var(--font-sans);
    color: var(--text-body); background: var(--page);
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1040px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  .logo { flex: none; }
  .logo-dark { display: none; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; line-height: 1.25; letter-spacing: -0.02em; color: var(--text); }
  .sub { margin: 2px 0 0; font: 500 11px/1.4 var(--font-mono); color: var(--text-muted); }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
    break-inside: avoid;
  }
  .shot img { display: block; max-width: 100%; border: 1px solid var(--border); border-radius: 8px; }
  .noshot {
    padding: 32px 16px; text-align: center; font-size: 12px; color: var(--text-muted);
    border: 1px dashed var(--border); border-radius: 8px;
  }
  .item-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; min-width: 0; }
  /* Annotation pin: the square corner points at the anchor. */
  .pin {
    flex: none;
    width: 32px; height: 32px;
    display: grid; place-items: center;
    border-radius: 999px 999px 999px 4px;
    background: var(--orange-500);
    border: 2px solid var(--ink);
    box-shadow: 0 4px 16px rgba(22, 17, 13, .28), inset 0 0 0 1px rgba(255, 255, 255, .55);
    font: 600 12px/1 var(--font-sans);
    color: var(--ink);
  }
  .chip {
    min-width: 0; max-width: 100%;
    font: 400 11px/1.45 var(--font-mono);
    border-radius: 5px; padding: 3px 7px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .chip-selector { color: var(--cyan-700); background: var(--cyan-50); border: 1px solid var(--cyan-100); }
  .chip-screenshot { color: var(--chip-text); background: var(--chip-bg); border: 1px solid var(--border); }
  .comment { margin: 0 0 14px; font-size: 14px; line-height: 1.55; color: var(--text-body); white-space: pre-wrap; word-break: break-word; }
  dl {
    display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 0;
    padding-top: 12px; border-top: 1px solid var(--divider); font-size: 12px; line-height: 1.4;
  }
  dt { color: var(--text-muted); font-weight: 500; }
  dd { margin: 0; word-break: break-word; }
  .mono { font: 400 11px/1.45 var(--font-mono); color: var(--text-code); }
  .url { font: 400 11px/1.45 var(--font-mono); color: var(--text-code); word-break: break-all; }
  footer { margin-top: 24px; text-align: center; font-size: 12px; color: var(--text-muted); }
  @media (prefers-color-scheme: dark) {
    .logo-light { display: none; }
    .logo-dark { display: block; }
  }
  @media (max-width: 760px) { .item { grid-template-columns: 1fr; } }
  @media print {
    :root {
      --panel: #FFFFFF; --page: #FFFFFF; --divider: #EDEFF3; --border: #DDE1E8;
      --text: #16110D; --text-body: #252B36; --text-muted: #6B7280; --text-code: #414A5A;
      --chip-bg: #F6F7F9; --chip-text: #414A5A;
    }
    .logo-light { display: block; }
    .logo-dark { display: none; }
    body { padding: 0; }
    .item { page-break-inside: avoid; }
    .pin { box-shadow: none; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    ${LOGO_SVG}
    <div>
      <h1>Test Comments Report</h1>
      <p class="sub">${escapeHtml(countLabel(comments.length))} · generated ${escapeHtml(generatedAt)}</p>
    </div>
  </header>
${items}
  <footer>This file is self-contained; all images are embedded and no external resources are used.</footer>
</div>
</body>
</html>`;
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes()
  )}`;
}

els.download.addEventListener("click", async () => {
  clearStatus();
  els.download.disabled = true;
  let objectUrl = null;
  try {
    const comments = await getComments();
    if (comments.length === 0) throw new Error("No comments to download.");

    const html = buildReportHtml(comments);
    const blob = new Blob([html], { type: "text/html" });
    objectUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: objectUrl,
      filename: `test-comments-${timestampForFilename()}.html`,
      saveAs: true
    });

    showStatus("Report downloaded.", true);
  } catch (err) {
    showStatus("Could not generate report: " + JC.getErrorMessage(err));
  } finally {
    // Release the blob once the download has started.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    els.download.disabled = false;
    render();
  }
});

// ---------------------------------------------------------------------------
// Clear all (inline confirmation)
// ---------------------------------------------------------------------------
function hideClearConfirm() {
  els.barConfirm.hidden = true;
  els.barDefault.hidden = false;
}

els.clear.addEventListener("click", async () => {
  clearStatus();
  const comments = await getComments();
  if (!comments.length) return;
  els.clearQuestion.textContent = `Delete ${countLabel(comments.length)}? This cannot be undone.`;
  els.barDefault.hidden = true;
  els.barConfirm.hidden = false;
  els.clearCancel.focus();
});

els.clearCancel.addEventListener("click", () => {
  hideClearConfirm();
  els.clear.focus();
});

els.clearYes.addEventListener("click", async () => {
  await setComments([]);
  hideClearConfirm();
  showStatus("All comments deleted.", true);
  await render();
  MODES[MODE.COMMENT].button.focus();
});

// Live-update when a comment is saved from a tab.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEY]) return;
  if (ignoreNextStorageChange) {
    ignoreNextStorageChange = false;
    return;
  }
  render();
});

setModeState(null);
refreshModeState();
render();
