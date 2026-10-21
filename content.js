// Q9 Input Method v2.0 Universal Direct-Typing Content Script (Chrome, Firefox, Edge, ChromeOS)
// Works like Chrome 速成 Plugin / Google Input Tools:
// - Enabled by default: click any input box on any webpage and type Chinese directly (ZERO copy-paste!)
// - Cursor-following 9-grid candidate box + inline caret composition badge
// - Tap 'Shift' (or '/') to toggle 中/英 instantly
// - Full compatibility with <input>, <textarea>, React/Vue, ContentEditable, Slate, Lexical, ProseMirror, and Google Docs

(function () {
  "use strict";

  // On Google Docs every sub-frame (including the hidden text-event iframe) would otherwise start its
  // OWN engine + UI. The top frame already drives that iframe, so sub-frames of Docs stay inert.
  if (window !== window.top) {
    try {
      const ao = location.ancestorOrigins;
      if (ao && Array.prototype.some.call(ao, (o) => o === "https://docs.google.com")) return;
    } catch (_) {}
  }
  if (window.__Q9_IME_CONTENT_V2__) return;
  const Q9_BUILD = "docs-v15-movable-bar";
  const Q9_FRAME = window === window.top ? "top" : "sub";
  // Google Docs insert strategy (switch live with Ctrl+Alt+1..7; Ctrl+Alt+0 = Docs event spy):
  //  1 paste      DEFAULT. Dispatch a paste event carrying the text to Docs' real input element.
  //  2 buffer     copy the text; the user presses Ctrl+V
  //  3 exec | 4 clipboard | 5 composition | 6 keys | 7 innertext   (experimental fallbacks)
  const DOCS_MODES = ["paste", "buffer", "exec", "clipboard", "composition", "keys", "innertext"];
  let DOCS_INSERT_MODE = "paste";
  let docsPending = "";
  let docsSpyOn = false;
  window.__Q9_DEBUG__ = false; // set to true to see [Q9] debug logs in the Console
  if (window.__Q9_DEBUG__) console.log("[Q9] content.js build:", Q9_BUILD, "frame:", Q9_FRAME, location.href.slice(0, 80));
  window.__Q9_IME_CONTENT_V2__ = true;

  if (typeof Q9Engine === "undefined" || typeof Q9_DATA === "undefined") {
    return;
  }

  const extApi = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;

  const engine = new Q9Engine(Q9_DATA, {
    mode: "shape",
    variant: "trad",
    keyboardLayout: "all",
    enabled: true // ON by default so users can type directly on any webpage immediately!
  });

  let followCursor = true; // Auto-pop near input box when focused, just like Chrome 速成 plugin
  let pinnedOpen = false; // If user manually pins the 9-grid window open
  let userDraggedPos = null; // { left, top } if user manually dragged the window
  let windowScale = 0.85; // User-adjustable scale (0.55 to 1.40), default 0.85 (compact & non-obstructive)
  let windowOpacity = 0.96; // User-adjustable opacity (0.55 to 1.0) so it never blocks background content
  let autoHideIdle = false; // When true, only pop up the 9-grid after first key 1-9 is pressed
  let lookupOpen = false;
  let lastFocusedEditable = null;
  let isInputCurrentlyFocused = false;
  let shiftKeyDownAlone = false;
  let toastTimer = null;

  if (
    document.documentElement &&
    (document.documentElement.hasAttribute("data-q9-auto-open") ||
      location.search.includes("q9open=1"))
  ) {
    pinnedOpen = true;
  }

  function clampScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.85;
    return Math.max(0.55, Math.min(1.4, Math.round(n * 100) / 100));
  }

  function clampOpacity(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0.96;
    return Math.max(0.55, Math.min(1.0, Math.round(n * 100) / 100));
  }

  // Load saved settings from extension storage
  if (extApi && extApi.storage && extApi.storage.local) {
    try {
      extApi.storage.local.get(
        [
          "q9_enabled",
          "q9_mode",
          "q9_variant",
          "q9_layout",
          "q9_follow_cursor",
          "q9_pinned",
          "q9_scale",
          "q9_opacity",
          "q9_auto_hide"
        ],
        (res) => {
          if (!res) return;
          if (res.q9_mode) engine.setMode(res.q9_mode);
          if (res.q9_variant) engine.setVariant(res.q9_variant);
          if (res.q9_layout) engine.setKeyboardLayout(res.q9_layout);
          if (typeof res.q9_enabled === "boolean") engine.enabled = res.q9_enabled;
          if (typeof res.q9_follow_cursor === "boolean") followCursor = res.q9_follow_cursor;
          if (typeof res.q9_pinned === "boolean") pinnedOpen = res.q9_pinned;
          if (typeof res.q9_scale === "number") windowScale = clampScale(res.q9_scale);
          if (typeof res.q9_opacity === "number") windowOpacity = clampOpacity(res.q9_opacity);
          if (typeof res.q9_auto_hide === "boolean") autoHideIdle = res.q9_auto_hide;
          renderUI();
        }
      );
    } catch (_) {}
  }

  function savePrefs() {
    if (extApi && extApi.storage && extApi.storage.local) {
      try {
        extApi.storage.local.set({
          q9_enabled: engine.enabled,
          q9_mode: engine.mode,
          q9_variant: engine.variant,
          q9_layout: engine.keyboardLayout,
          q9_follow_cursor: followCursor,
          q9_pinned: pinnedOpen,
          q9_scale: windowScale,
          q9_opacity: windowOpacity,
          q9_auto_hide: autoHideIdle
        });
      } catch (_) {}
    }
  }

  // Traverse Shadow DOM boundaries to find the true focused element
  function getDeepActiveElement(root = document) {
    let active = root.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      if (active === hostEl) break;
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function isEditableElement(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (hostEl && hostEl.contains(el)) return false;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (tag === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      const nonTextTypes = [
        "button",
        "checkbox",
        "color",
        "date",
        "datetime-local",
        "file",
        "hidden",
        "image",
        "month",
        "radio",
        "range",
        "reset",
        "submit",
        "time",
        "week"
      ];
      return !nonTextTypes.includes(type) && !el.disabled && !el.readOnly;
    }
    if (el.isContentEditable) return true;
    const ceAttr = el.getAttribute && el.getAttribute("contenteditable");
    if (ceAttr === "" || ceAttr === "true" || ceAttr === "plaintext-only" || ceAttr === "typing") {
      return true;
    }
    if (el.getAttribute && el.getAttribute("role") === "textbox") return true;
    return false;
  }

  // ---- Google Docs support ----
  // Structure of the Docs text-event iframe:
  //   <body><div tabindex="0" role="textbox" contenteditable="true"></div>   <- REAL input target
  //         <div id="docs-texteventtarget-descendant" role="group"></div></body>   <- NOT editable
  function getDocsFrameDoc() {
    try {
      const f = document.querySelector("iframe.docs-texteventtarget-iframe");
      return (f && f.contentDocument) || null;
    } catch (_) {
      return null;
    }
  }

  function getDocsFrameEditable() {
    const d = getDocsFrameDoc();
    if (!d) return null;
    try {
      const real = d.querySelector('[contenteditable="true"][role="textbox"]');
      if (real) return real;
      const a = d.activeElement;
      if (a && (a.isContentEditable || a.tagName === "TEXTAREA" || a.tagName === "INPUT")) return a;
      return d.querySelector('[contenteditable="true"], [contenteditable=""], textarea') || null;
    } catch (_) {}
    return null;
  }

  function describeEl(e) {
    if (!e) return "null";
    return (
      e.tagName + "#" + (e.id || "") + "." + (e.className || "") +
      "[ce=" + e.getAttribute("contenteditable") + ",isCE=" + e.isContentEditable + "]"
    );
  }

  function focusDocsEditable(el) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    try { win.focus(); } catch (_) {}
    try { el.focus({ preventScroll: true }); } catch (_) {}
  }

  const dlog = (tag, ...a) => window.__Q9_DEBUG__ && console.log("[Q9][" + tag + "]", ...a);
  let clipQueue = Promise.resolve();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Mode "paste": Docs reads the text from the paste event's clipboardData.
  function pasteIntoDocs(el, text) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    try {
      focusDocsEditable(el);
      const dt = new win.DataTransfer();
      dt.setData("text/plain", text);
      const ev = new win.ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData: dt });
      ev.__q9Synthetic = true;
      el.dispatchEvent(ev);
      dlog("paste", "dispatched", JSON.stringify(text), "defaultPrevented:", ev.defaultPrevented);
      return true;
    } catch (err) {
      dlog("paste", "failed, falling back to buffer:", err && err.message);
      return bufferCommit(el, text);
    }
  }

  // ---- Fallback: copy to clipboard and let the user press Ctrl+V ----
  function copyViaTextarea(doc, el, text) {
    try {
      const ta = doc.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
      (doc.body || doc.documentElement).appendChild(ta);
      ta.select();
      const ok = doc.execCommand("copy");
      ta.remove();
      focusDocsEditable(el);
      return ok;
    } catch (_) {
      return false;
    }
  }
  function tailOf(s, n) {
    const a = Array.from(s);
    return a.length > n ? "…" + a.slice(-n).join("") : s;
  }
  function pendingCopy(el) {
    if (!docsPending) return true;
    const ok = copyViaTextarea(el.ownerDocument, el, docsPending);
    showToast(
      ok ? "已複製「" + tailOf(docsPending, 14) + "」→ 按 Ctrl+V 貼上" : "複製到剪貼簿失敗",
      4000
    );
    return ok;
  }
  function bufferCommit(el, text) {
    docsPending += text;
    return pendingCopy(el);
  }

  function pasteViaClipboard(el, text) {
    const doc = el.ownerDocument;
    clipQueue = clipQueue
      .then(async () => {
        focusDocsEditable(el);
        const wrote = copyViaTextarea(doc, el, text);
        let ok = false;
        try { ok = doc.execCommand("paste"); } catch (_) {}
        dlog("clip", "copy ->", wrote, "execCommand(paste) ->", ok, "text:", text);
        await sleep(100);
      })
      .catch((e) => dlog("clip", "queue error:", e && e.message));
    return true;
  }

  // Event spy (debugging): shows exactly what Docs receives. Ctrl+Alt+0 toggles it.
  const SPY_TYPES = [
    "keydown", "keypress", "keyup", "beforeinput", "textInput", "input",
    "compositionstart", "compositionupdate", "compositionend", "paste", "cut", "copy"
  ];
  function spyHandlerPre(e) {
    const o = [e.type];
    if (e.key !== undefined) o.push("key=" + JSON.stringify(e.key), "code=" + e.code, "keyCode=" + e.keyCode);
    if (e.inputType !== undefined) o.push("inputType=" + e.inputType);
    if (e.data !== undefined && e.data !== null) o.push("data=" + JSON.stringify(e.data));
    o.push("trusted=" + e.isTrusted, "target=" + describeEl(e.target));
    console.log("[Q9][spy] " + o.join(" "));
  }
  function spyHandlerPost(e) {
    console.log("[Q9][spy]   -> after handlers:", e.type, "defaultPrevented=" + e.defaultPrevented);
  }
  function setDocsSpy(on) {
    const d = getDocsFrameDoc();
    if (!d) return;
    const w = d.defaultView;
    for (const type of SPY_TYPES) {
      if (on) {
        w.addEventListener(type, spyHandlerPre, true);
        w.addEventListener(type, spyHandlerPost, false);
      } else {
        w.removeEventListener(type, spyHandlerPre, true);
        w.removeEventListener(type, spyHandlerPost, false);
      }
    }
    docsSpyOn = on;
    console.log("[Q9][spy]", on ? "ON" : "OFF");
  }

  function insertIntoDocsFrame(el, text) {
    const doc = el.ownerDocument;
    const win = doc.defaultView || window;
    const log = (...a) => dlog("docs", ...a);

    if (DOCS_INSERT_MODE === "paste") return pasteIntoDocs(el, text);
    if (DOCS_INSERT_MODE === "buffer") return bufferCommit(el, text);
    if (DOCS_INSERT_MODE === "clipboard") return pasteViaClipboard(el, text);
    focusDocsEditable(el);

    const common = { bubbles: true, cancelable: true, composed: true };
    const send = (ev) => {
      ev.__q9Synthetic = true;
      return el.dispatchEvent(ev);
    };
    try {
      switch (DOCS_INSERT_MODE) {
        case "exec": {
          const ok = doc.execCommand("insertText", false, text);
          log("execCommand insertText ->", ok);
          break;
        }
        case "composition": {
          const kd = (type) =>
            new win.KeyboardEvent(type, { ...common, key: "Process", code: "", keyCode: 229, which: 229 });
          send(kd("keydown"));
          send(new win.CompositionEvent("compositionstart", { ...common, data: "" }));
          send(new win.CompositionEvent("compositionupdate", { ...common, data: text }));
          send(new win.InputEvent("beforeinput", { ...common, inputType: "insertCompositionText", data: text, isComposing: true }));
          el.appendChild(doc.createTextNode(text));
          send(new win.InputEvent("input", { ...common, inputType: "insertCompositionText", data: text, isComposing: true }));
          send(new win.CompositionEvent("compositionend", { ...common, data: text }));
          send(kd("keyup"));
          setTimeout(() => { try { el.textContent = ""; } catch (_) {} }, 80);
          break;
        }
        case "keys": {
          for (const ch of Array.from(text)) {
            const cc = ch.codePointAt(0);
            const o = { ...common, key: ch, code: "", keyCode: cc, charCode: cc, which: cc };
            send(new win.KeyboardEvent("keydown", o));
            send(new win.KeyboardEvent("keypress", o));
            send(new win.KeyboardEvent("keyup", o));
          }
          break;
        }
        case "innertext": {
          el.textContent = text;
          send(new win.InputEvent("input", { ...common, inputType: "insertText", data: text }));
          setTimeout(() => { try { el.textContent = ""; } catch (_) {} }, 80);
          break;
        }
      }
      return true;
    } catch (err) {
      log("insert failed", DOCS_INSERT_MODE, err);
      return false;
    }
  }

  // The on-screen backspace button. Physical Backspace is never intercepted when not composing.
  function backspaceInDocsFrame(el) {
    if (docsPending) {
      docsPending = Array.from(docsPending).slice(0, -1).join("");
      if (docsPending) pendingCopy(el);
      else showToast("已清空待貼上的文字");
      return true;
    }
    focusDocsEditable(el);
    const win = el.ownerDocument.defaultView || window;
    const o = { bubbles: true, cancelable: true, composed: true, key: "Backspace", code: "Backspace", keyCode: 8, which: 8 };
    const down = new win.KeyboardEvent("keydown", o);
    const up = new win.KeyboardEvent("keyup", o);
    down.__q9Synthetic = up.__q9Synthetic = true;
    el.dispatchEvent(down);
    el.dispatchEvent(up);
    return true;
  }

  function findActiveEditableTarget() {
    const deep = getDeepActiveElement();
    if (isEditableElement(deep)) return deep;

    // Google Docs: hidden same-origin text event target iframe
    const gdocEditable = getDocsFrameEditable();
    if (gdocEditable) return gdocEditable;

    if (lastFocusedEditable && document.contains(lastFocusedEditable)) {
      return lastFocusedEditable;
    }
    return null;
  }

  // Compute bounding rect of current caret or active input element for cursor-following window
  function getTargetCaretRect(target) {
    try {
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0).cloneRange();
        range.collapse(true);
        const rects = range.getClientRects();
        if (rects && rects.length > 0 && (rects[0].width > 0 || rects[0].height > 0)) {
          return rects[0];
        }
      }
    } catch (_) {}

    if (target && typeof target.getBoundingClientRect === "function") {
      const r = target.getBoundingClientRect();
      if (r.width > 0 || r.height > 0) return r;
    }
    return null;
  }

  // Direct text insertion into ANY webpage input / textarea / contenteditable / virtual editor (NO copy-paste!)
  function insertTextDirect(text) {
    if (!text) return false;

    const target = findActiveEditableTarget();
    if (!target) return false;

    try {
      target.focus({ preventScroll: true });
    } catch (_) {}

    const tag = (target.tagName || "").toUpperCase();

    // Case 1: Standard <input> or <textarea>
    if (tag === "INPUT" || tag === "TEXTAREA") {
      return insertIntoInputOrTextarea(target, text);
    }

    // Case 2: ContentEditable / Rich Text / Slate / Lexical / ProseMirror / Google Docs
    return insertIntoRichEditor(target, text);
  }

  function insertIntoInputOrTextarea(el, text) {
    const prevVal = el.value || "";
    const start = typeof el.selectionStart === "number" ? el.selectionStart : prevVal.length;
    const end = typeof el.selectionEnd === "number" ? el.selectionEnd : prevVal.length;

    // First try native execCommand('insertText') which fires authentic browser input events & preserves Undo
    try {
      const ok = document.execCommand("insertText", false, text);
      if (ok && el.value !== prevVal) {
        return true;
      }
    } catch (_) {}

    // Fallback for React / Vue / controlled inputs or special input types (e.g. search/number)
    const beforeEvt = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: text
    });
    el.dispatchEvent(beforeEvt);

    const nextVal = prevVal.slice(0, start) + text + prevVal.slice(end);
    const proto =
      el.tagName.toUpperCase() === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, nextVal);
    } else {
      el.value = nextVal;
    }

    // Sync React 16+ internal _valueTracker so React onChange fires reliably
    if (el._valueTracker) {
      try {
        el._valueTracker.setValue(prevVal);
      } catch (_) {}
    }

    const newPos = start + text.length;
    try {
      el.setSelectionRange(newPos, newPos);
    } catch (_) {}

    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function insertIntoRichEditor(el, text) {
    const ownerDoc = el.ownerDocument || document;
    const ownerWin = ownerDoc.defaultView || window;
    if (ownerDoc !== document) return insertIntoDocsFrame(el, text);

    // 1. Try native execCommand("insertText") first — in Chrome & Firefox, this dispatches
    // a trusted beforeinput(insertText) that Slate, Lexical, ProseMirror, TipTap, and CKEditor handle natively!
    const beforeText = el.textContent;
    try {
      const ok = ownerDoc.execCommand("insertText", false, text);
      if (ok) {
        return true;
      }
    } catch (_) {}

    // 2. Dispatch standard Input Events Level 2 beforeinput (insertText)
    const beforeEvt = new ownerWin.InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: "insertText",
      data: text
    });
    const notCancelled = el.dispatchEvent(beforeEvt);

    // If editor (like Slate) intercepted beforeinput and called preventDefault(), check if it updated
    if (!notCancelled && el.textContent !== beforeText) {
      return true;
    }

    // 3. Manipulate DOM Selection range directly + fire compositionend & input
    try {
      const sel = ownerWin.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const textNode = ownerDoc.createTextNode(text);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        el.appendChild(ownerDoc.createTextNode(text));
      }
    } catch (_) {}

    try {
      el.dispatchEvent(new ownerWin.CompositionEvent("compositionstart", { bubbles: true, composed: true, data: "" }));
      el.dispatchEvent(new ownerWin.CompositionEvent("compositionupdate", { bubbles: true, composed: true, data: text }));
      el.dispatchEvent(new ownerWin.CompositionEvent("compositionend", { bubbles: true, composed: true, data: text }));
    } catch (_) {}

    el.dispatchEvent(
      new ownerWin.InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "insertText",
        data: text
      })
    );
    return true;
  }

  // Unicode-aware helper to slice off last grapheme/surrogate pair (including multi-codepoint Emoji!)
  function sliceOffLastCluster(str) {
    if (!str) return "";
    const arr = Array.from(str);
    arr.pop();
    return arr.join("");
  }

  // Delete one character/selection from active webpage input/textarea/contenteditable (or step back Q9 code)
  function performDirectBackspace() {
    if (!engine.englishMode && (engine.charset.length > 0 || engine.isSelecting)) {
      engine.handleKey("Backspace");
      renderUI();
      return true;
    }
    const target = findActiveEditableTarget();
    if (!target) return false;
    try {
      target.focus({ preventScroll: true });
    } catch (_) {}

    const tag = (target.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const prevVal = target.value || "";
      if (!prevVal) return false;
      const start = typeof target.selectionStart === "number" ? target.selectionStart : prevVal.length;
      const end = typeof target.selectionEnd === "number" ? target.selectionEnd : prevVal.length;
      let nextVal = prevVal;
      let newPos = start;
      if (start !== end) {
        nextVal = prevVal.slice(0, start) + prevVal.slice(end);
        newPos = start;
      } else if (start > 0) {
        const before = prevVal.slice(0, start);
        const trimmedBefore = sliceOffLastCluster(before);
        nextVal = trimmedBefore + prevVal.slice(end);
        newPos = trimmedBefore.length;
      } else {
        return false;
      }
      const proto =
        tag === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (nativeSetter) nativeSetter.call(target, nextVal);
      else target.value = nextVal;
      if (target._valueTracker) {
        try {
          target._valueTracker.setValue(prevVal);
        } catch (_) {}
      }
      try {
        target.setSelectionRange(newPos, newPos);
      } catch (_) {}
      target.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "deleteContentBackward"
        })
      );
      target.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    // Rich editor / contenteditable
    if (target.ownerDocument && target.ownerDocument !== document) return backspaceInDocsFrame(target);
    const ownerDoc = target.ownerDocument || document;
    try {
      if (ownerDoc.execCommand("delete", false, null)) return true;
    } catch (_) {}
    target.textContent = sliceOffLastCluster(target.textContent || "");
    target.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: "deleteContentBackward"
      })
    );
    return true;
  }

  // Long-press repeatable delete (280ms initial delay, 50ms repeat interval with acceleration)
  function bindRepeatableDelete(btn) {
    if (!btn) return;
    let startTimeout = null;
    let repeatInterval = null;
    let tickCount = 0;
    let handledByPressAt = 0;

    function stopRepeat() {
      if (startTimeout) {
        clearTimeout(startTimeout);
        startTimeout = null;
      }
      if (repeatInterval) {
        clearInterval(repeatInterval);
        repeatInterval = null;
      }
      tickCount = 0;
      btn.classList.remove("holding");
    }

    function startRepeat(e) {
      if (e && e.type === "mousedown" && e.button !== 0) return;
      if (e && e.type === "touchstart" && Date.now() - handledByPressAt < 80) return;
      if (e && e.cancelable) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      stopRepeat();
      handledByPressAt = Date.now();
      btn.classList.add("holding");
      performDirectBackspace();

      startTimeout = setTimeout(() => {
        repeatInterval = setInterval(() => {
          tickCount++;
          performDirectBackspace();
          if (tickCount > 12) performDirectBackspace();
          handledByPressAt = Date.now();
        }, 50);
      }, 280);
    }

    btn.addEventListener("pointerdown", startRepeat);
    btn.addEventListener("touchstart", startRepeat, { passive: false });
    btn.addEventListener("pointerup", stopRepeat);
    btn.addEventListener("pointercancel", stopRepeat);
    btn.addEventListener("pointerleave", stopRepeat);
    btn.addEventListener("touchend", stopRepeat);
    btn.addEventListener("touchcancel", stopRepeat);
    window.addEventListener("pointerup", stopRepeat);
    window.addEventListener("mouseup", stopRepeat);
    window.addEventListener("blur", stopRepeat);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (Date.now() - handledByPressAt < 450) return;
      performDirectBackspace();
    });
  }

  // Create Shadow DOM Host
  const hostEl = document.createElement("div");
  hostEl.id = "q9-ime-extension-root";
  hostEl.style.cssText =
    "all: initial !important; position: fixed !important; z-index: 2147483646 !important; bottom: 0 !important; right: 0 !important; width: 0 !important; height: 0 !important; pointer-events: none !important;";
  const shadowRoot = hostEl.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    :host {
      all: initial;
      font-family: "Noto Sans CJK HK", "PingFang HK", "Microsoft JhengHei", "Heiti TC", system-ui, -apple-system, sans-serif;
    }
    * {
      box-sizing: border-box;
      user-select: none;
      -webkit-user-select: none;
    }

    /* Compact IME Status Bar (like Chrome 速成 / Windows IME language bar) */
    .q9-statusbar {
      position: fixed;
      right: 16px;
      bottom: 14px;
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 8px;
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.92);
      border: 1.5px solid #fcd34d;
      color: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.35);
      z-index: 2147483646;
      backdrop-filter: blur(6px);
    }
    .q9-statusbar.disabled {
      border-color: #64748b;
      opacity: 0.78;
    }
    .q9-sb-logo {
      background: #b91c1c;
      color: #fef08a;
      font-weight: 900;
      padding: 2px 7px;
      border-radius: 999px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .q9-statusbar.disabled .q9-sb-logo {
      background: #475569;
      color: #cbd5e1;
    }
    .q9-sb-chip {
      background: rgba(255, 255, 255, 0.12);
      color: #f8fafc;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 6px;
      padding: 2px 6px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .q9-sb-chip:hover {
      background: rgba(255, 255, 255, 0.24);
    }
    .q9-sb-chip.active {
      background: #fef08a;
      color: #7f1d1d;
      border-color: #fef08a;
    }

    /* Inline Caret Composition Bubble (pops right above text cursor while typing code) */
    .q9-caret-bubble {
      position: fixed;
      pointer-events: none;
      background: #7f1d1d;
      color: #fef08a;
      border: 1.5px solid #fcd34d;
      border-radius: 6px;
      padding: 2px 8px;
      font-size: 12.5px;
      font-weight: 800;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.3);
      z-index: 2147483647;
      white-space: nowrap;
    }
    .q9-caret-bubble.hidden {
      display: none !important;
    }

    /* Main 9-Grid Candidate Window (Compact & Freely Resizable) */
    .q9-window {
      position: fixed;
      right: 16px;
      bottom: 52px;
      width: 244px;
      pointer-events: auto;
      background: #f8fafc;
      border: 2px solid #991b1b;
      border-radius: 11px;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.28), 0 0 0 1px rgba(252, 211, 77, 0.5);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 2147483647;
      color: #0f172a;
      transform-origin: top left;
      transform: scale(var(--q9-scale, 0.85));
      opacity: var(--q9-opacity, 0.96);
      transition: opacity 0.14s ease;
    }
    .q9-window:hover {
      opacity: 1 !important;
    }
    .q9-window.hidden {
      display: none !important;
    }

    /* Header Bar */
    .q9-header {
      background: linear-gradient(135deg, #7f1d1d 0%, #991b1b 55%, #b91c1c 100%);
      color: #fffbeb;
      padding: 4px 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
      border-bottom: 1.5px solid #fcd34d;
      gap: 3px;
    }
    .q9-brand {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 800;
      font-size: 11.5px;
      white-space: nowrap;
    }
    .q9-brand-badge {
      background: #fef08a;
      color: #7f1d1d;
      font-size: 9.5px;
      font-weight: 900;
      padding: 1px 4px;
      border-radius: 4px;
    }
    .q9-scale-tag {
      font-size: 9.5px;
      font-weight: 700;
      color: #fde68a;
      opacity: 0.92;
    }
    .q9-header-controls {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: nowrap;
    }
    .q9-pill-btn {
      background: rgba(255, 255, 255, 0.14);
      border: 1px solid rgba(254, 240, 138, 0.45);
      color: #fffbeb;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 4px;
      border-radius: 4px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.25;
    }
    .q9-pill-btn:hover {
      background: rgba(255, 255, 255, 0.28);
    }
    .q9-pill-btn.active {
      background: #fef08a;
      color: #7f1d1d;
      border-color: #fef08a;
    }

    /* Compact Status & Code Bar */
    .q9-status-bar {
      background: #fffbeb;
      border-bottom: 1px solid #fde68a;
      padding: 3px 7px;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .q9-status-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .q9-code-box {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-weight: 800;
      font-size: 11px;
      color: #991b1b;
    }
    .q9-code-digits {
      background: #fee2e2;
      border: 1px solid #f87171;
      color: #7f1d1d;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 0 5px;
      border-radius: 4px;
      font-size: 11.5px;
      letter-spacing: 1px;
    }
    .q9-page-badge {
      font-size: 10px;
      font-weight: 700;
      color: #64748b;
    }
    .q9-breadcrumb {
      font-size: 10px;
      color: #334155;
      font-weight: 600;
      line-height: 1.25;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* 3x3 Nine-Square Grid */
    .q9-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows: repeat(3, 50px);
      gap: 3px;
      padding: 4px;
      background: #cbd5e1;
    }
    .q9-cell {
      position: relative;
      background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      border: 1.5px solid #94a3b8;
      border-radius: 7px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3px;
      transition: transform 0.06s ease, border-color 0.1s ease, background 0.1s ease;
      overflow: hidden;
    }
    .q9-cell:hover {
      border-color: #b91c1c;
      background: #fffbeb;
    }
    .q9-cell:active {
      transform: scale(0.96);
      background: #fef3c7;
    }
    .q9-cell.selecting {
      background: linear-gradient(180deg, #fffdf5 0%, #fef9c3 100%);
      border-color: #d97706;
    }
    .q9-cell.empty-slot {
      opacity: 0.45;
      cursor: default;
    }

    .q9-cell-key {
      position: absolute;
      top: 2px;
      left: 5px;
      font-size: 11.5px;
      font-weight: 900;
      color: #1e293b;
      font-family: ui-monospace, SFMono-Regular, monospace;
      line-height: 1;
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .q9-cell-laptop {
      font-size: 9.5px;
      font-weight: 700;
      color: #0284c7;
      background: #e0f2fe;
      padding: 0 3px;
      border-radius: 3px;
    }
    .q9-cell-preview {
      position: absolute;
      top: 2px;
      right: 5px;
      font-size: 12.5px;
      font-weight: 700;
      color: #6d28d9;
      line-height: 1;
    }
    .q9-cell-hkscs {
      position: absolute;
      top: 2px;
      right: 4px;
      font-size: 8.5px;
      font-weight: 800;
      color: #ffffff;
      background: #dc2626;
      padding: 0 3px;
      border-radius: 3px;
    }

    .q9-cell-main {
      font-size: 20px;
      font-weight: 800;
      line-height: 1.05;
      color: #b91c1c;
      margin-top: 3px;
      text-align: center;
    }
    .q9-cell.selecting .q9-cell-main {
      font-size: 22px;
      color: #0f172a;
      margin-top: 2px;
    }
    .q9-cell.selecting.hkscs-char .q9-cell-main {
      color: #dc2626;
    }

    .q9-cell-sub {
      font-size: 9.5px;
      font-weight: 700;
      color: #1d4ed8;
      margin-top: 1px;
      line-height: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 94%;
    }

    /* Bottom Action Bar (0, ., -, +, ⌫) */
    .q9-bottom-bar {
      position: relative;
      display: grid;
      grid-template-columns: 1.45fr 0.9fr 0.85fr 0.85fr 0.9fr;
      gap: 3px;
      padding: 0 4px 4px 4px;
      background: #cbd5e1;
    }
    .q9-action-btn.holding {
      background: #fee2e2 !important;
      border-color: #dc2626 !important;
      color: #991b1b !important;
    }
    .q9-subview.hidden {
      display: none !important;
    }
    /* English QWERTY Swipe View inside floating window */
    .q9-en-view {
      position: relative;
      background: #cbd5e1;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      touch-action: none;
    }
    .q9-en-cands {
      display: flex;
      gap: 3px;
      overflow-x: auto;
      padding-bottom: 2px;
      min-height: 22px;
    }
    .q9-en-chip {
      background: #ffffff;
      border: 1px solid #94a3b8;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10.5px;
      font-weight: 700;
      color: #0f172a;
      cursor: pointer;
      white-space: nowrap;
    }
    .q9-en-chip.primary {
      background: #fef3c7;
      border-color: #d97706;
      color: #78350f;
    }
    .q9-en-row {
      display: flex;
      gap: 2.5px;
      justify-content: center;
    }
    .q9-en-key {
      flex: 1;
      min-width: 0;
      height: 28px;
      background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
      border: 1px solid #64748b;
      border-radius: 4px;
      font-size: 11.5px;
      font-weight: 800;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      touch-action: none;
    }
    .q9-en-key.swiped-over {
      background: #fde68a !important;
      border-color: #d97706 !important;
      color: #78350f !important;
    }
    .q9-en-key.holding {
      background: #fee2e2 !important;
      border-color: #dc2626 !important;
      color: #991b1b !important;
    }
    .q9-swipe-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 8;
    }
    /* 8-Category Emoji Picker View inside floating window */
    .q9-emoji-view {
      background: #cbd5e1;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .q9-emoji-cats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 2px;
    }
    .q9-emoji-cat-btn {
      background: #e2e8f0;
      border: 1px solid #94a3b8;
      border-radius: 4px;
      padding: 2px 2px;
      font-size: 9.5px;
      font-weight: 800;
      color: #1e293b;
      cursor: pointer;
      text-align: center;
      white-space: nowrap;
    }
    .q9-emoji-cat-btn.active {
      background: #fef08a;
      border-color: #b91c1c;
      color: #7f1d1d;
    }
    .q9-emoji-grid {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 2.5px;
    }
    .q9-emoji-cell {
      height: 28px;
      background: #ffffff;
      border: 1px solid #94a3b8;
      border-radius: 4px;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .q9-emoji-cell:hover {
      background: #fef3c7;
      border-color: #d97706;
    }
    .q9-emoji-bar {
      display: grid;
      grid-template-columns: 1fr 0.9fr 1fr 0.9fr 0.9fr;
      gap: 2.5px;
      align-items: center;
    }
    .q9-emoji-page {
      font-size: 10px;
      font-weight: 800;
      text-align: center;
      color: #0f172a;
      background: #e2e8f0;
      border-radius: 4px;
      padding: 3px 2px;
    }
    .q9-action-btn {
      background: linear-gradient(180deg, #ffffff 0%, #f1f5f9 100%);
      border: 1px solid #64748b;
      border-radius: 5px;
      padding: 4px 2px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;
      cursor: pointer;
      font-size: 10.5px;
      font-weight: 800;
      color: #0f172a;
      white-space: nowrap;
    }
    /* Corner Drag-Resize Handle */
    .q9-resize-grip {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 45%, #991b1b 46%, #991b1b 62%, #fef08a 63%);
      border-top-left-radius: 4px;
      z-index: 10;
    }
    .q9-resize-grip:hover {
      background: linear-gradient(135deg, transparent 35%, #dc2626 36%, #fef08a 70%);
    }
    .q9-action-btn:hover {
      background: #fffbeb;
      border-color: #b91c1c;
    }
    .q9-action-btn.primary-zero {
      background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%);
      border-color: #d97706;
      color: #78350f;
    }
    .q9-action-key {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11.5px;
      font-weight: 900;
      background: rgba(15, 23, 42, 0.1);
      padding: 1px 4px;
      border-radius: 4px;
    }

    /* Reverse Lookup Drawer */
    .q9-drawer {
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      padding: 7px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .q9-drawer.hidden {
      display: none !important;
    }
    .q9-drawer-row {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .q9-input {
      flex: 1;
      border: 1px solid #94a3b8;
      border-radius: 5px;
      padding: 4px 7px;
      font-size: 12px;
      color: #0f172a;
      background: #ffffff;
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    .q9-small-btn {
      background: #991b1b;
      color: #ffffff;
      border: none;
      border-radius: 5px;
      padding: 4px 8px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .q9-small-btn.secondary {
      background: #475569;
    }
    .q9-lookup-result {
      font-size: 11px;
      color: #1e293b;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 5px;
      padding: 5px;
      max-height: 95px;
      overflow-y: auto;
      line-height: 1.4;
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    .q9-toast {
      position: fixed;
      bottom: 52px;
      right: 20px;
      background: rgba(15, 23, 42, 0.94);
      color: #fef08a;
      border: 1px solid #fcd34d;
      font-size: 12px;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 999px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.18s;
      z-index: 2147483647;
    }
    .q9-toast.visible {
      opacity: 1;
    }
  `;

  const containerEl = document.createElement("div");
  containerEl.innerHTML = `
    <!-- Floating IME Status Bar (like Chrome 速成 / Google Input Tools bar) -->
    <div class="q9-statusbar" id="q9-statusbar">
      <span class="q9-sb-logo" id="q9-sb-toggle" title="開關大口輸入法 (Alt+Q)">
        <span id="q9-sb-dot">●</span>
        <span id="q9-sb-title">大口</span>
      </span>
      <button class="q9-sb-chip" id="q9-sb-lang" title="切換 中/英 Swipe 滑行 (單按 Shift 或 / 鍵)">中</button>
      <button class="q9-sb-chip" id="q9-sb-mode" title="切換 大口字形 / 大口筆劃">字形</button>
      <button class="q9-sb-chip" id="q9-sb-variant" title="切換 繁體 / 簡體 (打繁出簡)">繁</button>
      <button class="q9-sb-chip" id="q9-sb-emoji" title="開啟 8大類 380+ Emoji 面板">😊</button>
      <button class="q9-sb-chip" id="q9-sb-smaller" title="縮小九宮格視窗">A-</button>
      <button class="q9-sb-chip" id="q9-sb-larger" title="放大九宮格視窗">A+</button>
      <button class="q9-sb-chip" id="q9-sb-pin" title="固定顯示九宮格視窗">九宮格</button>
    </div>

    <!-- Inline Caret Composition Bubble -->
    <div class="q9-caret-bubble hidden" id="q9-caret-bubble"></div>

    <!-- 3x3 Nine-Grid Candidate Window (Compact & Resizable) -->
    <div class="q9-window hidden" id="q9-window" role="dialog" aria-label="大口輸入法 Q9 IME">
      <div class="q9-header" id="q9-drag-handle" title="按住拖曳移動位置">
        <div class="q9-brand">
          <span class="q9-brand-badge">Q9</span>
          <button class="q9-pill-btn" id="q9-btn-mode" title="點擊切換 字形 / 筆劃">字形</button>
          <button class="q9-pill-btn" id="q9-btn-en" title="切換 ABC 英文 Swipe 滑行鍵盤">ABC</button>
          <button class="q9-pill-btn" id="q9-btn-emoji" title="開啟 8大類 380+ Emoji 面板">😊</button>
          <span class="q9-scale-tag" id="q9-scale-tag">85%</span>
        </div>
        <div class="q9-header-controls">
          <button class="q9-pill-btn" id="q9-btn-smaller" title="縮小視窗 (亦可拉動右下角縮放)">-</button>
          <button class="q9-pill-btn" id="q9-btn-larger" title="放大視窗 (亦可拉動右下角縮放)">+</button>
          <button class="q9-pill-btn" id="q9-btn-opacity" title="切換半透明防遮擋模式">透</button>
          <button class="q9-pill-btn" id="q9-btn-follow" title="跟隨游標自動彈出 vs 固定位置">游標</button>
          <button class="q9-pill-btn" id="q9-btn-lookup" title="反查大口碼 / 同音字">查</button>
          <button class="q9-pill-btn" id="q9-btn-close" title="收起九宮格視窗">×</button>
        </div>
      </div>

      <div class="q9-status-bar">
        <div class="q9-status-top">
          <div class="q9-code-box">
            <span>大口碼:</span>
            <span class="q9-code-digits" id="q9-code-digits">—</span>
          </div>
          <span class="q9-page-badge" id="q9-page-badge">就緒</span>
        </div>
        <div class="q9-breadcrumb" id="q9-breadcrumb">點擊網頁輸入框即可直接打字</div>
      </div>

      <!-- 1. Q9 3x3 Chinese View -->
      <div class="q9-subview" id="q9-q9-view">
        <div class="q9-grid" id="q9-grid"></div>

        <div class="q9-bottom-bar">
          <button class="q9-action-btn primary-zero" id="q9-btn-zero" data-q9-key="0">
            <span class="q9-action-key">0</span>
            <span id="q9-zero-label">標點</span>
          </button>
          <button class="q9-action-btn" id="q9-btn-dot" data-q9-key=".">
            <span class="q9-action-key">.</span>
            <span id="q9-dot-label">取消</span>
          </button>
          <button class="q9-action-btn" id="q9-btn-prev" data-q9-key="-" title="上一頁 (-)">
            <span class="q9-action-key">-</span>
            <span>上頁</span>
          </button>
          <button class="q9-action-btn" id="q9-btn-next" data-q9-key="+" title="下一頁 (+)">
            <span class="q9-action-key">+</span>
            <span>下頁</span>
          </button>
          <button class="q9-action-btn" id="q9-btn-bs" title="退格 / 長按連續高速刪除">
            <span>⌫ 刪</span>
          </button>
          <div class="q9-resize-grip" id="q9-resize-grip" title="按住拉動自由調節九宮格大小 (雙擊還原預設大小)"></div>
        </div>
      </div>

      <!-- 2. English QWERTY Swipe View -->
      <div class="q9-subview q9-en-view hidden" id="q9-en-view">
        <div class="q9-en-cands" id="q9-en-cands"></div>
        <div class="q9-en-row" id="q9-en-r1"></div>
        <div class="q9-en-row" id="q9-en-r2"></div>
        <div class="q9-en-row" id="q9-en-r3"></div>
        <div class="q9-en-row">
          <button class="q9-en-key" id="q9-en-back-q9" style="flex:1.2;background:#7f1d1d;color:#fef08a;">大口</button>
          <button class="q9-en-key" id="q9-en-to-emoji" style="flex:0.9;">😊</button>
          <button class="q9-en-key" id="q9-en-space" style="flex:2.8;">Space 空白</button>
          <button class="q9-en-key" id="q9-en-bs" style="flex:1.2;" title="點擊退格，長按連續刪除">⌫ 連刪</button>
        </div>
        <canvas class="q9-swipe-canvas" id="q9-swipe-canvas"></canvas>
      </div>

      <!-- 3. 8-Category 380+ Emoji Picker View -->
      <div class="q9-subview q9-emoji-view hidden" id="q9-emoji-view">
        <div class="q9-emoji-cats" id="q9-emoji-cats"></div>
        <div class="q9-emoji-grid" id="q9-emoji-grid"></div>
        <div class="q9-emoji-bar">
          <button class="q9-action-btn" id="q9-emoji-prev">◀ 上頁</button>
          <span class="q9-emoji-page" id="q9-emoji-page">1/2</span>
          <button class="q9-action-btn" id="q9-emoji-next">下頁 ▶</button>
          <button class="q9-action-btn" id="q9-emoji-bs" title="點擊退格，長按連續刪除">⌫ 刪</button>
          <button class="q9-action-btn" id="q9-emoji-back" style="background:#7f1d1d;color:#fef08a;">返回</button>
        </div>
      </div>

      <!-- Reverse Code & Homophone Lookup Drawer -->
      <div class="q9-drawer hidden" id="q9-lookup-drawer">
        <div class="q9-drawer-row">
          <input type="text" class="q9-input" id="q9-lookup-input" placeholder="輸入漢字查大口碼或查同音字..." />
          <button class="q9-small-btn" id="q9-lookup-btn">查碼</button>
          <button class="q9-small-btn secondary" id="q9-homophone-btn">同音</button>
        </div>
        <div class="q9-lookup-result" id="q9-lookup-result">輸入漢字即可顯示大口字形碼、筆劃碼及廣東話同音字。</div>
      </div>
    </div>

    <div class="q9-toast" id="q9-toast"></div>
  `;

  shadowRoot.appendChild(styleEl);
  shadowRoot.appendChild(containerEl);

  function mountHost() {
    if (document.documentElement && !document.documentElement.contains(hostEl)) {
      document.documentElement.appendChild(hostEl);
    }
  }
  if (document.documentElement) {
    mountHost();
  } else {
    window.addEventListener("DOMContentLoaded", mountHost, { once: true });
  }

  // Only show floating UI in top frame (or if an iframe itself has focus)
  const isTopFrame = window === window.top;
  if (!isTopFrame) {
    containerEl.style.display = "none";
  }

  // DOM References
  const statusbarEl = shadowRoot.getElementById("q9-statusbar");
  const sbToggle = shadowRoot.getElementById("q9-sb-toggle");
  const sbDot = shadowRoot.getElementById("q9-sb-dot");
  const sbTitle = shadowRoot.getElementById("q9-sb-title");
  const sbLang = shadowRoot.getElementById("q9-sb-lang");
  const sbMode = shadowRoot.getElementById("q9-sb-mode");
  const sbVariant = shadowRoot.getElementById("q9-sb-variant");
  const sbEmoji = shadowRoot.getElementById("q9-sb-emoji");
  const sbSmaller = shadowRoot.getElementById("q9-sb-smaller");
  const sbLarger = shadowRoot.getElementById("q9-sb-larger");
  const sbPin = shadowRoot.getElementById("q9-sb-pin");

  const caretBubbleEl = shadowRoot.getElementById("q9-caret-bubble");
  const windowEl = shadowRoot.getElementById("q9-window");
  const dragHandleEl = shadowRoot.getElementById("q9-drag-handle");
  const resizeGripEl = shadowRoot.getElementById("q9-resize-grip");
  const titleTextEl = shadowRoot.getElementById("q9-title-text");
  const scaleTagEl = shadowRoot.getElementById("q9-scale-tag");
  const btnSmaller = shadowRoot.getElementById("q9-btn-smaller");
  const btnLarger = shadowRoot.getElementById("q9-btn-larger");
  const btnOpacity = shadowRoot.getElementById("q9-btn-opacity");
  const btnMode = shadowRoot.getElementById("q9-btn-mode");
  const btnEn = shadowRoot.getElementById("q9-btn-en");
  const btnEmoji = shadowRoot.getElementById("q9-btn-emoji");
  const btnFollow = shadowRoot.getElementById("q9-btn-follow");
  const btnLookup = shadowRoot.getElementById("q9-btn-lookup");
  const btnClose = shadowRoot.getElementById("q9-btn-close");
  const codeDigitsEl = shadowRoot.getElementById("q9-code-digits");
  const pageBadgeEl = shadowRoot.getElementById("q9-page-badge");
  const breadcrumbEl = shadowRoot.getElementById("q9-breadcrumb");
  const q9ViewEl = shadowRoot.getElementById("q9-q9-view");
  const enViewEl = shadowRoot.getElementById("q9-en-view");
  const emojiViewEl = shadowRoot.getElementById("q9-emoji-view");
  const gridEl = shadowRoot.getElementById("q9-grid");
  const zeroLabelEl = shadowRoot.getElementById("q9-zero-label");
  const dotLabelEl = shadowRoot.getElementById("q9-dot-label");
  const lookupDrawer = shadowRoot.getElementById("q9-lookup-drawer");
  const lookupInput = shadowRoot.getElementById("q9-lookup-input");
  const lookupBtn = shadowRoot.getElementById("q9-lookup-btn");
  const homophoneBtn = shadowRoot.getElementById("q9-homophone-btn");
  const lookupResultEl = shadowRoot.getElementById("q9-lookup-result");
  const toastEl = shadowRoot.getElementById("q9-toast");

  const swipeEngine = typeof SwipeEngine !== "undefined" ? new SwipeEngine() : null;
  let emojiPanelOpen = false;
  let emojiCatIdx = 0;
  let emojiPageIdx = 0;
  let enShift = false;
  let enPrefix = "";

  const EXT_EMOJI_CATS = [
    { label: "🕒常用", items: ["😀","😂","🤣","😊","😍","🥰","😘","😎","🤔","😭","😡","👍","👎","👏","🙏","🤝","💪","❤️","🔥","✨","🎉","💯","🇭🇰","🍜","🧋","☕","🚀","💰","📱","✅","❌","❓","❗","💤","🥳","🤩"] },
    { label: "😀表情", items: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶"] },
    { label: "👋手勢", items: ["👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝️","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍️","💅","🤳","💪","🧠"] },
    { label: "❤️心形", items: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","💌","💋","💯","💢","💥","💫","💦","💨","🔥","✨","🌟","⭐","🌈","☀️","🌙","🎉","🎊"] },
    { label: "🐶動物", items: ["🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐻‍❄️","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐒","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🦋","🐢","🐙"] },
    { label: "🍔飲食", items: ["🍎","🍊","🍋","🍌","🍉","🍇","🍓","🍒","🍑","🥭","🍍","🥑","🍔","🍟","🍕","🌭","🥪","🌮","🍜","🍝","🍣","🍱","🍛","🍙","🍚","🥟","🍢","🍡","🍧","🍨","🍦","🍰","🎂","☕","🍵","🧋"] },
    { label: "🚀旅遊", items: ["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚲","🛵","🏍️","🚆","🚇","🚊","🚝","✈️","🛫","🛬","🚀","🛸","🚁","⛵","🚤","🛳️","🚢","🏠","🏢","🏥","🏦","🏨","🏪","🏫"] },
    { label: "🇭🇰標誌", items: ["🇭🇰","🇲🇴","🇹🇼","🇨🇳","🇯🇵","🇰🇷","🇬🇧","🇺🇸","🇨🇦","🇦🇺","🇸🇬","🇲🇾","📱","💻","⌚","📷","💡","💰","💎","🔑","🎁","🎈","🏆","🥇","⚽","🏀","🎮","🎵","🎬","📚","✏️","📌","🔒","🔔","✅","❌"] }
  ];

  // Build English QWERTY Swipe Keyboard inside Shadow DOM
  function initExtEnglishKeyboard() {
    const rows = [
      { id: "q9-en-r1", keys: ["q","w","e","r","t","y","u","i","o","p"] },
      { id: "q9-en-r2", keys: ["a","s","d","f","g","h","j","k","l"] },
      { id: "q9-en-r3", keys: ["SHIFT","z","x","c","v","b","n","m","."] }
    ];
    let lastTapAt = 0;
    rows.forEach((r) => {
      const rowEl = shadowRoot.getElementById(r.id);
      rowEl.innerHTML = "";
      r.keys.forEach((k) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "q9-en-key";
        if (k === "SHIFT") {
          btn.id = "q9-en-shift";
          btn.style.flex = "1.3";
          btn.textContent = "⇧";
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            enShift = !enShift;
            renderExtEnKeys();
          });
        } else if (k === ".") {
          btn.textContent = ".";
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            enPrefix = "";
            insertTextDirect(". ");
            renderExtEnCands();
          });
        } else {
          btn.dataset.letter = k;
          btn.textContent = k;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (Date.now() - lastTapAt < 380) return;
            const out = enShift ? k.toUpperCase() : k;
            enPrefix += k;
            if (enShift) {
              enShift = false;
              renderExtEnKeys();
            }
            insertTextDirect(out);
            renderExtEnCands();
          });
        }
        rowEl.appendChild(btn);
      });
    });

    shadowRoot.getElementById("q9-en-back-q9").addEventListener("click", (e) => {
      e.stopPropagation();
      engine.englishMode = false;
      emojiPanelOpen = false;
      renderUI();
    });
    shadowRoot.getElementById("q9-en-to-emoji").addEventListener("click", (e) => {
      e.stopPropagation();
      emojiPanelOpen = true;
      renderUI();
    });
    shadowRoot.getElementById("q9-en-space").addEventListener("click", (e) => {
      e.stopPropagation();
      enPrefix = "";
      insertTextDirect(" ");
      renderExtEnCands();
    });

    // Coordinate-based Swipe gesture on enViewEl
    const canvas = shadowRoot.getElementById("q9-swipe-canvas");
    const sw = { active: false, keys: [], pts: [], lastX: 0, lastY: 0 };

    function syncCanvas() {
      const r = enViewEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        canvas.width = Math.round(r.width);
        canvas.height = Math.round(r.height);
      }
    }

    function hitKey(cx, cy) {
      const buttons = enViewEl.querySelectorAll(".q9-en-key[data-letter]");
      let best = null;
      let bestD = 26;
      buttons.forEach((b) => {
        const br = b.getBoundingClientRect();
        if (cx >= br.left && cx <= br.right && cy >= br.top && cy <= br.bottom) {
          best = b;
          bestD = -1;
        } else if (bestD >= 0) {
          const d = Math.hypot(cx - (br.left + br.width / 2), cy - (br.top + br.height / 2));
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      });
      return best;
    }

    function drawTrail() {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (sw.pts.length < 2) return;
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(sw.pts[0].x, sw.pts[0].y);
      for (let i = 1; i < sw.pts.length; i++) ctx.lineTo(sw.pts[i].x, sw.pts[i].y);
      ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.strokeStyle = "#dc2626";
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    function recordKey(btn) {
      if (!btn || !btn.dataset.letter) return;
      const ch = btn.dataset.letter;
      if (sw.keys[sw.keys.length - 1] !== ch) {
        sw.keys.push(ch);
        btn.classList.add("swiped-over");
        if (sw.keys.length >= 2 && swipeEngine) {
          renderExtEnCands(swipeEngine.decodeSwipe(sw.keys, 5));
        }
      }
    }

    function startSw(cx, cy) {
      const k = hitKey(cx, cy);
      if (!k) return false;
      syncCanvas();
      sw.active = true;
      sw.keys = [];
      sw.pts = [];
      sw.lastX = cx;
      sw.lastY = cy;
      enViewEl.querySelectorAll(".q9-en-key.swiped-over").forEach((b) => b.classList.remove("swiped-over"));
      const r = enViewEl.getBoundingClientRect();
      const scale = windowScale || 1;
      sw.pts.push({ x: (cx - r.left) / scale, y: (cy - r.top) / scale });
      recordKey(k);
      return true;
    }

    function moveSw(cx, cy) {
      if (!sw.active) return;
      const dist = Math.hypot(cx - sw.lastX, cy - sw.lastY);
      const steps = Math.max(1, Math.min(10, Math.ceil(dist / 7)));
      for (let s = 1; s <= steps; s++) {
        const ix = sw.lastX + ((cx - sw.lastX) * s) / steps;
        const iy = sw.lastY + ((cy - sw.lastY) * s) / steps;
        recordKey(hitKey(ix, iy));
      }
      sw.lastX = cx;
      sw.lastY = cy;
      const r = enViewEl.getBoundingClientRect();
      const scale = windowScale || 1;
      sw.pts.push({ x: (cx - r.left) / scale, y: (cy - r.top) / scale });
      if (sw.pts.length > 60) sw.pts.shift();
      drawTrail();
    }

    function endSw() {
      if (!sw.active) return;
      sw.active = false;
      const seq = sw.keys.slice();
      if (seq.length >= 2 && swipeEngine) {
        lastTapAt = Date.now();
        const cands = swipeEngine.decodeSwipe(seq, 5);
        if (cands.length) {
          let w = cands[0];
          if (enShift) {
            w = w.charAt(0).toUpperCase() + w.slice(1);
            enShift = false;
            renderExtEnKeys();
          }
          enPrefix = "";
          insertTextDirect(w + " ");
          renderExtEnCands(cands);
          showToast(`Swipe 滑行輸入：${w}`);
        }
      } else if (seq.length === 1) {
        lastTapAt = Date.now();
        const k = seq[0];
        const out = enShift ? k.toUpperCase() : k;
        enPrefix += k;
        if (enShift) {
          enShift = false;
          renderExtEnKeys();
        }
        insertTextDirect(out);
        renderExtEnCands();
      }
      setTimeout(() => {
        enViewEl.querySelectorAll(".q9-en-key.swiped-over").forEach((b) => b.classList.remove("swiped-over"));
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        sw.pts = [];
      }, 220);
    }

    enViewEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (startSw(e.clientX, e.clientY) && e.cancelable) e.preventDefault();
    });
    window.addEventListener("pointermove", (e) => {
      if (sw.active) moveSw(e.clientX, e.clientY);
    });
    window.addEventListener("pointerup", () => {
      if (sw.active) endSw();
    });
    renderExtEnCands();
  }

  function renderExtEnKeys() {
    const sBtn = shadowRoot.getElementById("q9-en-shift");
    if (sBtn) sBtn.style.background = enShift ? "#fef08a" : "";
    enViewEl.querySelectorAll(".q9-en-key[data-letter]").forEach((b) => {
      const ch = b.dataset.letter;
      b.textContent = enShift ? ch.toUpperCase() : ch;
    });
  }

  function renderExtEnCands(customList) {
    const box = shadowRoot.getElementById("q9-en-cands");
    if (!box || !swipeEngine) return;
    box.innerHTML = "";
    const words = customList || swipeEngine.getPrefixSuggestions(enPrefix, 5);
    words.forEach((w, idx) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "q9-en-chip" + (idx === 0 ? " primary" : "");
      chip.textContent = w;
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        if (enPrefix) {
          for (let i = 0; i < enPrefix.length; i++) performDirectBackspace();
          enPrefix = "";
        }
        insertTextDirect(w + " ");
        renderExtEnCands();
      });
      box.appendChild(chip);
    });
  }

  function renderExtEmojiView() {
    const catsEl = shadowRoot.getElementById("q9-emoji-cats");
    const gridBox = shadowRoot.getElementById("q9-emoji-grid");
    const pageEl = shadowRoot.getElementById("q9-emoji-page");
    if (!catsEl || !gridBox) return;

    catsEl.innerHTML = "";
    EXT_EMOJI_CATS.forEach((cat, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "q9-emoji-cat-btn" + (idx === emojiCatIdx ? " active" : "");
      b.textContent = cat.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        emojiCatIdx = idx;
        emojiPageIdx = 0;
        renderExtEmojiView();
      });
      catsEl.appendChild(b);
    });

    const cat = EXT_EMOJI_CATS[emojiCatIdx] || EXT_EMOJI_CATS[0];
    const perPage = 18;
    const totalPages = Math.max(1, Math.ceil(cat.items.length / perPage));
    if (emojiPageIdx >= totalPages) emojiPageIdx = 0;
    if (emojiPageIdx < 0) emojiPageIdx = totalPages - 1;
    pageEl.textContent = `${emojiPageIdx + 1}/${totalPages}`;

    gridBox.innerHTML = "";
    const slice = cat.items.slice(emojiPageIdx * perPage, (emojiPageIdx + 1) * perPage);
    slice.forEach((em) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "q9-emoji-cell";
      cell.textContent = em;
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        insertTextDirect(em);
      });
      gridBox.appendChild(cell);
    });
  }

  function showToast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("visible");
    }, ms || 1500);
  }

  // Prevent clicking inside Q9 UI from stealing focus from the webpage's active input box!
  windowEl.addEventListener("mousedown", (e) => {
    const tag = (e.target.tagName || "").toUpperCase();
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "OPTION") {
      e.preventDefault();
    }
  });
  statusbarEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  // Track focusin / focusout / click on page to pop up 9-grid automatically near input box
  document.addEventListener(
    "focusin",
    (e) => {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const target = path[0] || e.target;
      if (hostEl && hostEl.contains(target)) return;
      if (isEditableElement(target)) {
        lastFocusedEditable = target;
        isInputCurrentlyFocused = true;
        if (!isTopFrame) {
          containerEl.style.display = "block";
        }
        renderUI();
      }
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      const path = e.composedPath ? e.composedPath() : [e.target];
      const target = path[0] || e.target;
      if (hostEl && hostEl.contains(target)) return;
      setTimeout(() => {
        const active = getDeepActiveElement();
        if (isEditableElement(active)) {
          lastFocusedEditable = active;
          isInputCurrentlyFocused = true;
        } else if (getDocsFrameEditable()) {
          isInputCurrentlyFocused = true;
        } else {
          isInputCurrentlyFocused = false;
          engine.reset(true);
        }
        renderUI();
      }, 60);
    },
    true
  );

  // Draggable window + Corner-Resize support
  let isDragging = false;
  let isResizing = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let resizeStartX = 0;
  let resizeStartScale = 0.85;

  dragHandleEl.addEventListener("mousedown", (e) => {
    if ((e.target.tagName || "").toUpperCase() === "BUTTON") return;
    isDragging = true;
    const rect = windowEl.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  resizeGripEl.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    isResizing = true;
    resizeStartX = e.clientX;
    resizeStartScale = windowScale;
  });

  resizeGripEl.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    windowScale = windowScale < 0.8 ? 0.85 : 0.68;
    savePrefs();
    renderUI();
    showToast(`視窗大小：${Math.round(windowScale * 100)}%`);
  });

  window.addEventListener("mousemove", (e) => {
    if (isResizing) {
      const deltaX = e.clientX - resizeStartX;
      const nextScale = clampScale(resizeStartScale + deltaX / 232);
      windowScale = nextScale;
      windowEl.style.setProperty("--q9-scale", String(windowScale));
      scaleTagEl.textContent = `${Math.round(windowScale * 100)}%`;
      return;
    }
    if (!isDragging) return;
    const visW = Math.round(232 * windowScale);
    const visH = Math.round(248 * windowScale);
    const x = Math.max(8, Math.min(window.innerWidth - visW - 8, e.clientX - dragOffsetX));
    const y = Math.max(8, Math.min(window.innerHeight - visH - 8, e.clientY - dragOffsetY));
    userDraggedPos = { left: x, top: y };
    followCursor = false; // Switching to fixed position where user dragged it
    windowEl.style.left = `${x}px`;
    windowEl.style.top = `${y}px`;
    windowEl.style.right = "auto";
    windowEl.style.bottom = "auto";
  });
  window.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      savePrefs();
      renderUI();
      showToast(`已調節視窗大小：${Math.round(windowScale * 100)}%`);
    }
    if (isDragging) {
      isDragging = false;
      savePrefs();
      renderUI();
    }
  });

  // Position the 9-grid window near the active input / caret without blocking text
  function positionWindowNearTarget(target, state) {
    if (!target) return;
    if (target.ownerDocument && target.ownerDocument !== document) {
      target = {
        getBoundingClientRect() {
          const c = document.querySelector(".kix-cursor-caret");
          const r = c && c.getBoundingClientRect();
          if (r && (r.width > 0 || r.height > 0)) return r;
          const w = window.innerWidth;
          const h = window.innerHeight;
          return { left: w / 2, right: w / 2 + 1, top: h / 2, bottom: h / 2 + 20, width: 1, height: 20 };
        }
      };
    }
    const rect = getTargetCaretRect(target);
    if (!rect) return;

    // Position inline caret composition bubble inside the active input (top-right) so it never covers field labels
    if (state.charset || state.isSelecting) {
      caretBubbleEl.textContent = `大口 [${state.charset || "選字"}]`;
      caretBubbleEl.classList.remove("hidden");
      const boxRect = target.getBoundingClientRect ? target.getBoundingClientRect() : rect;
      const bx = Math.max(8, Math.min(window.innerWidth - 120, boxRect.right - 96));
      const by = Math.max(8, boxRect.top + 8);
      caretBubbleEl.style.left = `${Math.round(bx)}px`;
      caretBubbleEl.style.top = `${Math.round(by)}px`;
    } else {
      caretBubbleEl.classList.add("hidden");
    }

    const winW = Math.round(232 * windowScale);
    const winH = Math.round((lookupOpen ? 370 : 246) * windowScale);

    if (!followCursor) {
      if (userDraggedPos) {
        windowEl.style.left = `${userDraggedPos.left}px`;
        windowEl.style.top = `${userDraggedPos.top}px`;
        windowEl.style.right = "auto";
        windowEl.style.bottom = "auto";
      } else {
        windowEl.style.left = `${Math.max(12, window.innerWidth - winW - 16)}px`;
        windowEl.style.top = `${Math.max(12, window.innerHeight - winH - 52)}px`;
        windowEl.style.right = "auto";
        windowEl.style.bottom = "auto";
      }
      return;
    }

    const boxRect = target.getBoundingClientRect ? target.getBoundingClientRect() : rect;
    let left = boxRect.right + 12;
    let top = boxRect.top;

    // Prefer placing neatly to the RIGHT of the input box so it never blocks fields below; if no space on right, place below
    if (left + winW > window.innerWidth - 12) {
      left = Math.max(12, Math.min(window.innerWidth - winW - 12, rect.left));
      top = boxRect.bottom + 8;
      if (top + winH > window.innerHeight - 48) {
        if (boxRect.top - winH - 8 > 8) {
          top = boxRect.top - winH - 8;
        } else {
          left = Math.max(12, window.innerWidth - winW - 16);
          top = Math.max(12, window.innerHeight - winH - 52);
        }
      }
    } else if (top + winH > window.innerHeight - 48) {
      top = Math.max(12, window.innerHeight - winH - 52);
    }

    windowEl.style.left = `${Math.round(left)}px`;
    windowEl.style.top = `${Math.round(top)}px`;
    windowEl.style.right = "auto";
    windowEl.style.bottom = "auto";
  }

  function handleQ9VirtualKey(q9Key) {
    if (!engine.enabled) {
      engine.enabled = true;
    }
    const res = engine.handleKey(q9Key);
    if (res.action === "commit" && res.text) {
      insertTextDirect(res.text);
    }
    renderUI();
    return res;
  }

  function shouldShowGridWindow(state) {
    if (!engine.enabled) return false;
    if (pinnedOpen || lookupOpen || emojiPanelOpen || state.englishMode) return true;
    if (state.charset !== "" || state.isSelecting) return true;
    if (autoHideIdle) return false;
    if (isInputCurrentlyFocused) return true;
    return false;
  }

  function renderUI() {
    const state = engine.getGridState();
    const activeTarget = findActiveEditableTarget();

    windowEl.style.setProperty("--q9-scale", String(windowScale));
    windowEl.style.setProperty("--q9-opacity", String(windowOpacity));
    scaleTagEl.textContent = `${Math.round(windowScale * 100)}%`;

    // Update Compact Status Bar
    statusbarEl.classList.toggle("disabled", !engine.enabled);
    sbDot.textContent = engine.enabled ? "●" : "○";
    sbTitle.textContent = engine.enabled ? "大口 ON" : "大口 OFF";
    sbLang.textContent = state.englishMode ? "ABC滑行" : "中";
    sbLang.classList.toggle("active", engine.enabled && !state.englishMode);
    sbMode.textContent = state.mode === "stroke" ? "筆劃" : "字形";
    sbVariant.textContent = state.variant === "simp" ? "簡" : "繁";
    sbVariant.classList.toggle("active", state.variant === "simp");
    if (sbEmoji) sbEmoji.classList.toggle("active", emojiPanelOpen);

    const showWin = shouldShowGridWindow(state);
    sbPin.classList.toggle("active", pinnedOpen);
    windowEl.classList.toggle("hidden", !showWin);

    if (!showWin) {
      caretBubbleEl.classList.add("hidden");
      return;
    }

    btnMode.textContent = state.mode === "stroke" ? "筆劃" : "字形";
    if (btnEn) btnEn.classList.toggle("active", state.englishMode && !emojiPanelOpen);
    if (btnEmoji) btnEmoji.classList.toggle("active", emojiPanelOpen);
    btnFollow.textContent = followCursor ? "游標" : "固定";
    btnFollow.classList.toggle("active", followCursor);
    btnOpacity.classList.toggle("active", windowOpacity < 0.9);
    btnLookup.classList.toggle("active", lookupOpen);

    // Toggle subviews: Emoji vs English Swipe vs Q9 3x3
    q9ViewEl.classList.toggle("hidden", emojiPanelOpen || state.englishMode);
    enViewEl.classList.toggle("hidden", emojiPanelOpen || !state.englishMode);
    emojiViewEl.classList.toggle("hidden", !emojiPanelOpen);

    if (emojiPanelOpen) {
      codeDigitsEl.textContent = "😊";
      pageBadgeEl.textContent = `8大類 Emoji`;
      breadcrumbEl.textContent = "點選分類與 ◀/▶ 翻頁，長按 ⌫ 連續刪除";
      renderExtEmojiView();
    } else if (state.englishMode) {
      codeDigitsEl.textContent = "ABC";
      pageBadgeEl.textContent = "Swipe 滑行";
      breadcrumbEl.textContent = "按住英文字母滑行 (Swipe) 即時組字，長按 ⌫ 連刪";
      renderExtEnCands();
    } else {
      codeDigitsEl.textContent = state.charset || "—";
      pageBadgeEl.textContent = state.isSelecting
        ? `第 ${state.currentPage}/${state.totalPages} 頁`
        : state.lastUsedWord
        ? `關聯字預覽`
        : `待命`;
      breadcrumbEl.textContent = state.breadcrumb;
    }

    zeroLabelEl.textContent = state.zeroLabel;
    dotLabelEl.textContent = state.dotLabel;
    lookupDrawer.classList.toggle("hidden", !lookupOpen);

    // Render 3x3 cells
    gridEl.innerHTML = "";
    const showLaptopHint = state.keyboardLayout === "laptop";

    for (const cell of state.cells) {
      const btn = document.createElement("div");
      btn.className = "q9-cell";
      btn.setAttribute("data-q9-cell", cell.key);
      if (cell.showCandidatePrimary) {
        btn.classList.add("selecting");
        if (!cell.candidate) btn.classList.add("empty-slot");
        if (cell.isHkscs) btn.classList.add("hkscs-char");
      }

      const keyBadge = document.createElement("div");
      keyBadge.className = "q9-cell-key";
      keyBadge.innerHTML = `<span>${cell.key}</span>${
        showLaptopHint ? `<span class="q9-cell-laptop">${cell.laptopKey}</span>` : ""
      }`;
      btn.appendChild(keyBadge);

      if (cell.showCandidatePrimary) {
        if (cell.isHkscs) {
          const hkBadge = document.createElement("span");
          hkBadge.className = "q9-cell-hkscs";
          hkBadge.textContent = "HK";
          hkBadge.title = "香港增補字符集 (HKSCS)";
          btn.appendChild(hkBadge);
        }
        const mainEl = document.createElement("div");
        mainEl.className = "q9-cell-main";
        mainEl.textContent = cell.candidate || "";
        btn.appendChild(mainEl);

        if (cell.subRadical) {
          const subEl = document.createElement("div");
          subEl.className = "q9-cell-sub";
          subEl.textContent = cell.subRadical;
          btn.appendChild(subEl);
        }
      } else {
        if (cell.showPreviewChar && cell.candidate) {
          const prevEl = document.createElement("div");
          prevEl.className = "q9-cell-preview";
          prevEl.textContent = cell.candidate;
          btn.appendChild(prevEl);
        }

        const mainEl = document.createElement("div");
        mainEl.className = "q9-cell-main";
        mainEl.textContent = cell.mainRadical;
        btn.appendChild(mainEl);

        const subEl = document.createElement("div");
        subEl.className = "q9-cell-sub";
        subEl.textContent = cell.subRadical;
        btn.appendChild(subEl);
      }

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleQ9VirtualKey(cell.key);
      });

      gridEl.appendChild(btn);
    }

    positionWindowNearTarget(activeTarget, state);
  }

  // ---- Status bar: draggable, minimizable, hideable (position/state persisted) ----
  const sbExtraStyle = document.createElement("style");
  sbExtraStyle.textContent = `
    .q9-statusbar { cursor: grab; touch-action: none; }
    .q9-statusbar.dragging { cursor: grabbing; }
    .q9-statusbar .q9-sb-chip { cursor: pointer; }
    .q9-statusbar.min #q9-sb-title,
    .q9-statusbar.min .q9-sb-chip:not(#q9-sb-min) { display: none; }
  `;
  shadowRoot.appendChild(sbExtraStyle);

  const sbMinBtn = document.createElement("button");
  sbMinBtn.className = "q9-sb-chip";
  sbMinBtn.id = "q9-sb-min";
  sbMinBtn.title = "縮小 / 還原狀態列";
  const sbHideBtn = document.createElement("button");
  sbHideBtn.className = "q9-sb-chip";
  sbHideBtn.id = "q9-sb-hide";
  sbHideBtn.title = "隱藏狀態列 (按 Ctrl+Alt+H 重新顯示)";
  sbHideBtn.textContent = "✕";
  statusbarEl.appendChild(sbMinBtn);
  statusbarEl.appendChild(sbHideBtn);

  let sbPos = null; // { left, top } once the user has dragged the bar
  let sbMin = false;
  let sbHidden = false;
  let sbDrag = null;
  let sbDidDrag = false;

  function applySbLayout() {
    statusbarEl.style.display = sbHidden ? "none" : "";
    statusbarEl.classList.toggle("min", sbMin);
    sbMinBtn.textContent = sbMin ? "＋" : "–";
    if (sbPos && !sbHidden) {
      const r = statusbarEl.getBoundingClientRect();
      const left = Math.max(4, Math.min(window.innerWidth - (r.width || 120) - 4, sbPos.left));
      const top = Math.max(4, Math.min(window.innerHeight - (r.height || 30) - 4, sbPos.top));
      statusbarEl.style.left = left + "px";
      statusbarEl.style.top = top + "px";
      statusbarEl.style.right = "auto";
      statusbarEl.style.bottom = "auto";
    } else if (!sbPos) {
      statusbarEl.style.left = "";
      statusbarEl.style.top = "";
      statusbarEl.style.right = "";
      statusbarEl.style.bottom = "";
    }
  }
  function saveSbPrefs() {
    try {
      if (extApi && extApi.storage && extApi.storage.local) {
        extApi.storage.local.set({ q9_sb_pos: sbPos, q9_sb_min: sbMin, q9_sb_hidden: sbHidden });
      }
    } catch (_) {}
  }
  function setSbHidden(hide) {
    sbHidden = hide;
    applySbLayout();
    saveSbPrefs();
    showToast(hide ? "大口狀態列已隱藏，按 Ctrl+Alt+H 重新顯示" : "大口狀態列已顯示", 2500);
  }

  statusbarEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = statusbarEl.getBoundingClientRect();
    sbDrag = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, moved: false };
  });
  window.addEventListener(
    "pointermove",
    (e) => {
      if (!sbDrag) return;
      const dx = e.clientX - sbDrag.sx;
      const dy = e.clientY - sbDrag.sy;
      if (!sbDrag.moved && Math.hypot(dx, dy) < 5) return;
      sbDrag.moved = true;
      statusbarEl.classList.add("dragging");
      sbPos = { left: sbDrag.ox + dx, top: sbDrag.oy + dy };
      applySbLayout();
    },
    true
  );
  window.addEventListener(
    "pointerup",
    () => {
      if (sbDrag && sbDrag.moved) {
        sbDidDrag = true;
        setTimeout(() => { sbDidDrag = false; }, 0);
        statusbarEl.classList.remove("dragging");
        saveSbPrefs();
      }
      sbDrag = null;
    },
    true
  );
  // A drag must not trigger the button under the pointer.
  statusbarEl.addEventListener(
    "click",
    (e) => {
      if (sbDidDrag) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true
  );
  sbMinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    sbMin = !sbMin;
    applySbLayout();
    saveSbPrefs();
  });
  sbHideBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setSbHidden(true);
  });
  statusbarEl.addEventListener("dblclick", (e) => {
    // double-click the empty part of the bar to snap it back to the default corner
    if (e.target === statusbarEl) {
      sbPos = null;
      applySbLayout();
      saveSbPrefs();
    }
  });
  window.addEventListener("resize", () => applySbLayout());

  try {
    if (extApi && extApi.storage && extApi.storage.local) {
      extApi.storage.local.get(["q9_sb_pos", "q9_sb_min", "q9_sb_hidden"], (res) => {
        if (!res) return;
        if (res.q9_sb_pos && typeof res.q9_sb_pos.left === "number") sbPos = res.q9_sb_pos;
        if (typeof res.q9_sb_min === "boolean") sbMin = res.q9_sb_min;
        if (typeof res.q9_sb_hidden === "boolean") sbHidden = res.q9_sb_hidden;
        applySbLayout();
      });
    }
  } catch (_) {}
  applySbLayout();

  // Bind Status Bar & Header Buttons
  function toggleEnabled() {
    engine.enabled = !engine.enabled;
    if (!engine.enabled) engine.reset(true);
    savePrefs();
    renderUI();
    showToast(engine.enabled ? "大口輸入法已啟用 (直接打字)" : "大口輸入法已暫停");
  }

  function toggleMode() {
    engine.setMode(engine.mode === "shape" ? "stroke" : "shape");
    savePrefs();
    renderUI();
    showToast(`已切換：${engine.mode === "stroke" ? "大口筆劃輸入法" : "大口字形輸入法"}`);
  }

  function toggleVariant() {
    engine.setVariant(engine.variant === "trad" ? "simp" : "trad");
    savePrefs();
    renderUI();
    showToast(`輸出字體：${engine.variant === "simp" ? "打繁出簡 (簡體)" : "標準繁體 (含HKSCS)"}`);
  }

  function toggleLang() {
    emojiPanelOpen = false;
    engine.toggleEnglishMode();
    if (engine.englishMode && !engine.enabled) engine.enabled = true;
    renderUI();
    showToast(engine.englishMode ? "英文 Swipe 滑行模式 (按住字母滑行打字)" : "中文大口模式");
  }

  function toggleEmojiPanel() {
    if (!engine.enabled) engine.enabled = true;
    emojiPanelOpen = !emojiPanelOpen;
    renderUI();
    showToast(emojiPanelOpen ? "已開啟 8大分類 380+ Emoji 面板" : "返回打字面板");
  }

  function stepScale(delta) {
    windowScale = clampScale(windowScale + delta);
    savePrefs();
    renderUI();
    showToast(`視窗大小：${Math.round(windowScale * 100)}% (亦可拉動右下角自由縮放)`);
  }

  function toggleOpacity() {
    if (windowOpacity >= 0.92) {
      windowOpacity = 0.76;
    } else if (windowOpacity >= 0.72) {
      windowOpacity = 0.58;
    } else {
      windowOpacity = 0.96;
    }
    savePrefs();
    renderUI();
    showToast(`視窗透明度：${Math.round(windowOpacity * 100)}% (滑鼠移上自動清晰)`);
  }

  sbToggle.addEventListener("click", toggleEnabled);
  sbMode.addEventListener("click", toggleMode);
  btnMode.addEventListener("click", () => {
    emojiPanelOpen = false;
    engine.englishMode = false;
    toggleMode();
  });
  sbVariant.addEventListener("click", toggleVariant);
  sbLang.addEventListener("click", toggleLang);
  if (btnEn) btnEn.addEventListener("click", toggleLang);
  if (sbEmoji) sbEmoji.addEventListener("click", toggleEmojiPanel);
  if (btnEmoji) btnEmoji.addEventListener("click", toggleEmojiPanel);
  btnSmaller.addEventListener("click", () => stepScale(-0.1));
  btnLarger.addEventListener("click", () => stepScale(0.1));
  sbSmaller.addEventListener("click", () => stepScale(-0.1));
  sbLarger.addEventListener("click", () => stepScale(0.1));
  btnOpacity.addEventListener("click", toggleOpacity);

  // Initialize embedded English Swipe Keyboard, Emoji pagination & Repeatable Backspace buttons
  initExtEnglishKeyboard();
  bindRepeatableDelete(shadowRoot.getElementById("q9-btn-bs"));
  bindRepeatableDelete(shadowRoot.getElementById("q9-en-bs"));
  bindRepeatableDelete(shadowRoot.getElementById("q9-emoji-bs"));

  shadowRoot.getElementById("q9-emoji-prev").addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPageIdx--;
    const cat = EXT_EMOJI_CATS[emojiCatIdx] || EXT_EMOJI_CATS[0];
    const totalPages = Math.max(1, Math.ceil(cat.items.length / 18));
    if (emojiPageIdx < 0) {
      emojiCatIdx = (emojiCatIdx - 1 + EXT_EMOJI_CATS.length) % EXT_EMOJI_CATS.length;
      const prevCat = EXT_EMOJI_CATS[emojiCatIdx];
      emojiPageIdx = Math.max(0, Math.ceil(prevCat.items.length / 18) - 1);
    }
    renderExtEmojiView();
  });
  shadowRoot.getElementById("q9-emoji-next").addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPageIdx++;
    const cat = EXT_EMOJI_CATS[emojiCatIdx] || EXT_EMOJI_CATS[0];
    const totalPages = Math.max(1, Math.ceil(cat.items.length / 18));
    if (emojiPageIdx >= totalPages) {
      emojiCatIdx = (emojiCatIdx + 1) % EXT_EMOJI_CATS.length;
      emojiPageIdx = 0;
    }
    renderExtEmojiView();
  });
  shadowRoot.getElementById("q9-emoji-back").addEventListener("click", (e) => {
    e.stopPropagation();
    emojiPanelOpen = false;
    renderUI();
  });

  sbPin.addEventListener("click", () => {
    pinnedOpen = !pinnedOpen;
    if (pinnedOpen && !engine.enabled) engine.enabled = true;
    savePrefs();
    renderUI();
  });

  btnFollow.addEventListener("click", () => {
    followCursor = !followCursor;
    if (followCursor) userDraggedPos = null;
    savePrefs();
    renderUI();
    showToast(followCursor ? "九宮格已設為：跟隨輸入框右側/下方彈出" : "九宮格已設為：固定位置");
  });

  btnLookup.addEventListener("click", () => {
    lookupOpen = !lookupOpen;
    if (lookupOpen) pinnedOpen = true;
    renderUI();
    if (lookupOpen) setTimeout(() => lookupInput.focus(), 20);
  });

  btnClose.addEventListener("click", () => {
    pinnedOpen = false;
    lookupOpen = false;
    isInputCurrentlyFocused = false;
    engine.reset(true);
    savePrefs();
    renderUI();
  });

  for (const btnId of ["q9-btn-zero", "q9-btn-dot", "q9-btn-prev", "q9-btn-next"]) {
    const el = shadowRoot.getElementById(btnId);
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      handleQ9VirtualKey(el.getAttribute("data-q9-key"));
    });
  }

  function runReverseLookup() {
    const q = (lookupInput.value || "").trim();
    if (!q) return;
    const res = engine.reverseLookup(q);
    if (res.length === 0) {
      lookupResultEl.textContent = `找不到「${q}」的大口編碼。`;
      return;
    }
    const htmlParts = res.map((item) => {
      const shapeStr =
        item.shapeCodes
          .map(
            (c) =>
              `<b>${c.code}</b> (${c.steps.join(" → ")} · 第${c.page}頁按<b>${c.selectKey}</b>)`
          )
          .join("； ") || "無";
      const strokeStr =
        item.strokeCodes
          .slice(0, 3)
          .map((c) => `<b>${c.code}</b> (第${c.page}頁按<b>${c.selectKey}</b>)`)
          .join("； ") || "無";
      const jp = item.jyutping.length ? ` [粵拼: ${item.jyutping.join("/")}]` : "";
      const hk = item.isHkscs ? ` <span style="color:#dc2626;font-weight:bold;">[HKSCS]</span>` : "";
      return `<div>【<b>${item.char}</b>】${hk}${jp}<br/>▸ 字形碼: ${shapeStr}<br/>▸ 筆劃碼: ${strokeStr}</div>`;
    });
    lookupResultEl.innerHTML = htmlParts.join("<hr style='margin:4px 0;border:none;border-top:1px solid #e2e8f0;'/>");
  }

  lookupBtn.addEventListener("click", runReverseLookup);
  lookupInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") runReverseLookup();
  });

  homophoneBtn.addEventListener("click", () => {
    const q = (lookupInput.value || "").trim();
    if (!q) return;
    if (engine.enterHomophoneMode(q)) {
      renderUI();
      showToast(`已載入「${q[0]}」的同音字`);
    } else {
      lookupResultEl.textContent = `找不到「${q[0]}」的廣東話同音字記錄。`;
    }
  });

  // Tap-Shift detection (like Chrome 速成 plugin / Windows IME to toggle 中/英)
  const onKeyUp = (e) => {
    if (e.__q9Synthetic || e.__q9UpSeen) return;
    e.__q9UpSeen = true;
    if ((e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") && shiftKeyDownAlone) {
      shiftKeyDownAlone = false;
      if (engine.enabled && findActiveEditableTarget()) {
        toggleLang();
      }
    }
  };
  window.addEventListener("keyup", onKeyUp, true);

  // Global Keyboard Interceptor (Capture Phase) — intercepts keys directly inside ANY webpage input!
  const onKeyDown = (e) => {
      if (e.__q9Synthetic || e.__q9Seen) return;
      e.__q9Seen = true;
      if (docsPending && e.isTrusted && (e.ctrlKey || e.metaKey) && e.code === "KeyV") {
        setTimeout(() => { docsPending = ""; }, 100);
        return;
      }
      // Ctrl+Alt+H: show / hide the floating status bar
      if (e.ctrlKey && e.altKey && !e.metaKey && e.code === "KeyH" && isTopFrame) {
        e.preventDefault();
        e.stopPropagation();
        setSbHidden(!sbHidden);
        return;
      }
      if (e.key === "Shift" || e.code === "ShiftLeft" || e.code === "ShiftRight") {
        shiftKeyDownAlone = !e.ctrlKey && !e.altKey && !e.metaKey;
        return;
      } else {
        shiftKeyDownAlone = false;
      }

      // Global Toggle Shortcut: Alt+Q or Ctrl+Shift+Digit9
      if (
        (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyQ") ||
        (e.ctrlKey && e.shiftKey && e.code === "Digit9")
      ) {
        e.preventDefault();
        e.stopPropagation();
        toggleEnabled();
        return;
      }

      // Docs mode switcher: Ctrl+Alt+1..7 ; Ctrl+Alt+0 = event spy
      if (e.ctrlKey && e.altKey && /^(Digit|Numpad)[0-7]$/.test(e.code || "") && getDocsFrameEditable()) {
        e.preventDefault();
        e.stopPropagation();
        const n = Number(e.code.slice(-1));
        if (n === 0) {
          setDocsSpy(!docsSpyOn);
          showToast("Docs 事件監察：" + (docsSpyOn ? "ON" : "OFF"));
        } else {
          DOCS_INSERT_MODE = DOCS_MODES[n - 1];
          docsPending = "";
          showToast("Docs 輸入模式：" + DOCS_INSERT_MODE);
        }
        return;
      }

      if (!engine.enabled) return;
      if (engine.keyboardLayout === "mouse") return;

      // Do not intercept typing inside the reverse lookup box
      const shadowActive = shadowRoot && shadowRoot.activeElement;
      if (shadowActive === lookupInput) return;

      const activeEditable = findActiveEditableTarget();
      const isNumpadEvent = /^Numpad/.test(e.code || "");
      if (!activeEditable && !isNumpadEvent) return;

      if (activeEditable) {
        isInputCurrentlyFocused = true;
      }

      const q9Key = engine.mapKeyboardEvent(e);
      if (window.__Q9_DEBUG__) {
        console.log("[Q9] keydown", e.key, e.code, "frame:", Q9_FRAME, "target:", activeEditable && activeEditable.tagName, "q9Key:", q9Key);
      }
      if (!q9Key) return;

      const res = engine.handleKey(q9Key);
      if (res && res.handled) {
        e.preventDefault();
        e.stopPropagation();
        if (res.action === "commit" && res.text) {
          insertTextDirect(res.text);
        }
        renderUI();
      }
  };
  window.addEventListener("keydown", onKeyDown, true);

  // Google Docs: attach the same handlers inside the hidden text-event iframe
  const attachedDocFrames = new WeakSet();
  function onDocsFocusIn() {
    isInputCurrentlyFocused = true;
    renderUI();
  }
  function attachDocsFrame() {
    const d = getDocsFrameDoc();
    if (!d) return;
    for (const tgt of [d, d.defaultView]) {
      if (!tgt) continue;
      tgt.addEventListener("keydown", onKeyDown, true);
      tgt.addEventListener("keyup", onKeyUp, true);
      tgt.addEventListener("focusin", onDocsFocusIn, true);
    }
    if (!attachedDocFrames.has(d)) {
      attachedDocFrames.add(d);
      dlog("docs", "attached to Docs iframe");
    }
  }
  if (/(^|\.)docs\.google\.com$/.test(location.hostname)) {
    attachDocsFrame();
    setInterval(attachDocsFrame, 500);
  }

  // Listen for runtime messages from Popup or Background script
  if (extApi && extApi.runtime && extApi.runtime.onMessage) {
    extApi.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === "Q9_TOGGLE_PANEL") {
        pinnedOpen = msg.visible !== undefined ? msg.visible : !pinnedOpen;
        if (pinnedOpen) engine.enabled = true;
        savePrefs();
        renderUI();
        sendResponse({ ok: true, visible: pinnedOpen, state: engine.getGridState() });
      } else if (msg.type === "Q9_INSERT_TEXT") {
        insertTextDirect(msg.text || "");
        sendResponse({ ok: true });
      } else if (msg.type === "Q9_SET_CONFIG") {
        if (typeof msg.enabled === "boolean") engine.enabled = msg.enabled;
        if (msg.mode) engine.setMode(msg.mode);
        if (msg.variant) engine.setVariant(msg.variant);
        if (msg.keyboardLayout) engine.setKeyboardLayout(msg.keyboardLayout);
        if (typeof msg.followCursor === "boolean") followCursor = msg.followCursor;
        if (typeof msg.pinned === "boolean") pinnedOpen = msg.pinned;
        if (typeof msg.scale === "number") windowScale = clampScale(msg.scale);
        if (typeof msg.opacity === "number") windowOpacity = clampOpacity(msg.opacity);
        if (typeof msg.autoHideIdle === "boolean") autoHideIdle = msg.autoHideIdle;
        savePrefs();
        renderUI();
        sendResponse({ ok: true, state: engine.getGridState() });
      } else if (msg.type === "Q9_GET_STATUS") {
        sendResponse({
          ok: true,
          enabled: engine.enabled,
          followCursor,
          pinned: pinnedOpen,
          scale: windowScale,
          opacity: windowOpacity,
          autoHideIdle,
          state: engine.getGridState()
        });
      }
      return true;
    });
  }

  window.__Q9_IME_INSTANCE__ = {
    engine,
    openPanel() {
      pinnedOpen = true;
      engine.enabled = true;
      renderUI();
    },
    pressKey(k) {
      return handleQ9VirtualKey(String(k));
    },
    getState() {
      return engine.getGridState();
    }
  };

  renderUI();
})();
