// Content script — comment mode and screenshot mode UI.
// Adds a single host element to the page; everything else lives inside a
// shadow DOM. Makes no network requests.
//
// Styling follows the Just Comment design system: the overlay sits on someone
// else's page, so every surface is opaque with an ink border, and the only
// transparency is the 12% cyan inspector fill.
//
// Note: this file may be injected into the same tab more than once (the
// service worker can sleep and wake up), so everything is wrapped in an
// idempotency guard. constants.js is injected right before it and exposes JC.

(() => {
  if (window.__justCommentLoaded__) return;
  window.__justCommentLoaded__ = true;

  const { MODE, MSG, SELECTION } = JC;

  /** @type {null | "comment" | "screenshot"} */
  let mode = null;
  let dialogOpen = false;
  let busy = false; // true while a capture is in flight

  // Screenshot-mode selection state.
  /** @type {null | "rect" | "freeform" | "full"} */
  let selectionType = null;
  let isDrawing = false;
  let points = [];
  let startPoint = null;
  let endPoint = null;

  // ---------------------------------------------------------------------------
  // Fonts
  // @font-face doesn't work inside a shadow root, so the bundled faces are
  // registered on the document under private family names. If the page's CSP
  // blocks them, the fallback stack takes over.
  // ---------------------------------------------------------------------------
  function loadFonts() {
    if (!document.fonts || typeof FontFace !== "function") return;
    for (const f of JC.FONTS) {
      try {
        const face = new FontFace(f.family, `url("${chrome.runtime.getURL(f.file)}") format("woff2")`, {
          weight: f.weight,
          style: "normal",
          display: "swap"
        });
        document.fonts.add(face);
        face.load().catch(() => {});
      } catch (e) {
        // Ignore; system fonts are used instead.
      }
    }
  }
  loadFonts();

  const FONT_SANS = `"JC Plex Sans", "IBM Plex Sans", -apple-system, "Segoe UI", system-ui, sans-serif`;
  const FONT_MONO = `"JC Plex Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;

  const ICONS = {
    comment:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7.5A3.5 3.5 0 0 1 7.5 4h9A3.5 3.5 0 0 1 20 7.5v6a3.5 3.5 0 0 1-3.5 3.5h-4l-4.5 3.5V17H7.5A3.5 3.5 0 0 1 4 13.5v-6Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    screenshot:
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="8" y="8" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
    mark:
      '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#16110D"/><rect x="9" y="9" width="22" height="22" rx="7" stroke="#FF5C1A" stroke-width="3"/><rect x="18.5" y="18.5" width="23" height="23" rx="8.5" fill="#16110D"/><rect x="21" y="21" width="18" height="18" rx="6" fill="#FF5C1A"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // Shadow DOM UI
  // ---------------------------------------------------------------------------
  const host = document.createElement("div");
  host.id = JC.HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }

      /* Inherits nothing from the host page. Sizes are in px because rem
         would resolve against the host page's root font size. */
      .jc-root {
        --panel: #FFFFFF;
        --panel-alt: #F6F7F9;
        --divider: #EDEFF3;
        --border: #DDE1E8;
        --text: #16110D;
        --text-body: #252B36;
        --text-muted: #6B7280;
        --text-code: #414A5A;
        --focus-ring-color: #FFD2BB;
        --kbd-bg: #FFFFFF;
        --kbd-text: #414A5A;
        --kbd-border: #DDE1E8;
        --error-bg: #FFFFFF;
        --error-border: #E5484D;
        --error-text: #C62A2F;
        --pill-bg: #FFF1EA;
        --pill-border: #FFD2BB;
        --pill-text: #B83A08;
        --selector-bg: #E6F8FB;
        --selector-border: #BEEAF1;
        --selector-text: #0E7C90;
        --btn-primary-bg: #B83A08;
        --btn-primary-hover: #8F2C05;
        --btn-secondary-bg: #FFFFFF;
        --btn-secondary-text: #414A5A;
        --btn-secondary-border: #DDE1E8;
        --btn-secondary-hover-bg: #F6F7F9;

        font-size: 16px;
        font-family: ${FONT_SANS};
        font-weight: 400;
        line-height: 1.55;
        color: var(--text-body);
        -webkit-font-smoothing: antialiased;
      }
      @media (prefers-color-scheme: dark) {
        .jc-root {
          --panel: #16110D;
          --panel-alt: #252B36;
          --divider: #2E3440;
          --border: #414A5A;
          --text: #EDEFF3;
          --text-body: #EDEFF3;
          --text-muted: #DDE1E8;
          --text-code: #DDE1E8;
          --focus-ring-color: #FFD2BB;
          --kbd-bg: #FFFFFF;
          --kbd-text: #414A5A;
          --kbd-border: #414A5A;
          --error-bg: #16110D;
          --error-border: #E5484D;
          --error-text: #E5484D;
          --pill-bg: #252B36;
          --pill-border: #414A5A;
          --pill-text: #FF5C1A;
          --selector-bg: #252B36;
          --selector-border: #414A5A;
          --selector-text: #22C5DE;
          --btn-primary-bg: #B83A08;
          --btn-primary-hover: #8F2C05;
          --btn-secondary-bg: #252B36;
          --btn-secondary-text: #EDEFF3;
          --btn-secondary-border: #414A5A;
          --btn-secondary-hover-bg: #16110D;
        }
      }
      .jc-root *, .jc-root *::before, .jc-root *::after { box-sizing: border-box; }

      /* Inspector highlight ------------------------------------------------ */
      .highlight {
        position: fixed;
        pointer-events: none;
        display: none;
        z-index: 1;
        outline: 2px solid #22C5DE;
        outline-offset: 2px;
        box-shadow: inset 0 0 0 999px rgba(34, 197, 222, .12);
      }
      .highlight.pinned {
        outline: 2px dashed #FF5C1A;
        box-shadow: none;
      }
      .hl-label {
        position: absolute;
        top: -26px;
        left: -2px;
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: calc(100vw - 24px);
        background: #0E7C90;
        border-radius: 4px;
        padding: 3px 7px;
        white-space: nowrap;
        font: 400 11px/1.45 ${FONT_MONO};
        color: #FFFFFF;
      }
      .hl-sel { overflow: hidden; text-overflow: ellipsis; }
      .hl-size { color: #9EE8F5; flex: none; }
      .highlight.pinned .hl-label { display: none; }

      .selection-canvas {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        display: none;
        z-index: 1;
      }
      .selection-canvas.show { display: block; }

      /* Mode indicator: the FAB in its expanded pill form ------------------ */
      .fab {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2;
        display: none;
        align-items: center;
        gap: 10px;
        max-width: calc(100vw - 24px);
        padding: 6px 8px 6px 6px;
        background: #16110D;
        border: 2px solid #16110D;
        border-radius: 999px;
        box-shadow: 0 6px 20px rgba(22, 17, 13, .3), inset 0 0 0 1px rgba(255, 255, 255, .5);
        color: #FFFFFF;
        font: 500 13px/1.4 ${FONT_SANS};
        cursor: pointer;
        transition: transform .12s ease-out;
      }
      .fab.show { display: inline-flex; }
      .fab:hover { transform: translateY(-1px); }
      .fab:focus-visible { outline: 3px solid #FFD2BB; outline-offset: 2px; }
      .fab-disc {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 999px;
        background: #FF5C1A;
        color: #16110D;
        display: grid;
        place-items: center;
      }
      .fab-disc svg { width: 18px; height: 18px; }
      .fab-label { white-space: nowrap; padding-right: 2px; }
      .fab-hints { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
      .hint-group { display: inline-flex; align-items: center; gap: 5px; }
      .fab-hint { font-size: 12px; color: #DDE1E8; }
      kbd {
        font: 500 10px/1.3 ${FONT_MONO};
        color: #16110D;
        background: #FFC53D;
        border-radius: 4px;
        padding: 3px 5px;
      }
      @media (max-width: 640px) { .hint-group.opt { display: none; } }

      /* Click-catcher behind the popover. Transparent: the overlay layer
         never dims or blurs the host page. */
      .backdrop {
        position: fixed;
        inset: 0;
        display: none;
        z-index: 3;
        background: transparent;
      }
      .backdrop.show { display: block; }

      /* Comment popover ---------------------------------------------------- */
      .popover {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(400px, calc(100vw - 24px));
        max-height: calc(100vh - 24px);
        display: none;
        flex-direction: column;
        z-index: 4;
        overflow: hidden;
        background: var(--panel);
        border: 1px solid var(--text);
        border-radius: 10px;
        box-shadow: 0 12px 32px rgba(22, 17, 13, .24);
        font-size: 13px;
      }
      .popover.show { display: flex; animation: jc-open .16s ease-out; }

      .pop-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--divider);
      }
      .pop-mark { flex: none; width: 22px; height: 22px; }
      .pop-mark svg { display: block; width: 22px; height: 22px; }
      .pop-titles { min-width: 0; flex: 1; }
      .pop-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.3; color: var(--text); }
      .pop-meta {
        font: 500 11px/1.4 ${FONT_MONO};
        color: var(--text-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pill {
        flex: none;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
        color: var(--pill-text);
        background: var(--pill-bg);
        border: 1px solid var(--pill-border);
        border-radius: 999px;
        padding: 3px 8px;
      }

      .pop-body { padding: 12px; overflow: auto; }
      .preview {
        display: block;
        max-width: 100%;
        max-height: 40vh;
        margin: 0 auto 10px;
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .selector {
        display: inline-flex;
        max-width: 100%;
        margin-bottom: 9px;
        font: 400 11px/1.45 ${FONT_MONO};
        color: var(--selector-text);
        background: var(--selector-bg);
        border: 1px solid var(--selector-border);
        border-radius: 5px;
        padding: 3px 7px;
      }
      .selector span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta {
        display: grid;
        grid-template-columns: max-content minmax(0, 1fr);
        gap: 2px 10px;
        margin: 0 0 10px;
        font: 400 11px/1.45 ${FONT_MONO};
      }
      .meta dt { color: var(--text-muted); }
      .meta dd { margin: 0; color: var(--text-code); word-break: break-all; }

      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      textarea {
        display: block;
        width: 100%;
        min-height: 88px;
        resize: vertical;
        margin: 0;
        padding: 8px 10px;
        font: 400 13px/1.55 ${FONT_SANS};
        color: var(--text-body);
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        outline: none;
        transition: border-color .12s ease-out;
      }
      textarea::placeholder { color: var(--text-muted); }
      textarea:focus { border-color: #FF5C1A; box-shadow: 0 0 0 3px var(--focus-ring-color); }

      .error {
        display: none;
        gap: 8px;
        align-items: flex-start;
        margin-top: 10px;
        padding: 7px 10px;
        font-size: 12px;
        line-height: 1.4;
        color: var(--error-text);
        background: var(--error-bg);
        border: 1px solid var(--error-border);
        border-radius: 6px;
      }
      .error.show { display: flex; }
      .error::before {
        content: "!";
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 999px;
        background: var(--error-border);
        color: #FFFFFF;
        font-weight: 600;
        font-size: 11px;
        line-height: 16px;
        text-align: center;
      }

      .pop-foot {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--panel-alt);
        border-top: 1px solid var(--divider);
      }
      .pop-foot .spacer { flex: 1; }
      .pop-foot .keys { display: flex; gap: 4px; align-items: center; }
      .pop-foot .keys kbd { background: var(--kbd-bg); color: var(--kbd-text); border: 1px solid var(--kbd-border); }

      button.btn {
        font: 500 12px/1.4 ${FONT_SANS};
        border-radius: 6px;
        padding: 7px 12px;
        cursor: pointer;
        transition: background .12s ease-out, border-color .12s ease-out, color .12s ease-out;
      }
      button.btn:focus-visible { outline: 3px solid var(--focus-ring-color); outline-offset: 2px; }
      button.btn:disabled { opacity: .6; cursor: default; }
      .btn-primary { color: #FFFFFF; background: var(--btn-primary-bg); border: 1px solid var(--btn-primary-bg); }
      .btn-primary:hover:not(:disabled) { background: var(--btn-primary-hover); border-color: var(--btn-primary-hover); }
      .btn-secondary { color: var(--btn-secondary-text); background: var(--btn-secondary-bg); border: 1px solid var(--btn-secondary-border); }
      .btn-secondary:hover:not(:disabled) { background: var(--btn-secondary-hover-bg); border-color: var(--text-muted); }

      @keyframes jc-open {
        from { opacity: 0; transform: translate(-50%, calc(-50% + 4px)); }
        to   { opacity: 1; transform: translate(-50%, -50%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .jc-root *, .popover.show { animation: none !important; transition: none !important; }
      }
    </style>

    <div class="jc-root">
      <div class="highlight">
        <div class="hl-label"><span class="hl-sel"></span><span class="hl-size"></span></div>
      </div>
      <canvas class="selection-canvas"></canvas>

      <button class="fab" type="button">
        <span class="fab-disc"></span>
        <span class="fab-label"></span>
        <span class="fab-hints"></span>
      </button>

      <div class="backdrop"></div>
      <div class="popover" role="dialog" aria-modal="true" aria-labelledby="jc-title">
        <div class="pop-head">
          <span class="pop-mark">${ICONS.mark}</span>
          <div class="pop-titles">
            <h2 id="jc-title" class="pop-title">Add comment</h2>
            <div class="pop-meta"></div>
          </div>
          <span class="pill"></span>
        </div>
        <div class="pop-body">
          <img class="preview" alt="Screenshot preview">
          <div class="selector"><span></span></div>
          <dl class="meta"></dl>
          <label class="sr-only" for="jc-comment">Comment</label>
          <textarea id="jc-comment"></textarea>
          <div class="error" role="alert"></div>
        </div>
        <div class="pop-foot">
          <button class="btn btn-primary save" type="button">Save</button>
          <button class="btn btn-secondary cancel" type="button">Cancel</button>
          <span class="spacer"></span>
          <span class="keys" aria-hidden="true"><kbd>Ctrl</kbd><kbd>Enter</kbd></span>
        </div>
      </div>
    </div>
  `;

  const ui = {
    highlight: shadow.querySelector(".highlight"),
    hlLabel: shadow.querySelector(".hl-label"),
    hlSel: shadow.querySelector(".hl-sel"),
    hlSize: shadow.querySelector(".hl-size"),
    selection: shadow.querySelector(".selection-canvas"),
    fab: shadow.querySelector(".fab"),
    fabDisc: shadow.querySelector(".fab-disc"),
    fabLabel: shadow.querySelector(".fab-label"),
    fabHints: shadow.querySelector(".fab-hints"),
    backdrop: shadow.querySelector(".backdrop"),
    dialog: shadow.querySelector(".popover"),
    meta: shadow.querySelector(".pop-meta"),
    pill: shadow.querySelector(".pill"),
    preview: shadow.querySelector(".preview"),
    selector: shadow.querySelector(".selector"),
    selectorText: shadow.querySelector(".selector span"),
    details: shadow.querySelector(".meta"),
    textarea: shadow.querySelector("textarea"),
    error: shadow.querySelector(".error"),
    save: shadow.querySelector(".save"),
    cancel: shadow.querySelector(".cancel")
  };
  const selectionCtx = ui.selection.getContext("2d");

  // Mode indicator content. Hints marked "opt" are dropped on narrow viewports.
  const FAB_CONTENT = {
    [MODE.COMMENT]: {
      icon: ICONS.comment,
      label: "Comment mode",
      hints: [{ key: "Esc", text: "exit" }],
      aria: "Comment mode active — click an element. Press to exit (Esc)."
    },
    [MODE.SCREENSHOT]: {
      icon: ICONS.screenshot,
      label: "Screenshot mode",
      hints: [
        { key: "Drag", text: "area", opt: true },
        { key: "Alt", text: "freeform", opt: true },
        { key: "Ctrl", text: "full page", opt: true },
        { key: "Esc", text: "exit" }
      ],
      aria: "Screenshot mode — drag to select (Alt: freeform, Ctrl+click: full page). Press to exit (Esc)."
    }
  };

  const PILL_TEXT = {
    [SELECTION.RECT]: "Area",
    [SELECTION.FREEFORM]: "Freeform",
    [SELECTION.FULL]: "Full page"
  };

  document.documentElement.appendChild(host);

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  // ---------------------------------------------------------------------------
  // CSS selector generation
  // Priority: id > tag + class combination > nth-child chain
  // ---------------------------------------------------------------------------
  function isUnique(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }

  function classSelector(el) {
    const classes = Array.from(el.classList)
      // Skipping hashed/state classes would help, but here we only drop
      // names that aren't valid in a CSS selector.
      .filter((c) => c && !/\s/.test(c))
      .map((c) => "." + CSS.escape(c));
    return classes.length ? classes.join("") : "";
  }

  /**
   * Builds a CSS selector that uniquely matches `el` in the current DOM.
   * @param {Element} el
   * @returns {string}
   */
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";

    // 1) Unique id wins.
    if (el.id) {
      const sel = "#" + CSS.escape(el.id);
      if (isUnique(sel)) return sel;
    }

    // 2) tag + classes, if unique.
    const tag = el.tagName.toLowerCase();
    const cls = classSelector(el);
    if (cls) {
      const sel = tag + cls;
      if (isUnique(sel)) return sel;
    }

    // 3) Walk towards the root building an nth-child chain.
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();

      if (node.id) {
        // A unique ancestor id lets us stop early.
        const idSel = "#" + CSS.escape(node.id);
        if (isUnique(idSel)) {
          parts.unshift(idSel);
          break;
        }
      }

      const nodeCls = classSelector(node);
      if (nodeCls) part += nodeCls;

      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        // Disambiguate same-tag siblings with nth-child.
        const sameKind = siblings.filter((s) => s.tagName === node.tagName);
        if (sameKind.length > 1) {
          part += `:nth-child(${siblings.indexOf(node) + 1})`;
        }
      }

      parts.unshift(part);

      const candidate = parts.join(" > ");
      if (isUnique(candidate)) return candidate;

      node = node.parentElement;
    }

    return parts.join(" > ") || tag;
  }

  /** Cheap label for the hover highlight (no DOM queries, runs on every mousemove). */
  function quickSelector(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = Array.from(el.classList)
      .slice(0, 2)
      .map((c) => "." + c)
      .join("");
    return tag + cls;
  }

  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: text.length > JC.MAX_TEXT_LEN ? text.slice(0, JC.MAX_TEXT_LEN) + "…" : text,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Inspector highlight
  // ---------------------------------------------------------------------------
  function placeHighlight(r) {
    const hl = ui.highlight;
    hl.style.display = "block";
    hl.style.left = r.left + "px";
    hl.style.top = r.top + "px";
    hl.style.width = r.width + "px";
    hl.style.height = r.height + "px";
  }

  /** Hover state: cyan outline plus a selector + size label kept inside the viewport. */
  function showHoverHighlight(el) {
    const r = el.getBoundingClientRect();
    ui.highlight.classList.remove("pinned");
    placeHighlight(r);

    ui.hlSel.textContent = quickSelector(el);
    ui.hlSize.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;

    // Above the element when there is room, otherwise below, otherwise inside.
    const LABEL_H = 22;
    let top = -26;
    if (r.top < LABEL_H + 8) {
      top = r.bottom + LABEL_H + 8 <= window.innerHeight ? r.height + 6 : 4;
    }
    ui.hlLabel.style.top = top + "px";

    const w = ui.hlLabel.offsetWidth;
    const left = clamp(r.left - 2, 12, Math.max(12, window.innerWidth - w - 12));
    ui.hlLabel.style.left = left - r.left + "px";
  }

  /** Committed anchor: dashed orange outline around the element being commented on. */
  function showPinnedHighlight(rect) {
    ui.highlight.classList.add("pinned");
    placeHighlight({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
  }

  function hideHighlight() {
    ui.highlight.style.display = "none";
    ui.highlight.classList.remove("pinned");
  }

  // ---------------------------------------------------------------------------
  // Screenshot-mode selection overlay
  // ---------------------------------------------------------------------------
  const MIN_SELECTION = 5; // px; smaller drags are treated as accidental clicks
  const FREEFORM_STEP = 2; // px between recorded freeform points

  function sizeSelectionCanvas() {
    const dpr = window.devicePixelRatio || 1;
    ui.selection.style.width = window.innerWidth + "px";
    ui.selection.style.height = window.innerHeight + "px";
    ui.selection.width = Math.round(window.innerWidth * dpr);
    ui.selection.height = Math.round(window.innerHeight * dpr);
    selectionCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Bounding box of the current selection in CSS pixels, clamped to the viewport. */
  function selectionBounds() {
    const pts = selectionType === SELECTION.FREEFORM ? points : [startPoint, endPoint];
    if (!pts.length || !pts[0]) return null;
    const xs = pts.map((p) => clamp(p.x, 0, window.innerWidth));
    const ys = pts.map((p) => clamp(p.y, 0, window.innerHeight));
    const x = Math.floor(Math.min(...xs));
    const y = Math.floor(Math.min(...ys));
    return {
      x,
      y,
      width: Math.ceil(Math.max(...xs)) - x,
      height: Math.ceil(Math.max(...ys)) - y
    };
  }

  /**
   * Builds a Path2D for the current selection.
   * @param {boolean} closed  Close the freeform path (for filling / final shape).
   */
  function selectionPath(closed) {
    const path = new Path2D();
    if (selectionType === SELECTION.RECT) {
      const b = selectionBounds();
      if (b) path.rect(b.x, b.y, b.width, b.height);
    } else if (selectionType === SELECTION.FREEFORM && points.length) {
      path.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) path.lineTo(points[i].x, points[i].y);
      if (closed) path.closePath();
    }
    return path;
  }

  /** Inspector-style label: selection type in white, size in light cyan. */
  function drawSizeLabel(b) {
    const ctx = selectionCtx;
    const kind = selectionType === SELECTION.FREEFORM ? "freeform" : "area";
    const size = `${b.width} × ${b.height}`;
    ctx.font = `400 11px ${FONT_MONO}`;
    const kindW = ctx.measureText(kind).width;
    const sizeW = ctx.measureText(size).width;
    const w = 7 + kindW + 6 + sizeW + 7;
    const h = 22;
    const x = clamp(b.x - 2, 12, window.innerWidth - w - 12);
    const y = b.y - h - 4 >= 12 ? b.y - h - 4 : Math.min(b.y + b.height + 6, window.innerHeight - h - 12);

    ctx.fillStyle = JC.CYAN_LABEL_BG;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(kind, x + 7, y + h / 2);
    ctx.fillStyle = JC.CYAN_LABEL_VALUE;
    ctx.fillText(size, x + 7 + kindW + 6, y + h / 2);
  }

  /** Draws the selection with the inspector treatment: cyan stroke and 12% cyan fill. */
  function drawSelection() {
    const ctx = selectionCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const b = selectionBounds();
    if (!b) return;

    ctx.fillStyle = JC.CYAN_FILL;
    ctx.fill(selectionPath(true));

    ctx.strokeStyle = JC.CYAN_STROKE;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(selectionPath(isDrawing ? false : true));

    if (b.width >= MIN_SELECTION && b.height >= MIN_SELECTION) drawSizeLabel(b);
  }

  function resetSelection() {
    isDrawing = false;
    selectionType = null;
    points = [];
    startPoint = null;
    endPoint = null;
    ui.selection.classList.remove("show");
    selectionCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function beginSelection(e) {
    const p = { x: e.clientX, y: e.clientY };

    if (e.ctrlKey || e.metaKey) {
      selectionType = SELECTION.FULL;
      captureSelection();
      return;
    }

    selectionType = e.altKey ? SELECTION.FREEFORM : SELECTION.RECT;
    isDrawing = true;
    startPoint = endPoint = p;
    points = [p];
    sizeSelectionCanvas();
    ui.selection.classList.add("show");
    drawSelection();
  }

  function updateSelection(e) {
    const p = { x: e.clientX, y: e.clientY };
    endPoint = p;
    if (selectionType === SELECTION.FREEFORM) {
      const last = points[points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < FREEFORM_STEP) return;
      points.push(p);
    }
    drawSelection();
  }

  function finishSelection(e) {
    updateSelection(e);
    isDrawing = false;
    const b = selectionBounds();
    if (!b || b.width < MIN_SELECTION || b.height < MIN_SELECTION) {
      resetSelection();
      return;
    }
    captureSelection();
  }

  // ---------------------------------------------------------------------------
  // Pointer handling: hover highlight, selection drawing, swallowing clicks
  // ---------------------------------------------------------------------------
  function swallowEvent(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  // Events aimed at our own UI (the mode indicator) are retargeted to the
  // shadow host; let them through so the button keeps working.
  function isOwnUi(e) {
    return e.target === host;
  }

  // Screenshot selection uses pointer events directly. Calling preventDefault
  // on pointerdown can suppress mousedown/mouseup/click in Chrome, so we
  // handle drag selection here instead of relying on mouse events.
  function onPointerDown(e) {
    if (!mode || dialogOpen || isOwnUi(e)) return;
    swallowEvent(e);
    if (busy || mode !== MODE.SCREENSHOT || e.button !== 0) return;
    beginSelection(e);
  }

  function onPointerMove(e) {
    if (!mode || dialogOpen || busy) return;

    if (mode === MODE.SCREENSHOT) {
      if (isDrawing) {
        swallowEvent(e);
        updateSelection(e);
      }
      return;
    }

    const el = e.target;
    if (isOwnUi(e) || !el || el.nodeType !== 1) {
      hideHighlight();
      return;
    }
    showHoverHighlight(el);
  }

  function onPointerUp(e) {
    if (!mode || dialogOpen) return;
    if (isOwnUi(e) && !isDrawing) return;
    swallowEvent(e);
    if (mode === MODE.SCREENSHOT && isDrawing) finishSelection(e);
  }

  function onClick(e) {
    if (!mode || dialogOpen || isOwnUi(e)) return;
    swallowEvent(e);
    if (busy || mode !== MODE.COMMENT) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    startCapture(el);
  }

  function onKeyDown(e) {
    if (!mode) return;
    if (e.key === "Escape") {
      if (isDrawing) {
        resetSelection();
      } else if (dialogOpen) {
        closeDialog();
      } else {
        setMode(null);
      }
      swallowEvent(e);
    } else if (e.key === "Alt" && mode === MODE.SCREENSHOT && !dialogOpen) {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    if (e.key === "Alt" && mode === MODE.SCREENSHOT && !dialogOpen) e.preventDefault();
  }

  // Swallow extra event types so the page's own handlers don't fire.
  function swallow(e) {
    if (!mode || dialogOpen || isOwnUi(e)) return;
    swallowEvent(e);
  }

  const SWALLOWED = ["mousedown", "mouseup", "dblclick", "contextmenu", "auxclick", "dragstart"];

  function renderFab() {
    const content = FAB_CONTENT[mode];
    if (!content) return;
    ui.fabDisc.innerHTML = content.icon;
    ui.fabLabel.textContent = content.label;
    ui.fabHints.textContent = "";
    for (const hint of content.hints) {
      const group = document.createElement("span");
      group.className = "hint-group" + (hint.opt ? " opt" : "");
      const kbd = document.createElement("kbd");
      kbd.textContent = hint.key;
      const text = document.createElement("span");
      text.className = "fab-hint";
      text.textContent = hint.text;
      group.append(kbd, text);
      ui.fabHints.appendChild(group);
    }
    ui.fab.setAttribute("aria-label", content.aria);
    ui.fab.title = content.aria;
  }

  function setMode(next) {
    resetSelection();
    mode = next;
    renderFab();
    ui.fab.classList.toggle("show", Boolean(mode));
    hideHighlight();
    document.documentElement.style.cursor = mode ? "crosshair" : "";
    if (!mode) closeDialog();
  }

  // The mode indicator doubles as the exit button.
  ui.fab.addEventListener("click", (e) => {
    e.stopPropagation();
    setMode(null);
  });

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("keyup", onKeyUp, true);
  SWALLOWED.forEach((type) => document.addEventListener(type, swallow, true));

  // ---------------------------------------------------------------------------
  // Capture + image processing
  // chrome.tabs.captureVisibleTab is the browser's own render output: pixel
  // accurate, independent of the page's CSP and needs no external library.
  // ---------------------------------------------------------------------------
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not decode screenshot."));
      img.src = dataUrl;
    });
  }

  /**
   * Hides our own UI, captures the visible viewport and restores the UI.
   * @returns {Promise<string>} Raw captureVisibleTab data URL.
   */
  async function captureViewport() {
    hideHighlight();
    ui.selection.classList.remove("show");
    ui.fab.classList.remove("show");
    const prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "";
    await nextFrame();

    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.CAPTURE_VISIBLE_TAB });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Capture failed.");
      return res.dataUrl;
    } finally {
      document.documentElement.style.cursor = prevCursor;
    }
  }

  /**
   * Downscales the captured image and outlines the clicked element on it.
   * @param {string} dataUrl  Raw captureVisibleTab output.
   * @param {{x:number,y:number,width:number,height:number}} rect  Element rect in CSS pixels.
   * @returns {Promise<string>} JPEG data URL.
   */
  async function annotate(dataUrl, rect) {
    const img = await loadImage(dataUrl);

    // The capture is scaled by the device pixel ratio; convert CSS px to image px.
    const pxRatio = img.width / window.innerWidth;

    // Downscale if needed to protect the storage quota.
    const scale = Math.min(1, JC.MAX_SHOT_WIDTH / img.width);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Orange outline with a thin ink edge so it reads on light and dark pages.
    const k = pxRatio * scale;
    const lw = Math.max(2, Math.round(3 * scale * (pxRatio || 1)));
    const x = rect.x * k;
    const y = rect.y * k;
    const w = Math.max(rect.width * k, 2);
    const h = Math.max(rect.height * k, 2);
    ctx.strokeStyle = JC.INK_COLOR;
    ctx.lineWidth = lw + 2;
    ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = JC.ACCENT_COLOR;
    ctx.lineWidth = lw;
    ctx.strokeRect(x, y, w, h);

    return canvas.toDataURL("image/jpeg", 0.8);
  }

  /**
   * Crops the captured viewport to `bounds`. For freeform selections, the
   * area outside the drawn shape is dimmed and the shape is outlined.
   * @param {string} fullDataUrl  Raw captureVisibleTab output.
   * @param {{x:number,y:number,width:number,height:number}} bounds  CSS pixels.
   * @param {{x:number,y:number}[]|null} freeformPath  Shape points in CSS pixels, or null.
   * @returns {Promise<string>} JPEG data URL.
   */
  async function cropScreenshot(fullDataUrl, bounds, freeformPath) {
    const img = await loadImage(fullDataUrl);
    const pxRatio = img.width / window.innerWidth;

    const sx = bounds.x * pxRatio;
    const sy = bounds.y * pxRatio;
    const sw = Math.min(bounds.width * pxRatio, img.width - sx);
    const sh = Math.min(bounds.height * pxRatio, img.height - sy);
    const scale = Math.min(1, JC.MAX_SHOT_WIDTH / sw);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

    if (freeformPath && freeformPath.length > 2) {
      const k = pxRatio * scale;
      const shape = new Path2D();
      freeformPath.forEach((p, i) => {
        const x = (p.x - bounds.x) * k;
        const y = (p.y - bounds.y) * k;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
      shape.closePath();

      const outside = new Path2D();
      outside.rect(0, 0, canvas.width, canvas.height);
      outside.addPath(shape);
      ctx.fillStyle = JC.SELECTION_DIM;
      ctx.fill(outside, "evenodd");

      ctx.strokeStyle = JC.ACCENT_COLOR;
      ctx.lineWidth = Math.max(2, Math.round(2 * k));
      ctx.lineJoin = "round";
      ctx.stroke(shape);
    }

    return canvas.toDataURL("image/jpeg", 0.85);
  }

  /**
   * Comment mode: captures the viewport, outlines `el` and opens the dialog.
   * @param {Element} el
   */
  async function startCapture(el) {
    const info = describeElement(el);
    busy = true;

    let screenshot = null;
    let captureError = null;
    try {
      screenshot = await annotate(await captureViewport(), info.rect);
    } catch (err) {
      captureError = JC.getErrorMessage(err);
    }

    busy = false;
    showPinnedHighlight(info.rect);
    openDialog({ info, screenshot, captureError, mode: MODE.COMMENT, selection: null });
  }

  /** Screenshot mode: captures and crops the current selection, then opens the dialog. */
  async function captureSelection() {
    const type = selectionType;
    const bounds =
      type === SELECTION.FULL
        ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }
        : selectionBounds();
    const path = type === SELECTION.FREEFORM ? points.slice() : null;
    resetSelection();
    busy = true;

    let screenshot = null;
    let captureError = null;
    try {
      screenshot = await cropScreenshot(await captureViewport(), bounds, path);
    } catch (err) {
      captureError = JC.getErrorMessage(err);
    }

    busy = false;
    openDialog({
      info: null,
      screenshot,
      captureError,
      mode: MODE.SCREENSHOT,
      selection: { type, rect: bounds }
    });
  }

  // ---------------------------------------------------------------------------
  // Comment popover
  // ---------------------------------------------------------------------------
  let pending = null;

  function showError(message) {
    ui.error.textContent = message || "";
    ui.error.classList.toggle("show", Boolean(message));
  }

  function renderDetails(info) {
    ui.details.textContent = "";
    if (!info) {
      ui.selector.style.display = "none";
      ui.details.style.display = "none";
      return;
    }
    ui.selectorText.textContent = info.selector;
    ui.selector.title = info.selector;
    ui.selector.style.display = "";

    const rows = [
      ["tag:", `<${info.tagName}>`],
      ["class:", info.classes.length ? info.classes.join(" ") : "—"],
      ["text:", info.text || "—"],
      ["position:", `${info.rect.x},${info.rect.y} · ${info.rect.width}×${info.rect.height}`]
    ];
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      ui.details.append(dt, dd);
    }
    ui.details.style.display = "";
  }

  function openDialog({ info, screenshot, captureError, mode: recordMode, selection }) {
    pending = { info, screenshot, mode: recordMode, selection };
    dialogOpen = true;

    ui.meta.textContent = `${window.innerWidth}×${window.innerHeight} · ${location.host}`;
    ui.pill.textContent = info ? "Element" : PILL_TEXT[selection && selection.type] || "Screenshot";
    ui.textarea.placeholder = info
      ? "Your comment about this component..."
      : "Your comment about this area...";

    if (screenshot) {
      ui.preview.src = screenshot;
      ui.preview.style.display = "block";
    } else {
      ui.preview.removeAttribute("src");
      ui.preview.style.display = "none";
    }

    renderDetails(info);
    ui.textarea.value = "";
    showError(
      captureError
        ? `Could not take screenshot (${captureError}). You can save the comment without it.`
        : ""
    );

    // The mode indicator would overlap the popover on short viewports.
    ui.fab.classList.remove("show");
    ui.backdrop.classList.add("show");
    ui.dialog.classList.add("show");
    ui.textarea.focus();
  }

  function closeDialog() {
    dialogOpen = false;
    pending = null;
    hideHighlight();
    ui.backdrop.classList.remove("show");
    ui.dialog.classList.remove("show");
    ui.preview.removeAttribute("src");
    if (mode) ui.fab.classList.add("show");
  }

  async function saveComment() {
    if (!pending || ui.save.disabled) return;
    const comment = ui.textarea.value.trim();
    if (!comment) {
      showError("Please enter a comment.");
      ui.textarea.focus();
      return;
    }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      mode: pending.mode,
      pageUrl: location.href,
      pageTitle: document.title,
      element: pending.info, // null in screenshot mode
      selection: pending.selection, // null in comment mode
      screenshot: pending.screenshot, // base64 data URL or null
      comment
    };

    ui.save.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: MSG.SAVE_COMMENT, record });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Save failed.");
      closeDialog();
    } catch (err) {
      // Quota errors land here; ask the user to export and clear.
      showError(
        `Save failed: ${JC.getErrorMessage(err)} (Storage may be full — download the report and clear the list.)`
      );
    } finally {
      ui.save.disabled = false;
    }
  }

  ui.cancel.addEventListener("click", closeDialog);
  ui.backdrop.addEventListener("click", closeDialog);
  ui.save.addEventListener("click", saveComment);

  // Focus trap (textarea → Save → Cancel) and Ctrl/Cmd+Enter to save.
  ui.dialog.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveComment();
    } else if (e.key === "Tab") {
      const focusables = [ui.textarea, ui.save, ui.cancel];
      const idx = focusables.indexOf(shadow.activeElement);
      const next = e.shiftKey
        ? focusables[(idx - 1 + focusables.length) % focusables.length]
        : focusables[(idx + 1) % focusables.length];
      e.preventDefault();
      next.focus();
    }
    // Keep typing from reaching the page's bubble-phase shortcuts.
    if (e.key !== "Escape") e.stopPropagation();
  });

  // Clicks inside the dialog must not leak to the page.
  ui.dialog.addEventListener("click", (e) => e.stopPropagation());

  // ---------------------------------------------------------------------------
  // Messaging with the service worker
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === MSG.PING) {
      sendResponse({ ok: true, mode });
      return false;
    }
    // Modes are mutually exclusive: toggling the active one turns it off,
    // toggling the other one switches over.
    if (msg.type === MSG.TOGGLE_COMMENT_MODE) {
      setMode(mode === MODE.COMMENT ? null : MODE.COMMENT);
      sendResponse({ mode });
      return false;
    }
    if (msg.type === MSG.TOGGLE_SCREENSHOT_MODE) {
      setMode(mode === MODE.SCREENSHOT ? null : MODE.SCREENSHOT);
      sendResponse({ mode });
      return false;
    }
    return false;
  });
})();
