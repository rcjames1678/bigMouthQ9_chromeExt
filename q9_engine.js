// Q9 Input Method Core Engine (大口字形 & 大口筆劃 雙核心狀態機)
// Compatible with Browser Content Scripts, Popup, Node.js tests, and ChromeOS chrome.input.ime Service Worker

(function (root) {
  "use strict";

  const NUMPAD_VISUAL_ORDER = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

  // Laptop right-hand key mapping from official Q9 User Guide (guide_04.htm):
  // 7 8 9 0 -> 7 8 9 /
  // U I O P -> 4 5 6 *
  // J K L ; -> 1 2 3 -
  // M , . / -> 0 0 . +
  const LAPTOP_KEY_MAP = {
    Digit7: "7",
    Digit8: "8",
    Digit9: "9",
    Digit0: "/",
    KeyU: "4",
    KeyI: "5",
    KeyO: "6",
    KeyP: "*",
    KeyJ: "1",
    KeyK: "2",
    KeyL: "3",
    Semicolon: "-",
    KeyM: "0",
    Comma: "0",
    Period: ".",
    Slash: "+"
  };

  const LAPTOP_KEY_HINTS = {
    "7": "7",
    "8": "8",
    "9": "9",
    "4": "U",
    "5": "I",
    "6": "O",
    "1": "J",
    "2": "K",
    "3": "L",
    "0": "M/,",
    ".": ".",
    "+": "/",
    "-": ";",
    "/": "0",
    "*": "P"
  };

  class Q9Engine {
    constructor(data, options = {}) {
      this.data = data || (typeof globalThis !== "undefined" ? globalThis.Q9_DATA : null);
      if (!this.data) {
        throw new Error("Q9_DATA dictionary is not loaded.");
      }

      // Build HKSCS Set for fast O(1) lookup
      this.hkscsSet = new Set(Array.from(this.data.hkscsChars || ""));

      // Build Simplified -> Traditional reverse map for reverse lookup
      this.s2tMap = {};
      if (this.data.t2sMap) {
        for (const [trad, simp] of Object.entries(this.data.t2sMap)) {
          if (!this.s2tMap[simp]) {
            this.s2tMap[simp] = [];
          }
          this.s2tMap[simp].push(trad);
        }
      }

      // Build Reverse Code Index lazily
      this._reverseIndex = null;

      // Engine configuration
      this.mode = options.mode || "shape"; // "shape" (大口字形) | "stroke" (大口筆劃)
      this.variant = options.variant || "trad"; // "trad" (繁體) | "simp" (簡體-打繁出簡)
      this.keyboardLayout = options.keyboardLayout || "all"; // "numpad" | "toprow" | "laptop" | "all"
      this.englishMode = false; // toggled by '/' key
      this.enabled = options.enabled !== undefined ? options.enabled : true;

      // State Machine variables (matching Form1.vb)
      this.charset = "";
      this.isSelecting = false;
      this.selectMode = 0; // 0 = normal dictionary lookup, 1 = associated words, 2 = homophone lookup
      this.lastUsedWord = "";
      this.textArray = ["個", "能", "的", "到", "資", "就", "你", "這", "好"];
      this.showingTextArrayIndex = 0;
      this.zeroLabel = "標點";
      this.dotLabel = "取消";
      this.statusHint = "請按九宮格輸入字形特徵";
    }

    setMode(mode) {
      if (mode === "shape" || mode === "stroke") {
        this.mode = mode;
        this.reset(true);
      }
    }

    setVariant(variant) {
      if (variant === "trad" || variant === "simp") {
        this.variant = variant;
      }
    }

    setKeyboardLayout(layout) {
      this.keyboardLayout = layout;
    }

    toggleEnglishMode() {
      this.englishMode = !this.englishMode;
      if (this.englishMode) {
        this.reset(true);
      }
      return this.englishMode;
    }

    convertOutputChar(ch) {
      if (!ch || ch === "*") return "";
      if (this.variant === "simp" && this.data.t2sMap && this.data.t2sMap[ch]) {
        return this.data.t2sMap[ch];
      }
      return ch;
    }

    isHkscs(ch) {
      return this.hkscsSet.has(ch);
    }

    getActiveDictionary() {
      return this.mode === "stroke" ? this.data.strokeMap : this.data.shapeMap;
    }

    getActiveRadicals() {
      return this.mode === "stroke" ? this.data.strokeRadicals : this.data.shapeRadicals;
    }

    // Matches Form1.vb getWordList() with proper Unicode code-point splitting
    getWordList(code) {
      const dict = this.getActiveDictionary();
      const raw = dict[code];
      if (!raw) {
        return Array(9).fill("*");
      }
      const chars = Array.from(raw);
      if (chars.length === 0) {
        return Array(9).fill("*");
      }
      const rem = chars.length % 9;
      if (rem !== 0) {
        const pad = 9 - rem;
        for (let i = 0; i < pad; i++) {
          chars.push("*");
        }
      }
      return chars;
    }

    // Matches Form1.vb loadAssoicatedWords()
    loadAssociatedWords(target) {
      const fallback = ["個", "能", "的", "到", "資", "就", "你", "這", "好"];
      if (!target || !this.data.relatedMap) {
        return fallback.slice();
      }
      const rel = this.data.relatedMap[target];
      if (!rel) {
        return fallback.slice();
      }
      const relChars = Array.from(rel);
      if (relChars.length < 9) {
        return relChars.concat(fallback.slice(relChars.length, 9));
      }
      const rem = relChars.length % 9;
      if (rem !== 0) {
        for (let i = 0; i < 9 - rem; i++) {
          relChars.push("*");
        }
      }
      return relChars;
    }

    // Matches Form1.vb dothandler()
    reset(fullReset = false) {
      if (this.charset.length === 0 && this.lastUsedWord !== "" && !this.isSelecting && !fullReset) {
        this.enterPunctMode();
        return { action: "state", state: this.getGridState() };
      }

      this.isSelecting = false;
      this.selectMode = 0;
      this.lastUsedWord = "";
      this.charset = "";
      this.textArray = ["個", "能", "的", "到", "資", "就", "你", "這", "好"];
      this.showingTextArrayIndex = 0;
      this.zeroLabel = "標點";
      this.dotLabel = "取消";
      return { action: "reset", state: this.getGridState() };
    }

    enterPunctMode() {
      this.lastUsedWord = "";
      this.charset = "0";
      this.selectMode = 0;
      this._enterCandidateSelection();
    }

    enterHomophoneMode(keyword) {
      const clean = (keyword || "").trim();
      if (!clean) return false;
      const firstChar = Array.from(clean)[0];
      let listStr = (this.data.homographMap && this.data.homographMap[firstChar]) || "";
      if (!listStr && this.s2tMap[firstChar]) {
        for (const t of this.s2tMap[firstChar]) {
          if (this.data.homographMap[t]) {
            listStr = this.data.homographMap[t];
            break;
          }
        }
      }
      const chars = Array.from(listStr);
      if (chars.length === 0) {
        return false;
      }
      while (chars.length % 9 !== 0) {
        chars.push("*");
      }
      this.isSelecting = true;
      this.selectMode = 2;
      this.charset = "同音:" + firstChar;
      this.textArray = chars;
      this.showingTextArrayIndex = 0;
      this.zeroLabel = "下頁";
      this.dotLabel = "取消";
      return true;
    }

    _enterCandidateSelection() {
      this.isSelecting = true;
      this.selectMode = 0;
      this.textArray = this.getWordList(this.charset);
      this.showingTextArrayIndex = 0;
      this.zeroLabel = "下頁";
      this.dotLabel = "取消";
    }

    // Core key dispatcher matching Form1.vb handleKeyPress / handlePage / selectionHandler
    handleKey(q9Key) {
      if (!this.enabled) {
        return { handled: false };
      }

      if (q9Key === "/") {
        this.toggleEnglishMode();
        return {
          handled: true,
          action: "toggle_english",
          englishMode: this.englishMode,
          state: this.getGridState()
        };
      }

      if (this.englishMode) {
        return { handled: false };
      }

      // Cancel / Escape / Backspace handling
      if (q9Key === "Escape") {
        if (this.charset !== "" || this.isSelecting || this.lastUsedWord !== "") {
          this.reset(true);
          return { handled: true, action: "reset", state: this.getGridState() };
        }
        return { handled: false };
      }

      if (q9Key === "Backspace") {
        if (this.isSelecting) {
          this.reset(true);
          return { handled: true, action: "reset", state: this.getGridState() };
        }
        if (this.charset.length > 0) {
          this.charset = this.charset.slice(0, -1);
          if (this.charset.length === 0) {
            this.reset(true);
          } else if (this.charset.length === 1) {
            this.zeroLabel = "姓氏";
            this.dotLabel = "取消";
            this.textArray = ["個", "能", "的", "到", "資", "就", "你", "這", "好"];
          } else if (this.charset.length === 2) {
            this.zeroLabel = "確定";
            this.dotLabel = "取消";
            this.textArray = this.getWordList(this.charset + "0").slice(0, 9);
          }
          return { handled: true, action: "backspace", state: this.getGridState() };
        }
        // Let normal Backspace delete text in the target input!
        return { handled: false };
      }

      if (q9Key === ".") {
        // Only intercept '.' when Q9 has active state or associated words;
        // Wait: if user presses NumpadDecimal or clicks '.' button, always handle it.
        this.reset(false);
        return { handled: true, action: "dot", state: this.getGridState() };
      }

      if (q9Key === "+") {
        if (this.isSelecting) {
          this.nextPage();
          return { handled: true, action: "next_page", state: this.getGridState() };
        }
        return { handled: false };
      }

      if (q9Key === "-") {
        if (this.isSelecting) {
          this.prevPage();
          return { handled: true, action: "prev_page", state: this.getGridState() };
        }
        return { handled: false };
      }

      // Digits 0..9
      if (!/^[0-9]$/.test(q9Key)) {
        return { handled: false };
      }

      // If currently in Candidate Selection mode (isSelecting == true)
      if (this.isSelecting) {
        if (q9Key === "0") {
          this.nextPage();
          return { handled: true, action: "next_page", state: this.getGridState() };
        }

        // Special case from Form1.vb line 107: If charset = "0" And keyId = 9 Then charset = "09"
        if (this.charset === "0" && q9Key === "9") {
          this.charset = "09";
          this.textArray = this.getWordList("09");
          this.showingTextArrayIndex = 0;
          return { handled: true, action: "extended_punct", state: this.getGridState() };
        }

        const idx = this.showingTextArrayIndex + ( parseInt(q9Key, 10) - 1 );
        const rawChar = this.textArray[idx];
        if (!rawChar || rawChar === "*") {
          // Empty slot clicked/pressed: ignore without losing selection state
          return { handled: true, action: "noop", state: this.getGridState() };
        }

        const committed = this.convertOutputChar(rawChar);
        this.lastUsedWord = rawChar;
        this.isSelecting = false;
        this.selectMode = 0;
        this.charset = "";
        this.textArray = this.loadAssociatedWords(rawChar);
        this.showingTextArrayIndex = 0;
        this.zeroLabel = "選字";
        this.dotLabel = "標點";

        return {
          handled: true,
          action: "commit",
          text: committed,
          rawChar: rawChar,
          isHkscs: this.isHkscs(rawChar),
          state: this.getGridState()
        };
      }

      // Not currently in candidate selection (isSelecting == false)
      if (q9Key === "0") {
        if (this.charset === "") {
          if (this.lastUsedWord === "") {
            // Enter Punctuation Mode ("0")
            this.charset = "0";
            this._enterCandidateSelection();
            return { handled: true, action: "punct_mode", state: this.getGridState() };
          } else {
            // Enter Associated Word Selection Mode ("選字")
            this.isSelecting = true;
            this.selectMode = 1;
            this.showingTextArrayIndex = 0;
            this.zeroLabel = "下頁";
            this.dotLabel = "取消";
            return { handled: true, action: "assoc_select", state: this.getGridState() };
          }
        } else if (this.charset.length === 1) {
          // Enter Surname Mode ("10".."90")
          this.charset += "0";
          this._enterCandidateSelection();
          return { handled: true, action: "surname_select", state: this.getGridState() };
        } else if (this.charset.length === 2) {
          // Confirm Single-Component Character ("XY0" 獨體字)
          this.charset += "0";
          this._enterCandidateSelection();
          return { handled: true, action: "single_char_select", state: this.getGridState() };
        }
      }

      // Digit 1..9 when isSelecting == false
      if (this.charset.length === 0) {
        this.charset = q9Key;
        // In Q9 Stroke mode, if first key is 6(口), 1(艹), 2(𥫗), 3(宀), show strokeRadicals["0"] for 2nd stroke
        this.zeroLabel = "姓氏";
        this.dotLabel = "取消";
        this.textArray = ["個", "能", "的", "到", "資", "就", "你", "這", "好"];
        this.showingTextArrayIndex = 0;
        return { handled: true, action: "step1", state: this.getGridState() };
      }

      if (this.charset.length === 1) {
        this.charset += q9Key;
        this.zeroLabel = this.mode === "stroke" ? "選字" : "確定";
        this.dotLabel = "取消";
        // Preview single-component characters (XY0) in the background cells!
        this.textArray = this.getWordList(this.charset + "0").slice(0, 9);
        this.showingTextArrayIndex = 0;
        return { handled: true, action: "step2", state: this.getGridState() };
      }

      if (this.charset.length === 2) {
        this.charset += q9Key;
        this._enterCandidateSelection();
        return { handled: true, action: "step3_select", state: this.getGridState() };
      }

      return { handled: false };
    }

    nextPage() {
      if (!this.isSelecting) return;
      this.showingTextArrayIndex += 9;
      if (this.showingTextArrayIndex + 8 >= this.textArray.length) {
        this.showingTextArrayIndex = 0;
      }
    }

    prevPage() {
      if (!this.isSelecting) return;
      this.showingTextArrayIndex -= 9;
      if (this.showingTextArrayIndex < 0) {
        const totalPages = Math.max(1, Math.floor(this.textArray.length / 9));
        this.showingTextArrayIndex = (totalPages - 1) * 9;
      }
    }

    // Maps a DOM or ChromeOS KeyboardEvent to a Q9 key string
    mapKeyboardEvent(e) {
      if (!this.enabled) return null;
      if (e.ctrlKey || e.altKey || e.metaKey) return null;

      const code = e.code || "";
      const key = e.key || "";

      // Always map Escape and Backspace when composing
      if (key === "Escape" || code === "Escape") {
        if (this.charset !== "" || this.isSelecting) return "Escape";
        return null;
      }
      if (key === "Backspace" || code === "Backspace") {
        if (this.charset !== "" || this.isSelecting) return "Backspace";
        return null;
      }

      const allowNumpad =
        this.keyboardLayout === "numpad" ||
        this.keyboardLayout === "all" ||
        this.keyboardLayout === "numpad_toprow";
      const allowTopRow =
        this.keyboardLayout === "toprow" ||
        this.keyboardLayout === "all" ||
        this.keyboardLayout === "numpad_toprow";
      const allowLaptop = this.keyboardLayout === "laptop";

      // 1. Numpad physical codes
      if (allowNumpad) {
        if (/^Numpad[0-9]$/.test(code)) {
          return code.replace("Numpad", "");
        }
        if (code === "NumpadDecimal") return ".";
        if (code === "NumpadAdd") return "+";
        if (code === "NumpadSubtract") return "-";
        if (code === "NumpadDivide") return "/";
        if (code === "NumpadMultiply") return "*";
      }

      // 2. Laptop right-hand letter/number keys (7890 / UIOP / JKL; / M,./)
      if (allowLaptop && !e.shiftKey && LAPTOP_KEY_MAP[code]) {
        return LAPTOP_KEY_MAP[code];
      }

      // 3. Top-row number keys (Digit0..Digit9, Minus, Equal, Period)
      if (allowTopRow && !e.shiftKey) {
        if (/^Digit[0-9]$/.test(code)) {
          return code.replace("Digit", "");
        }
        if (code === "Minus" && this.isSelecting) return "-";
        if (code === "Equal" && this.isSelecting) return "+";
        if (code === "Period" && (this.charset !== "" || this.isSelecting || this.lastUsedWord !== "")) return ".";
      }

      // Fallback by e.key for environments without e.code
      if ((allowNumpad || allowTopRow) && !e.shiftKey && /^[0-9]$/.test(key)) {
        return key;
      }

      return null;
    }

    // Returns complete visual state for the 3x3 grid and UI controls
    getGridState() {
      const radicals = this.getActiveRadicals();
      let activeRadGroupKey = "0";
      if (!this.isSelecting) {
        if (this.charset.length === 1) {
          activeRadGroupKey = radicals[this.charset] ? this.charset : "0";
        } else {
          activeRadGroupKey = "0";
        }
      }
      const radGroup = radicals[activeRadGroupKey] || radicals["0"];

      const sp = this.showingTextArrayIndex;
      const totalPages = Math.max(1, Math.ceil(this.textArray.length / 9));
      const currentPage = Math.floor(sp / 9) + 1;

      // Build cells in visual 3x3 Numpad order: [7, 8, 9, 4, 5, 6, 1, 2, 3]
      const cells = NUMPAD_VISUAL_ORDER.map((numKey) => {
        const slotIndex = sp + (parseInt(numKey, 10) - 1);
        const rawCandidate = this.textArray[slotIndex] || "*";
        const displayCandidate =
          rawCandidate === "*" ? "" : this.convertOutputChar(rawCandidate);
        const radInfo = radGroup[numKey] || { main: "", sub: "", desc: "" };

        // Special display for Code '0' cell 9 ('…' -> More Symbols)
        let subHint = radInfo.sub;
        if (this.isSelecting && this.charset === "0" && numKey === "9") {
          subHint = "更多符號";
        }

        return {
          key: numKey,
          laptopKey: LAPTOP_KEY_HINTS[numKey] || "",
          mainRadical: this.isSelecting ? "" : radInfo.main,
          subRadical: this.isSelecting ? subHint : radInfo.sub,
          desc: radInfo.desc,
          candidate: displayCandidate,
          rawCandidate: rawCandidate === "*" ? "" : rawCandidate,
          isHkscs: rawCandidate !== "*" && this.isHkscs(rawCandidate),
          showCandidatePrimary: this.isSelecting,
          showPreviewChar:
            !this.isSelecting &&
            (this.charset.length === 2 || this.lastUsedWord !== "")
        };
      });

      // Build human-readable breadcrumb trail
      let breadcrumb = "";
      if (this.englishMode) {
        breadcrumb = "英文直接輸入模式 (按 / 返回中文)";
      } else if (this.isSelecting) {
        if (this.selectMode === 1) {
          breadcrumb = `「${this. convertOutputChar(this.lastUsedWord)}」的關聯字 — 請按 1-9 選字，0 下頁`;
        } else if (this.selectMode === 2) {
          breadcrumb = `${this.charset} — 請按 1-9 選同音字，0 下頁`;
        } else if (this.charset === "0" || this.charset === "09") {
          breadcrumb = `標點符號 (${this.charset}) — 請按 1-9 選取，0 下頁`;
        } else if (this.charset.length === 2 && this.charset.endsWith("0")) {
          breadcrumb = `百家姓 (${this.charset}) — 請按 1-9 選姓氏，0 下頁`;
        } else if (this.charset.length === 3 && this.charset.endsWith("0")) {
          breadcrumb = `獨體字選字 [碼: ${this.charset}] — 按 1-9 選字，0 下頁`;
        } else {
          breadcrumb = `分體字選字 [碼: ${this.charset}] — 按 1-9 選字，0 下頁`;
        }
      } else {
        if (this.charset.length === 0) {
          if (this.lastUsedWord) {
            breadcrumb = `已輸入「${this.convertOutputChar(this.lastUsedWord)}」· 按 0 選關聯字 / 按 . 標點 / 按 1-9 輸入新字`;
          } else {
            breadcrumb =
              this.mode === "stroke"
                ? "大口筆劃：請按 1-9 選取首筆或部首 (按 0 標點)"
                : "大口字形：請按 1-9 選取首筆或字首特徵 (按 0 標點)";
          }
        } else if (this.charset.length === 1) {
          const r1 = (radicals["0"][this.charset] || {}).main || this.charset;
          breadcrumb = `第 1 碼: ${this.charset} (${r1}) → 請選部件 (或按 0 入姓氏)`;
        } else if (this.charset.length === 2) {
          const k1 = this.charset[0];
          const k2 = this.charset[1];
          const r1 = (radicals["0"][k1] || {}).main || k1;
          const r2 =
            ((radicals[k1] || radicals["0"])[k2] || {}).main || k2;
          breadcrumb = `已選 ${k1}${k2} (${r1}→${r2}) → 獨體字按 0「${this.zeroLabel}」，分體字按 1-9 選右字首`;
        }
      }

      return {
        mode: this.mode,
        variant: this.variant,
        keyboardLayout: this.keyboardLayout,
        englishMode: this.englishMode,
        enabled: this.enabled,
        charset: this.charset,
        isSelecting: this.isSelecting,
        selectMode: this.selectMode,
        lastUsedWord: this.lastUsedWord,
        currentPage,
        totalPages,
        zeroLabel: this.zeroLabel,
        dotLabel: this.dotLabel,
        breadcrumb,
        cells
      };
    }

    // Reverse lookup: given any Chinese character (Trad or Simp), return all its Q9 Shape & Stroke codes
    reverseLookup(inputChar) {
      const ch = Array.from((inputChar || "").trim())[0];
      if (!ch) return [];

      if (!this._reverseIndex) {
        this._reverseIndex = { shape: {}, stroke: {} };
        for (const [code, str] of Object.entries(this.data.shapeMap || {})) {
          if (code === "0" || code === "09") continue;
          const arr = Array.from(str);
          arr.forEach((c, idx) => {
            if (c === "*") return;
            if (!this._reverseIndex.shape[c]) this._reverseIndex.shape[c] = [];
            this._reverseIndex.shape[c].push({
              code,
              page: Math.floor(idx / 9) + 1,
              selectKey: (idx % 9) + 1
            });
          });
        }
        for (const [code, str] of Object.entries(this.data.strokeMap || {})) {
          if (code === "0" || code === "09") continue;
          const arr = Array.from(str);
          arr.forEach((c, idx) => {
            if (c === "*") return;
            if (!this._reverseIndex.stroke[c]) this._reverseIndex.stroke[c] = [];
            this._reverseIndex.stroke[c].push({
              code,
              page: Math.floor(idx / 9) + 1,
              selectKey: (idx % 9) + 1
            });
          });
        }
      }

      const targets = new Set([ch]);
      if (this.s2tMap[ch]) {
        for (const t of this.s2tMap[ch]) targets.add(t);
      }

      const results = [];
      for (const targetChar of targets) {
        const shapeHits = this._reverseIndex.shape[targetChar] || [];
        const strokeHits = this._reverseIndex.stroke[targetChar] || [];
        const jyutping =
          (this.data.jyutpingMap && this.data.jyutpingMap[targetChar]) || [];

        const formattedShape = shapeHits
          .slice()
          .sort((a, b) => b.code.length - a.code.length || a.page - b.page)
          .map((h) => {
            const steps = this._describeCodeSteps(h.code, "shape");
            return { ...h, steps };
          });
        const formattedStroke = strokeHits
          .slice()
          .sort((a, b) => b.code.length - a.code.length || a.page - b.page)
          .map((h) => {
            const steps = this._describeCodeSteps(h.code, "stroke");
            return { ...h, steps };
          });

        if (formattedShape.length > 0 || formattedStroke.length > 0) {
          results.push({
            char: targetChar,
            simpChar: (this.data.t2sMap && this.data.t2sMap[targetChar]) || targetChar,
            isHkscs: this.isHkscs(targetChar),
            jyutping,
            shapeCodes: formattedShape,
            strokeCodes: formattedStroke
          });
        }
      }
      return results;
    }

    _describeCodeSteps(code, mode) {
      const rads = mode === "stroke" ? this.data.strokeRadicals : this.data.shapeRadicals;
      if (code.length === 2 && code.endsWith("0")) {
        const k1 = code[0];
        const r1 = (rads["0"][k1] || {}).main || k1;
        return [`${k1} (${r1})`, `0 (姓氏)`];
      }
      if (code.length === 3) {
        const [k1, k2, k3] = [code[0], code[1], code[2]];
        const r1 = (rads["0"][k1] || {}).main || k1;
        const r2Group = rads[k1] || rads["0"];
        const r2Info = r2Group[k2] || {};
        const r2 = r2Info.main || k2;
        if (k3 === "0") {
          return [`${k1} (${r1})`, `${k2} (${r2})`, `0 (獨體字確定)`];
        } else {
          const r3 = (rads["0"][k3] || {}).main || k3;
          return [`${k1} (${r1})`, `${k2} (${r2})`, `${k3} (右字首: ${r3})`];
        }
      }
      return [code];
    }
  }

  const exported = {
    Q9Engine,
    NUMPAD_VISUAL_ORDER,
    LAPTOP_KEY_MAP,
    LAPTOP_KEY_HINTS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = exported;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.Q9Engine = Q9Engine;
    globalThis.Q9_CONSTANTS = exported;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
