// Popup — yorum listesi, rapor indirme, temizleme.
// Hiçbir ağ isteği yok; veri yalnızca chrome.storage.local'den okunur.

const STORAGE_KEY = "comments";

const els = {
  toggle: document.getElementById("toggle"),
  status: document.getElementById("status"),
  count: document.getElementById("count"),
  list: document.getElementById("list"),
  download: document.getElementById("download"),
  clear: document.getElementById("clear")
};

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

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString("tr-TR");
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------
async function render() {
  const comments = await getComments();
  els.count.textContent = `${comments.length} yorum`;
  els.download.disabled = comments.length === 0;
  els.clear.disabled = comments.length === 0;
  els.list.textContent = "";

  if (comments.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Henüz yorum yok.";
    els.list.appendChild(empty);
    return;
  }

  // En yeni üstte.
  for (const c of [...comments].reverse()) {
    const li = document.createElement("li");

    const img = document.createElement("img");
    if (c.screenshot) img.src = c.screenshot;
    img.alt = "";
    li.appendChild(img);

    const body = document.createElement("div");
    body.className = "body";

    const p = document.createElement("p");
    p.className = "comment";
    p.textContent = c.comment;
    body.appendChild(p);

    const sel = document.createElement("div");
    sel.className = "sel";
    sel.textContent = c.element ? c.element.selector : "";
    body.appendChild(sel);

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = `${formatDate(c.createdAt)} · ${c.pageUrl}`;
    url.title = c.pageUrl;
    body.appendChild(url);

    li.appendChild(body);
    els.list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Yorum modu aç/kapat
// ---------------------------------------------------------------------------
async function refreshToggleLabel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/i.test(tab.url || "")) {
      els.toggle.disabled = true;
      showStatus("Bu sayfada çalışılamaz. http(s) bir site aç.");
      return;
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    setToggleState(Boolean(res && res.active));
  } catch (e) {
    // Content script henüz enjekte edilmemiş — normal durum.
    setToggleState(false);
  }
}

function setToggleState(active) {
  els.toggle.textContent = active ? "Yorum modunu kapat" : "Yorum modunu aç";
  els.toggle.classList.toggle("on", active);
}

els.toggle.addEventListener("click", async () => {
  clearStatus();
  els.toggle.disabled = true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "TOGGLE_FROM_POPUP" });
    if (!res || !res.ok) throw new Error(res && res.error ? res.error : "Bilinmeyen hata.");
    setToggleState(res.active);
    if (res.active) {
      showStatus("Yorum modu açıldı. Bu pencereyi kapatıp sayfada bir komponente tıkla.", true);
    }
  } catch (err) {
    showStatus("Açılamadı: " + String(err && err.message ? err.message : err));
  } finally {
    els.toggle.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// ÖZELLİK 5 — self-contained HTML rapor
// ---------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReportHtml(comments) {
  const generatedAt = new Date().toLocaleString("tr-TR");

  const items = comments
    .map((c, i) => {
      const el = c.element || {};
      const shot = c.screenshot
        ? `<img src="${escapeHtml(c.screenshot)}" alt="Ekran görüntüsü ${i + 1}">`
        : `<div class="noshot">Ekran görüntüsü alınamamış.</div>`;
      const classes = Array.isArray(el.classes) && el.classes.length ? el.classes.join(" ") : "—";
      const rect = el.rect
        ? `${el.rect.x},${el.rect.y} · ${el.rect.width}×${el.rect.height}`
        : "—";

      return `
    <article class="item">
      <div class="num">#${i + 1}</div>
      <div class="shot">${shot}</div>
      <div class="info">
        <p class="comment">${escapeHtml(c.comment)}</p>
        <dl>
          <dt>Selector</dt><dd class="mono sel">${escapeHtml(el.selector || "—")}</dd>
          <dt>Element</dt><dd class="mono">&lt;${escapeHtml(el.tagName || "?")}&gt;${
            el.id ? " #" + escapeHtml(el.id) : ""
          }</dd>
          <dt>Class</dt><dd class="mono">${escapeHtml(classes)}</dd>
          <dt>Metin</dt><dd>${escapeHtml(el.text || "—")}</dd>
          <dt>Konum</dt><dd class="mono">${escapeHtml(rect)}</dd>
          <dt>Sayfa</dt><dd class="url">${escapeHtml(c.pageUrl || "—")}</dd>
          <dt>Tarih</dt><dd>${escapeHtml(formatDate(c.createdAt))}</dd>
        </dl>
      </div>
    </article>`;
    })
    .join("\n");

  // Tamamen kendi kendine yeten dosya: harici CSS/JS/görsel yok.
  return `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Test Yorumları Raporu</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #0f172a; background: #f8fafc; line-height: 1.5;
  }
  .wrap { max-width: 980px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 13px; margin: 0 0 20px; }
  .item {
    display: grid;
    grid-template-columns: 40px minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .num { font-weight: 700; color: #e11d48; font-size: 13px; }
  .shot img { width: 100%; border: 1px solid #e2e8f0; border-radius: 6px; display: block; }
  .noshot {
    padding: 24px; text-align: center; color: #94a3b8; font-size: 12px;
    border: 1px dashed #cbd5e1; border-radius: 6px;
  }
  .comment { font-size: 14px; margin: 0 0 12px; white-space: pre-wrap; }
  dl { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 4px 10px; margin: 0; font-size: 12px; }
  dt { color: #64748b; }
  dd { margin: 0; word-break: break-word; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
  .sel { color: #e11d48; }
  .url { font-size: 11px; color: #475569; word-break: break-all; }
  footer { color: #94a3b8; font-size: 11px; text-align: center; margin-top: 20px; }
  @media (max-width: 760px) { .item { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>Test Yorumları Raporu</h1>
  <p class="sub">${comments.length} yorum · oluşturulma: ${escapeHtml(generatedAt)}</p>
${items}
  <footer>Bu dosya kendi kendine yeterlidir; tüm görseller gömülüdür ve harici bağlantı içermez.</footer>
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
    if (comments.length === 0) throw new Error("İndirilecek yorum yok.");

    const html = buildReportHtml(comments);
    const blob = new Blob([html], { type: "text/html" });
    objectUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: objectUrl,
      filename: `test-yorumlari-${timestampForFilename()}.html`,
      saveAs: true
    });

    showStatus("Rapor indirildi.", true);
  } catch (err) {
    showStatus("Rapor oluşturulamadı: " + String(err && err.message ? err.message : err));
  } finally {
    // İndirme başladıktan sonra blob'u serbest bırak.
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
    els.download.disabled = false;
    render();
  }
});

// ---------------------------------------------------------------------------
// Temizleme
// ---------------------------------------------------------------------------
els.clear.addEventListener("click", async () => {
  clearStatus();
  const comments = await getComments();
  if (!confirm(`${comments.length} yorumun tamamı silinsin mi? Bu işlem geri alınamaz.`)) return;
  await chrome.storage.local.remove(STORAGE_KEY);
  showStatus("Tüm yorumlar silindi.", true);
  render();
});

// Başka bir sekmede yorum kaydedilirse liste canlı güncellensin.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEY]) render();
});

refreshToggleLabel();
render();
