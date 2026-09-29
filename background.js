// Service worker (MV3).
// Responsibilities:
//  1) Inject the content script into the active tab and toggle comment /
//     screenshot mode.
//  2) Capture the visible area of the tab on request from the content script.
//  3) Append saved comments to chrome.storage.local.
// There is no fetch/XHR here and no data ever leaves the machine.

importScripts("constants.js");

/**
 * Makes sure the content script is alive in the tab, injecting it if needed.
 * The worker may have been restarted, so we ping first instead of keeping
 * an in-memory set of injected tabs.
 * @param {number} tabId
 * @returns {Promise<boolean>}
 */
async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: JC.MSG.PING });
    if (pong && pong.ok) return true;
  } catch (e) {
    // Not injected yet; inject below.
  }

  await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["constants.js", "content.js"] });
  return true;
}

/**
 * Forwards a toggle message to the active tab's content script.
 * @param {string} contentMessageType  JC.MSG.TOGGLE_COMMENT_MODE or JC.MSG.TOGGLE_SCREENSHOT_MODE
 * @returns {Promise<{mode: string|null}>}
 */
async function toggleModeInActiveTab(contentMessageType) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab found.");
  if (!/^https?:/i.test(tab.url || "")) {
    throw new Error("Cannot work on this page (chrome://, Web Store and file pages are excluded).");
  }
  await ensureContentScript(tab.id);
  return chrome.tabs.sendMessage(tab.id, { type: contentMessageType });
}

// Visible-area screenshot, requested by the content script.
// JPEG at quality 80: PNG base64 fills the chrome.storage.local quota (10 MB) quickly.
async function captureVisibleTab(windowId) {
  return chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
}

async function addComment(record) {
  const data = await chrome.storage.local.get(JC.STORAGE_KEY);
  const list = Array.isArray(data[JC.STORAGE_KEY]) ? data[JC.STORAGE_KEY] : [];
  list.push(record);
  await chrome.storage.local.set({ [JC.STORAGE_KEY]: list });
  return list.length;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case JC.MSG.TOGGLE_FROM_POPUP: {
          const res = await toggleModeInActiveTab(JC.MSG.TOGGLE_COMMENT_MODE);
          sendResponse({ ok: true, ...res });
          break;
        }

        case JC.MSG.TOGGLE_SCREENSHOT_MODE: {
          const res = await toggleModeInActiveTab(JC.MSG.TOGGLE_SCREENSHOT_MODE);
          sendResponse({ ok: true, ...res });
          break;
        }

        case JC.MSG.CAPTURE_VISIBLE_TAB: {
          // Always capture the window of the tab that asked.
          const dataUrl = await captureVisibleTab(sender.tab.windowId);
          sendResponse({ ok: true, dataUrl });
          break;
        }

        case JC.MSG.SAVE_COMMENT: {
          const count = await addComment(msg.record);
          sendResponse({ ok: true, count });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type: " + msg.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: JC.getErrorMessage(err) });
    }
  })();

  // Tells Chrome we will respond asynchronously.
  return true;
});
