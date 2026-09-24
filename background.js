// Service worker (MV3).
// Görevleri:
//  1) Aktif sekmeye content script'i enjekte edip yorum modunu aç/kapat.
//  2) Content script'ten gelen istek üzerine görünür alanın ekran görüntüsünü almak.
// Burada hiçbir fetch/XHR yoktur ve hiçbir veri dışarı gönderilmez.

const STORAGE_KEY = "comments";

// Content script'in o sekmeye enjekte edilip edilmediğini takip eder.
// Service worker uykuya dalarsa bu set sıfırlanır; bu yüzden aşağıda
// önce ping atıp gerçekten yaşıyor mu diye kontrol ediyoruz.
async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "PING" });
    if (pong && pong.ok) return true;
  } catch (e) {
    // Henüz enjekte edilmemiş; aşağıda enjekte edeceğiz.
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  return true;
}

// Popup'tan gelen "yorum modunu aç/kapat" isteği.
async function toggleCommentMode(tabId) {
  await ensureContentScript(tabId);
  const res = await chrome.tabs.sendMessage(tabId, { type: "TOGGLE_COMMENT_MODE" });
  return res; // { active: true|false }
}

// Görünür alanın ekran görüntüsü. Content script'ten çağrılır.
// JPEG + kalite 80 kullanıyoruz; PNG base64 chrome.storage.local kotasını
// (10 MB) çok hızlı doldurur.
async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
}

async function addComment(record) {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const list = Array.isArray(data[STORAGE_KEY]) ? data[STORAGE_KEY] : [];
  list.push(record);
  // Üzerine yazmadan listeye ekleniyor.
  await chrome.storage.local.set({ [STORAGE_KEY]: list });
  return list.length;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "TOGGLE_FROM_POPUP": {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tab || !tab.id) throw new Error("Aktif sekme bulunamadı.");
          if (!/^https?:/i.test(tab.url || "")) {
            throw new Error(
              "Bu sayfada çalışamaz (chrome://, Web Store ve dosya sayfaları hariç tutulur)."
            );
          }
          const res = await toggleCommentMode(tab.id);
          sendResponse({ ok: true, ...res });
          break;
        }

        case "CAPTURE_VISIBLE_TAB": {
          // sender.tab.windowId — capture her zaman isteği yapan sekmenin penceresinden.
          const dataUrl = await captureVisibleTab(sender.tab.windowId);
          sendResponse({ ok: true, dataUrl });
          break;
        }

        case "SAVE_COMMENT": {
          const count = await addComment(msg.record);
          sendResponse({ ok: true, count });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Bilinmeyen mesaj tipi: " + msg.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  })();

  // Asenkron yanıt vereceğimizi Chrome'a bildirir.
  return true;
});
