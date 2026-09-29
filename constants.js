// Shared constants and helpers.
// Loaded by the service worker (importScripts), the popup (<script>) and the
// content script (chrome.scripting.executeScript), so it must not rely on
// DOM or worker-only APIs at load time.

(() => {
  const JC = {
    STORAGE_KEY: "comments",
    HOST_ID: "__just_comment_host__",

    // Upper bound for stored screenshot width, protects the storage quota.
    MAX_SHOT_WIDTH: 1400,
    MAX_TEXT_LEN: 160,

    // Design-system colors used on canvases (screenshot annotation, selection
    // overlay). Canvas drawing can't read CSS custom properties.
    ACCENT_COLOR: "#FF5C1A", // Orange 500
    INK_COLOR: "#16110D", // Ink 900
    CYAN_STROKE: "#22C5DE", // Cyan 400, inspector stroke
    CYAN_FILL: "rgba(34, 197, 222, 0.12)", // the one permitted overlay fill
    CYAN_LABEL_BG: "#0E7C90", // Cyan 700
    CYAN_LABEL_VALUE: "#9EE8F5",
    // Dims the area outside a freeform shape inside the saved image.
    SELECTION_DIM: "rgba(22, 17, 13, 0.55)",

    // Bundled fonts (fonts/). Registered under private family names in the
    // content script so they can't collide with the host page's fonts.
    FONTS: [
      { family: "JC Plex Sans", weight: "400", file: "fonts/ibm-plex-sans-latin-400-normal.woff2" },
      { family: "JC Plex Sans", weight: "500", file: "fonts/ibm-plex-sans-latin-500-normal.woff2" },
      { family: "JC Plex Sans", weight: "600", file: "fonts/ibm-plex-sans-latin-600-normal.woff2" },
      { family: "JC Plex Mono", weight: "400", file: "fonts/ibm-plex-mono-latin-400-normal.woff2" },
      { family: "JC Plex Mono", weight: "500", file: "fonts/ibm-plex-mono-latin-500-normal.woff2" }
    ],

    MODE: {
      COMMENT: "comment",
      SCREENSHOT: "screenshot"
    },

    SELECTION: {
      RECT: "rect",
      FREEFORM: "freeform",
      FULL: "full"
    },

    MSG: {
      PING: "PING",
      TOGGLE_FROM_POPUP: "TOGGLE_FROM_POPUP",
      TOGGLE_COMMENT_MODE: "TOGGLE_COMMENT_MODE",
      TOGGLE_SCREENSHOT_MODE: "TOGGLE_SCREENSHOT_MODE",
      CAPTURE_VISIBLE_TAB: "CAPTURE_VISIBLE_TAB",
      SAVE_COMMENT: "SAVE_COMMENT"
    },

    /**
     * Returns a human-readable message for any thrown value.
     * @param {unknown} err
     * @returns {string}
     */
    getErrorMessage(err) {
      return String(err && err.message ? err.message : err);
    }
  };

  globalThis.JC = JC;
})();
