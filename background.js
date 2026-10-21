// Q9 Input Method v2.0 Background Service Worker
// - Auto-enables Direct-Typing Mode (ON by default, like Chrome 速成 / Google Input Tools plugin)
// - Injects content scripts into already-open tabs immediately upon install (no refresh required)
// - Syncs toolbar badge ("ON" / "OFF") and broadcasts state changes to all tabs
// - Provides Native ChromeOS System IME (chrome.input.ime)

(function () {
  "use strict";

  if (typeof importScripts === "function" && typeof Q9Engine === "undefined") {
    try {
      importScripts("q9_data.js", "q9_engine.js");
    } catch (e) {
      console.warn("Q9 importScripts warning:", e);
    }
  }

  const extApi = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;

  function updateToolbarBadge(enabled, mode) {
    if (!extApi || !extApi.action) return;
    try {
      if (enabled) {
        extApi.action.setBadgeText({ text: mode === "stroke" ? "筆" : "On" });
        extApi.action.setBadgeBackgroundColor({ color: "#b6b91cff" });
        if (extApi.action.setBadgeTextColor) {
          extApi.action.setBadgeTextColor({ color: "#ffffffff" });
        }
      } else {
        extApi.action.setBadgeText({ text: "OFF" });
        extApi.action.setBadgeBackgroundColor({ color: "#64748b" });
      }
    } catch (_) {}
  }

  function injectIntoAllOpenTabs() {
    if (!extApi || !extApi.tabs || !extApi.scripting) return;
    try {
      extApi.tabs.query({}, (tabs) => {
        if (!tabs) return;
        for (const tab of tabs) {
          if (!tab.id || !tab.url) continue;
          if (!/^https?:\/\//i.test(tab.url) && !/^file:\/\//i.test(tab.url)) continue;
          const tabId = tab.id;
          const inject = () => {
            try {
              extApi.scripting.executeScript(
                {
                  target: { tabId, allFrames: true },
                  files: ["q9_data.js", "q9_engine.js", "content.js"]
                },
                () => {
                  // Ignore errors on restricted frames
                  void (extApi.runtime && extApi.runtime.lastError);
                }
              );
            } catch (_) {}
          };
          // Only inject when the manifest content script is NOT already running in the tab;
          // injecting on top of it re-declares Q9_DATA ("Identifier 'Q9_DATA' has already been declared").
          try {
            extApi.tabs.sendMessage(tabId, { type: "Q9_GET_STATUS" }, (resp) => {
              const err = extApi.runtime && extApi.runtime.lastError;
              if (err || !resp) inject();
            });
          } catch (_) {
            inject();
          }
        }
      });
    } catch (_) {}
  }

  function broadcastToAllTabs(msg) {
    if (!extApi || !extApi.tabs) return;
    try {
      extApi.tabs.query({}, (tabs) => {
        if (!tabs) return;
        for (const tab of tabs) {
          if (!tab.id) continue;
          try {
            extApi.tabs.sendMessage(tab.id, msg, () => {
              void (extApi.runtime && extApi.runtime.lastError);
            });
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

  function initDefaultsAndInject() {
    if (!extApi || !extApi.storage || !extApi.storage.local) return;
    extApi.storage.local.get(
      ["q9_enabled", "q9_mode", "q9_variant", "q9_layout", "q9_follow_cursor", "q9_scale", "q9_opacity"],
      (res) => {
        const next = {
          q9_enabled: typeof res?.q9_enabled === "boolean" ? res.q9_enabled : true,
          q9_mode: res?.q9_mode || "shape",
          q9_variant: res?.q9_variant || "trad",
          q9_layout: res?.q9_layout || "all",
          q9_follow_cursor: typeof res?.q9_follow_cursor === "boolean" ? res.q9_follow_cursor : true,
          q9_scale: typeof res?.q9_scale === "number" ? res.q9_scale : 0.85,
          q9_opacity: typeof res?.q9_opacity === "number" ? res.q9_opacity : 0.96
        };
        extApi.storage.local.set(next, () => {
          updateToolbarBadge(next.q9_enabled, next.q9_mode);
          injectIntoAllOpenTabs();
        });
      }
    );
  }

  if (extApi && extApi.runtime && extApi.runtime.onInstalled) {
    extApi.runtime.onInstalled.addListener(() => {
      initDefaultsAndInject();
    });
  }
  if (extApi && extApi.runtime && extApi.runtime.onStartup) {
    extApi.runtime.onStartup.addListener(() => {
      initDefaultsAndInject();
    });
  }

  // Initialize badge immediately when background worker wakes up
  if (extApi && extApi.storage && extApi.storage.local) {
    extApi.storage.local.get(["q9_enabled", "q9_mode"], (res) => {
      const enabled = typeof res?.q9_enabled === "boolean" ? res.q9_enabled : true;
      const mode = res?.q9_mode || "shape";
      updateToolbarBadge(enabled, mode);
    });

    if (extApi.storage.onChanged) {
      extApi.storage.onChanged.addListener((changes) => {
        extApi.storage.local.get(["q9_enabled", "q9_mode"], (res) => {
          const enabled = typeof res?.q9_enabled === "boolean" ? res.q9_enabled : true;
          const mode = res?.q9_mode || "shape";
          updateToolbarBadge(enabled, mode);
        });
      });
    }
  }

  // Handle shortcut command (Alt+Q) to toggle Q9 ON/OFF across tabs
  if (extApi && extApi.commands && extApi.commands.onCommand) {
    extApi.commands.onCommand.addListener((command) => {
      if (command === "toggle-q9" && extApi.storage && extApi.storage.local) {
        extApi.storage.local.get(["q9_enabled", "q9_mode"], (res) => {
          const nextEnabled = !(typeof res?.q9_enabled === "boolean" ? res.q9_enabled : true);
          extApi.storage.local.set({ q9_enabled: nextEnabled }, () => {
            updateToolbarBadge(nextEnabled, res?.q9_mode || "shape");
            broadcastToAllTabs({ type: "Q9_SET_CONFIG", enabled: nextEnabled });
          });
        });
      }
    });
  }

  // Handle messages from popup switcher menu
  if (extApi && extApi.runtime && extApi.runtime.onMessage) {
    extApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === "Q9_BROADCAST_CONFIG") {
        injectIntoAllOpenTabs();
        broadcastToAllTabs({
          type: "Q9_SET_CONFIG",
          enabled: msg.enabled,
          mode: msg.mode,
          variant: msg.variant,
          keyboardLayout: msg.keyboardLayout,
          followCursor: msg.followCursor,
          scale: msg.scale,
          opacity: msg.opacity,
          autoHideIdle: msg.autoHideIdle
        });
        updateToolbarBadge(msg.enabled, msg.mode);
        sendResponse({ ok: true });
        return true;
      }
    });
  }

  // Native ChromeOS System IME Integration (chrome.input.ime)
  if (
    typeof chrome !== "undefined" &&
    chrome.input &&
    chrome.input.ime &&
    typeof Q9Engine !== "undefined" &&
    typeof Q9_DATA !== "undefined"
  ) {
    const imeEngine = new Q9Engine(Q9_DATA, {
      mode: "shape",
      variant: "trad",
      keyboardLayout: "all",
      enabled: true
    });

    let activeEngineID = "";
    let activeContextID = -1;

    function updateImeMenu() {
      if (!activeEngineID) return;
      try {
        chrome.input.ime.setMenuItems({
          engineID: activeEngineID,
          items: [
            {
              id: "q9_mode_shape",
              label: "大口字形輸入法 (Q9 Shape)",
              style: "radio",
              checked: imeEngine.mode === "shape",
              enabled: true
            },
            {
              id: "q9_mode_stroke",
              label: "大口筆劃輸入法 (Q9 Stroke)",
              style: "radio",
              checked: imeEngine.mode === "stroke",
              enabled: true
            },
            {
              id: "q9_variant_simp",
              label: "打繁出簡 (簡體輸出)",
              style: "check",
              checked: imeEngine.variant === "simp",
              enabled: true
            },
            {
              id: "q9_layout_laptop",
              label: "筆電右手鍵 (789/UIO/JKL)",
              style: "check",
              checked: imeEngine.keyboardLayout === "laptop",
              enabled: true
            }
          ]
        });
      } catch (_) {}
    }

    function syncChromeOSUI() {
      if (activeContextID === -1) return;
      const state = imeEngine.getGridState();

      if (state.charset) {
        const compText = `[大口:${state.charset}]`;
        chrome.input.ime.setComposition({
          contextID: activeContextID,
          text: compText,
          cursor: compText.length
        });
      } else {
        chrome.input.ime.clearComposition({ contextID: activeContextID }, () => {});
      }

      const candidates = [];
      const orderByKey = [...state.cells].sort((a, b) => Number(a.key) - Number(b.key));
      for (const cell of orderByKey) {
        const keyNum = Number(cell.key);
        if (state.isSelecting) {
          if (cell.candidate) {
            candidates.push({
              candidate: cell.candidate,
              id: keyNum,
              label: String(keyNum),
              annotation: cell.isHkscs ? "HKSCS" : cell.subRadical || ""
            });
          }
        } else {
          const preview = cell.showPreviewChar && cell.candidate ? ` → ${cell.candidate}` : "";
          candidates.push({
            candidate: `${cell.mainRadical} (${cell.subRadical})${preview}`,
            id: keyNum,
            label:
              imeEngine.keyboardLayout === "laptop"
                ? `${keyNum}[${cell.laptopKey}]`
                : String(keyNum),
            annotation: cell.desc || ""
          });
        }
      }

      candidates.push({
        candidate: `[按 0] ${state.zeroLabel}   [按 .] ${state.dotLabel}`,
        id: 0,
        label: "0",
        annotation: state.isSelecting
          ? `第 ${state.currentPage}/${state.totalPages} 頁`
          : state.mode === "stroke"
          ? "大口筆劃"
          : "大口字形"
      });

      chrome.input.ime.setCandidateWindowProperties({
        engineID: activeEngineID,
        properties: {
          visible: state.charset !== "" || state.isSelecting,
          cursorVisible: true,
          vertical: true,
          pageSize: 10,
          auxiliaryText: state.breadcrumb,
          auxiliaryTextVisible: true
        }
      });

      chrome.input.ime.setCandidates({
        contextID: activeContextID,
        candidates
      });
    }

    chrome.input.ime.onActivate.addListener((engineID) => {
      activeEngineID = engineID;
      imeEngine.reset(true);
      updateImeMenu();
    });

    chrome.input.ime.onDeactivated.addListener(() => {
      activeEngineID = "";
      activeContextID = -1;
      imeEngine.reset(true);
    });

    chrome.input.ime.onFocus.addListener((context) => {
      activeContextID = context.contextID;
      imeEngine.reset(true);
    });

    chrome.input.ime.onBlur.addListener((contextID) => {
      if (activeContextID === contextID) {
        activeContextID = -1;
        imeEngine.reset(true);
      }
    });

    chrome.input.ime.onReset.addListener(() => {
      imeEngine.reset(true);
      syncChromeOSUI();
    });

    chrome.input.ime.onMenuItemActivated.addListener((engineID, name) => {
      if (name === "q9_mode_shape") imeEngine.setMode("shape");
      else if (name === "q9_mode_stroke") imeEngine.setMode("stroke");
      else if (name === "q9_variant_simp") {
        imeEngine.setVariant(imeEngine.variant === "simp" ? "trad" : "simp");
      } else if (name === "q9_layout_laptop") {
        imeEngine.setKeyboardLayout(imeEngine.keyboardLayout === "laptop" ? "all" : "laptop");
      }
      updateImeMenu();
      syncChromeOSUI();
    });

    chrome.input.ime.onCandidateClicked.addListener((_engineID, candidateID, _button) => {
      if (activeContextID === -1) return;
      const res = imeEngine.handleKey(String(candidateID));
      if (res.action === "commit" && res.text) {
        chrome.input.ime.clearComposition({ contextID: activeContextID }, () => {});
        chrome.input.ime.commitText({ contextID: activeContextID, text: res.text });
      }
      syncChromeOSUI();
    });

    chrome.input.ime.onKeyEvent.addListener((_engineID, keyData) => {
      if (keyData.type !== "keydown" || activeContextID === -1) {
        return false;
      }

      const q9Key = imeEngine.mapKeyboardEvent(keyData);
      if (!q9Key) {
        return false;
      }

      const res = imeEngine.handleKey(q9Key);
      if (!res || !res.handled) {
        return false;
      }

      if (res.action === "commit" && res.text) {
        chrome.input.ime.clearComposition({ contextID: activeContextID }, () => {});
        chrome.input.ime.commitText({ contextID: activeContextID, text: res.text });
      }

      syncChromeOSUI();
      return true;
    });
  }
})();
