// Content script — yorum modu arayüzü.
// Sayfaya yalnızca tek bir host element ekler, geri kalan her şey shadow DOM
// içinde yaşar. Hiçbir ağ isteği yapmaz.
//
// Not: bu dosya aynı sekmeye birden fazla kez enjekte edilebilir
// (service worker uykuya dalıp uyanabilir), bu yüzden tüm kod idempotent
// olacak şekilde bir guard içine alınmıştır.

(() => {
  if (window.__yorumToplayiciYuklendi__) return;
  window.__yorumToplayiciYuklendi__ = true;

  const HOST_ID = "__yorum_toplayici_host__";
  const MAX_TEXT_LEN = 160;
  const MAX_SHOT_WIDTH = 1400; // storage kotasını korumak için üst sınır

  let active = false;
  let hoveredEl = null;
  let dialogOpen = false;

  // ---------------------------------------------------------------------------
  // Shadow DOM arayüzü
  // ---------------------------------------------------------------------------
  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
          "Segoe UI", Roboto, Arial, sans-serif; }

      .highlight {
        position: fixed;
        pointer-events: none;
        border: 2px solid #e11d48;
        background: rgba(225, 29, 72, 0.08);
        border-radius: 2px;
        display: none;
        z-index: 1;
      }

      .badge {
        position: fixed;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: #e11d48;
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 12px;
        border-radius: 999px;
        display: none;
        z-index: 2;
        box-shadow: 0 2px 8px rgba(0,0,0,.25);
      }

      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, .45);
        display: none;
        z-index: 3;
      }

      .dialog {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(460px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        overflow: auto;
        background: #fff;
        color: #0f172a;
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,.35);
        padding: 16px;
        display: none;
        z-index: 4;
      }
      .dialog h2 { margin: 0 0 10px; font-size: 15px; }
      .dialog img.preview {
        width: 100%;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        display: block;
        margin-bottom: 10px;
      }
      .meta {
        font-size: 11px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: #475569;
        background: #f1f5f9;
        border-radius: 6px;
        padding: 8px;
        margin-bottom: 10px;
        word-break: break-all;
        white-space: pre-wrap;
      }
      .dialog textarea {
        width: 100%;
        min-height: 90px;
        resize: vertical;
        font-size: 13px;
        padding: 8px;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        color: #0f172a;
        background: #fff;
      }
      .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
      button {
        font-size: 13px;
        padding: 7px 14px;
        border-radius: 6px;
        border: 1px solid transparent;
        cursor: pointer;
      }
      .save { background: #e11d48; color: #fff; }
      .cancel { background: #fff; color: #334155; border-color: #cbd5e1; }
      .error { color: #b91c1c; font-size: 12px; margin-top: 8px; display: none; }
    </style>

    <div class="highlight"></div>
    <div class="badge">Yorum modu açık — bir komponente tıkla (kapatmak için Esc)</div>
    <div class="backdrop"></div>
    <div class="dialog" role="dialog" aria-modal="true">
      <h2>Yorum ekle</h2>
      <img class="preview" alt="Ekran görüntüsü önizlemesi">
      <div class="meta"></div>
      <textarea placeholder="Bu komponentle ilgili yorumun..."></textarea>
      <div class="error"></div>
      <div class="row">
        <button class="cancel" type="button">Vazgeç</button>
        <button class="save" type="button">Kaydet</button>
      </div>
    </div>
  `;

  const ui = {
    highlight: shadow.querySelector(".highlight"),
    badge: shadow.querySelector(".badge"),
    backdrop: shadow.querySelector(".backdrop"),
    dialog: shadow.querySelector(".dialog"),
    preview: shadow.querySelector(".preview"),
    meta: shadow.querySelector(".meta"),
    textarea: shadow.querySelector("textarea"),
    error: shadow.querySelector(".error"),
    save: shadow.querySelector(".save"),
    cancel: shadow.querySelector(".cancel")
  };

  document.documentElement.appendChild(host);

  // ---------------------------------------------------------------------------
  // ÖZELLİK 2 — CSS selector üretimi
  // Öncelik sırası: id > tag + class kombinasyonu > nth-child zinciri
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
      // Rastgele/hash üretilmiş ve durum bildiren sınıfları atlamak faydalı olur,
      // ancak burada sadece CSS'te geçerli olmayanları eliyoruz.
      .filter((c) => c && !/\s/.test(c))
      .map((c) => "." + CSS.escape(c));
    return classes.length ? classes.join("") : "";
  }

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";

    // 1) id benzersizse doğrudan kullan
    if (el.id) {
      const sel = "#" + CSS.escape(el.id);
      if (isUnique(sel)) return sel;
    }

    // 2) tag + class kombinasyonu benzersizse kullan
    const tag = el.tagName.toLowerCase();
    const cls = classSelector(el);
    if (cls) {
      const sel = tag + cls;
      if (isUnique(sel)) return sel;
    }

    // 3) nth-child zinciri ile köke doğru yürü
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();

      if (node.id) {
        // Ata zincirinde benzersiz bir id bulursak orada durabiliriz.
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
        // Aynı seçiciye uyan kardeş varsa nth-child ile ayrıştır.
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

  function describeElement(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    return {
      selector: buildSelector(el),
      tagName: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.from(el.classList),
      text: text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) + "…" : text,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  // ---------------------------------------------------------------------------
  // ÖZELLİK 1 — hover highlight + tıklamayı yutma
  // ---------------------------------------------------------------------------
  function onMouseMove(e) {
    if (!active || dialogOpen) return;
    const el = e.target;
    if (!el || el === host || el.nodeType !== 1) return;
    hoveredEl = el;
    const r = el.getBoundingClientRect();
    ui.highlight.style.display = "block";
    ui.highlight.style.left = r.left + "px";
    ui.highlight.style.top = r.top + "px";
    ui.highlight.style.width = r.width + "px";
    ui.highlight.style.height = r.height + "px";
  }

  // Sayfanın kendi davranışını tetiklemeyecek şekilde tüm işaretçi olaylarını
  // capture fazında yutuyoruz.
  function swallow(e) {
    if (!active || dialogOpen) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (!active || dialogOpen) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const el = e.target;
    if (!el || el === host || el.nodeType !== 1) return;
    startCapture(el);
  }

  function onKeyDown(e) {
    if (!active) return;
    if (e.key === "Escape") {
      if (dialogOpen) {
        closeDialog();
      } else {
        setActive(false);
      }
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const SWALLOWED = ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick", "contextmenu"];

  function setActive(next) {
    active = next;
    ui.badge.style.display = active ? "block" : "none";
    ui.highlight.style.display = "none";
    document.documentElement.style.cursor = active ? "crosshair" : "";
    if (!active) closeDialog();
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  SWALLOWED.forEach((type) => document.addEventListener(type, swallow, true));

  // ---------------------------------------------------------------------------
  // ÖZELLİK 3 — ekran görüntüsü + kırmızı işaret kutusu
  // chrome.tabs.captureVisibleTab kullanıyoruz: tarayıcının kendi render
  // çıktısı olduğu için piksel doğru, sayfanın CSP'sinden bağımsız ve
  // hiçbir harici kütüphane gerektirmiyor.
  // ---------------------------------------------------------------------------
  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Ekran görüntüsü çözümlenemedi."));
      img.src = dataUrl;
    });
  }

  // Yakalanan görüntü üzerine tıklanan elemanı kırmızı kutuyla işaretler.
  async function annotate(dataUrl, rect) {
    const img = await loadImage(dataUrl);

    // captureVisibleTab görüntüsü cihazın piksel oranıyla ölçeklidir;
    // CSS piksellerinden görüntü piksellerine çeviriyoruz.
    const pxRatio = img.width / window.innerWidth;

    // Kotayı korumak için gerekirse küçültüyoruz.
    const scale = Math.min(1, MAX_SHOT_WIDTH / img.width);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const k = pxRatio * scale;
    ctx.strokeStyle = "#e11d48";
    ctx.lineWidth = Math.max(2, Math.round(3 * scale * (pxRatio || 1)));
    ctx.strokeRect(
      rect.x * k,
      rect.y * k,
      Math.max(rect.width * k, 2),
      Math.max(rect.height * k, 2)
    );

    return canvas.toDataURL("image/jpeg", 0.8);
  }

  async function startCapture(el) {
    const info = describeElement(el);

    // Kendi arayüzümüz görüntüye karışmasın.
    ui.highlight.style.display = "none";
    const prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "";
    ui.badge.style.display = "none";
    await nextFrame();

    let screenshot = null;
    let captureError = null;
    try {
      const res = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Yakalama başarısız.");
      screenshot = await annotate(res.dataUrl, info.rect);
    } catch (err) {
      captureError = String(err && err.message ? err.message : err);
    }

    document.documentElement.style.cursor = prevCursor;
    ui.badge.style.display = "block";

    openDialog(info, screenshot, captureError);
  }

  // ---------------------------------------------------------------------------
  // ÖZELLİK 4 — yorum girişi
  // ---------------------------------------------------------------------------
  let pending = null;

  function openDialog(info, screenshot, captureError) {
    pending = { info, screenshot };
    dialogOpen = true;

    if (screenshot) {
      ui.preview.src = screenshot;
      ui.preview.style.display = "block";
    } else {
      ui.preview.removeAttribute("src");
      ui.preview.style.display = "none";
    }

    ui.meta.textContent =
      `selector: ${info.selector}\n` +
      `etiket:   <${info.tagName}>\n` +
      `class:    ${info.classes.length ? info.classes.join(" ") : "—"}\n` +
      `metin:    ${info.text || "—"}\n` +
      `konum:    ${info.rect.x},${info.rect.y} · ${info.rect.width}×${info.rect.height}`;

    ui.textarea.value = "";
    ui.error.style.display = captureError ? "block" : "none";
    ui.error.textContent = captureError
      ? "Ekran görüntüsü alınamadı (" + captureError + "). Yorumu görüntüsüz kaydedebilirsin."
      : "";

    ui.backdrop.style.display = "block";
    ui.dialog.style.display = "block";
    ui.textarea.focus();
  }

  function closeDialog() {
    dialogOpen = false;
    pending = null;
    ui.backdrop.style.display = "none";
    ui.dialog.style.display = "none";
    ui.preview.removeAttribute("src");
  }

  ui.cancel.addEventListener("click", closeDialog);
  ui.backdrop.addEventListener("click", closeDialog);

  ui.save.addEventListener("click", async () => {
    if (!pending) return;
    const comment = ui.textarea.value.trim();
    if (!comment) {
      ui.error.style.display = "block";
      ui.error.textContent = "Lütfen bir yorum yaz.";
      return;
    }

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      pageUrl: location.href,
      pageTitle: document.title,
      element: pending.info,
      screenshot: pending.screenshot, // base64 data URL ya da null
      comment
    };

    ui.save.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "SAVE_COMMENT", record });
      if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Kaydedilemedi.");
      closeDialog();
    } catch (err) {
      ui.error.style.display = "block";
      // Kota aşımı buraya düşer; kullanıcıya rapor indirip temizlemesini söylüyoruz.
      ui.error.textContent =
        "Kaydedilemedi: " + String(err && err.message ? err.message : err) +
        " (Depolama dolmuş olabilir — raporu indirip listeyi temizle.)";
    } finally {
      ui.save.disabled = false;
    }
  });

  // Dialog içindeki tıklamalar sayfaya sızmasın.
  ui.dialog.addEventListener("click", (e) => e.stopPropagation());

  // ---------------------------------------------------------------------------
  // Background ile iletişim
  // ---------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PING") {
      sendResponse({ ok: true, active });
      return false;
    }
    if (msg.type === "TOGGLE_COMMENT_MODE") {
      setActive(!active);
      sendResponse({ active });
      return false;
    }
    return false;
  });
})();
