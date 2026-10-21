/**
 * Q9 Android IME & Browser Extension — English Gesture (Swipe) & Predictive Text Engine v3.9
 * Supports continuous QWERTY swipe path decoding (2D Polyline DTW + Subsequence + Endpoint Anchors),
 * real-time path interpolation, prefix completion, and typo autocorrect.
 */
(function (root) {
  "use strict";

  const LEXICON = [
    "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
    "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
    "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
    "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
    "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
    "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
    "people", "into", "year", "your", "good", "some", "could", "them", "see", "other",
    "than", "then", "now", "look", "only", "come", "its", "over", "think", "also",
    "back", "after", "use", "two", "how", "our", "work", "first", "well", "way",
    "even", "new", "want", "because", "any", "these", "give", "day", "most", "us",
    "hello", "world", "hi", "ok", "okay", "yes", "please", "thank", "thanks", "sorry",
    "hong", "kong", "kowloon", "macau", "taiwan", "china", "cantonese", "english", "chinese", "input",
    "method", "keyboard", "swipe", "swiping", "typing", "type", "emoji", "emojis", "delete", "backspace",
    "voice", "number", "numbers", "symbol", "symbols", "space", "enter", "shift", "custom", "numpad",
    "window", "height", "width", "size", "small", "large", "mini", "compact", "auto", "floating",
    "phone", "mobile", "tablet", "android", "chrome", "firefox", "system", "app", "message", "whatsapp",
    "email", "call", "chat", "text", "send", "reply", "read", "write", "edit", "copy",
    "paste", "cut", "save", "open", "close", "start", "stop", "play", "pause", "next",
    "previous", "page", "more", "less", "all", "none", "best", "better", "great", "awesome",
    "nice", "cool", "happy", "love", "friend", "friends", "family", "home", "office", "school",
    "work", "working", "meeting", "today", "tomorrow", "yesterday", "morning", "afternoon", "evening", "night",
    "tonight", "week", "weekend", "month", "year", "hour", "minute", "second", "moment", "later",
    "soon", "early", "late", "always", "never", "sometimes", "often", "already", "still", "yet",
    "again", "together", "alone", "around", "away", "here", "where", "why", "when", "how",
    "much", "many", "very", "really", "too", "quite", "almost", "enough", "little", "big",
    "long", "short", "high", "low", "old", "young", "right", "left", "top", "bottom",
    "center", "middle", "front", "behind", "under", "above", "between", "through", "across", "against",
    "without", "within", "during", "before", "until", "since", "while", "though", "although", "however",
    "therefore", "instead", "besides", "moreover", "finally", "actually", "especially", "probably", "maybe", "perhaps",
    "sure", "certainly", "definitely", "absolutely", "exactly", "completely", "totally", "quickly", "slowly", "easily",
    "simply", "clearly", "directly", "immediately", "recently", "currently", "usually", "normally", "seriously", "honestly",
    "help", "helping", "need", "needed", "try", "trying", "find", "found", "tell", "told",
    "ask", "asked", "show", "shown", "feel", "felt", "leave", "left", "put", "keep",
    "kept", "let", "begin", "began", "seem", "talk", "turn", "bring", "brought", "hold",
    "held", "hear", "heard", "play", "run", "move", "live", "believe", "happen", "provide",
    "sit", "stand", "lose", "pay", "meet", "include", "continue", "set", "learn", "change",
    "lead", "understand", "watch", "follow", "create", "speak", "spend", "grow", "win", "offer",
    "remember", "consider", "appear", "buy", "wait", "serve", "die", "expect", "build", "stay",
    "fall", "reach", "kill", "remain", "suggest", "raise", "pass", "sell", "require", "report",
    "decide", "pull", "push", "return", "explain", "hope", "develop", "carry", "break", "receive",
    "agree", "support", "hit", "produce", "eat", "dinner", "lunch", "breakfast", "coffee", "tea",
    "water", "food", "drink", "restaurant", "hotel", "airport", "station", "train", "bus", "taxi",
    "car", "flight", "ticket", "travel", "trip", "holiday", "vacation", "shopping", "market", "store",
    "shop", "money", "price", "cost", "free", "cheap", "expensive", "pay", "payment", "card",
    "bank", "account", "order", "buy", "sell", "business", "company", "team", "project", "plan",
    "problem", "question", "answer", "idea", "information", "data", "result", "reason", "example", "fact",
    "issue", "point", "part", "place", "case", "group", "number", "system", "program", "service",
    "government", "area", "course", "eye", "hand", "head", "face", "body", "heart", "mind",
    "life", "child", "children", "woman", "women", "man", "men", "person", "guy", "girl",
    "boy", "mother", "father", "mom", "dad", "parent", "parents", "brother", "sister", "son",
    "daughter", "wife", "husband", "baby", "dog", "cat", "animal", "tree", "flower", "sun",
    "moon", "star", "sky", "rain", "weather", "hot", "cold", "warm", "wind", "snow",
    "color", "red", "blue", "green", "yellow", "black", "white", "gold", "silver", "light",
    "dark", "sound", "music", "song", "movie", "game", "book", "story", "news", "paper",
    "picture", "photo", "video", "image", "camera", "computer", "laptop", "screen", "button", "click",
    "press", "hold", "drag", "drop", "scroll", "zoom", "search", "website", "internet", "online",
    "network", "password", "user", "login", "account", "file", "folder", "document", "code", "software",
    "version", "update", "install", "download", "upload", "connect", "connected", "bluetooth", "wireless", "battery",
    "power", "charge", "fast", "slow", "strong", "weak", "clean", "clear", "full", "empty",
    "open", "closed", "ready", "busy", "free", "safe", "careful", "important", "special", "different",
    "same", "similar", "possible", "impossible", "available", "necessary", "useful", "helpful", "easy", "hard",
    "difficult", "simple", "complex", "true", "false", "real", "wrong", "correct", "perfect", "beautiful",
    "pretty", "cute", "funny", "sweet", "kind", "smart", "clever", "lucky", "proud", "excited",
    "tired", "hungry", "thirsty", "sick", "healthy", "fine", "welcome", "congratulations", "birthday", "christmas"
  ];

  // Deduplicate lexicon while preserving frequency rank order
  const UNIQUE_LEXICON = [];
  const seenWords = new Set();
  for (let i = 0; i < LEXICON.length; i++) {
    const w = LEXICON[i].toLowerCase().trim();
    if (w && !seenWords.has(w)) {
      seenWords.add(w);
      UNIQUE_LEXICON.push(w);
    }
  }

  // Normalized QWERTY key centers on a 10x3 grid (x in [0..10], y in [0..2])
  const KEY_COORDS = {
    q: [0.5, 0.0], w: [1.5, 0.0], e: [2.5, 0.0], r: [3.5, 0.0], t: [4.5, 0.0],
    y: [5.5, 0.0], u: [6.5, 0.0], i: [7.5, 0.0], o: [8.5, 0.0], p: [9.5, 0.0],
    a: [0.8, 1.0], s: [1.8, 1.0], d: [2.8, 1.0], f: [3.8, 1.0], g: [4.8, 1.0],
    h: [5.8, 1.0], j: [6.8, 1.0], k: [7.8, 1.0], l: [8.8, 1.0],
    z: [1.5, 2.0], x: [2.5, 2.0], c: [3.5, 2.0], v: [4.5, 2.0], b: [5.5, 2.0],
    n: [6.5, 2.0], m: [7.5, 2.0]
  };

  function collapseRepeats(str) {
    let out = "";
    for (let i = 0; i < str.length; i++) {
      if (i === 0 || str[i] !== str[i - 1]) out += str[i];
    }
    return out;
  }

  // Precompute word templates (N=16 equidistant points along each word's ideal key polyline)
  const N_SAMPLES = 16;
  function samplePolyline(pts, n) {
    if (pts.length === 0) return [];
    if (pts.length === 1) {
      const res = [];
      for (let i = 0; i < n; i++) res.push([pts[0][0], pts[0][1]]);
      return res;
    }
    const segLens = [];
    let totalLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - pts[i - 1][0];
      const dy = pts[i][1] - pts[i - 1][1];
      const d = Math.hypot(dx, dy);
      segLens.push(d);
      totalLen += d;
    }
    if (totalLen < 1e-5) {
      const res = [];
      for (let i = 0; i < n; i++) res.push([pts[0][0], pts[0][1]]);
      return res;
    }
    const out = [[pts[0][0], pts[0][1]]];
    let segIdx = 0;
    let accLen = 0;
    for (let k = 1; k < n - 1; k++) {
      const target = (k / (n - 1)) * totalLen;
      while (segIdx < segLens.length - 1 && accLen + segLens[segIdx] < target) {
        accLen += segLens[segIdx];
        segIdx++;
      }
      const segLen = segLens[segIdx];
      const t = segLen > 1e-6 ? (target - accLen) / segLen : 0;
      const p0 = pts[segIdx];
      const p1 = pts[segIdx + 1];
      out.push([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]);
    }
    const last = pts[pts.length - 1];
    out.push([last[0], last[1]]);
    return out;
  }

  const WORD_TEMPLATES = UNIQUE_LEXICON.map((word, rank) => {
    const collapsed = collapseRepeats(word);
    const pts = [];
    for (let i = 0; i < collapsed.length; i++) {
      const c = KEY_COORDS[collapsed[i]];
      if (c) pts.push(c);
    }
    return {
      word,
      collapsed,
      rank,
      first: word[0],
      last: word[word.length - 1],
      template: samplePolyline(pts, N_SAMPLES)
    };
  });

  function keyDistance(a, b) {
    const ca = KEY_COORDS[a];
    const cb = KEY_COORDS[b];
    if (!ca || !cb) return 99;
    return Math.hypot(ca[0] - cb[0], ca[1] - cb[1]);
  }

  /**
   * Decode a swipe gesture from `keySequence` (array of touched key characters in order)
   */
  function decodeSwipe(keySequence, limit = 6) {
    const seq = collapseRepeats(
      (Array.isArray(keySequence) ? keySequence.join("") : String(keySequence || ""))
        .toLowerCase()
        .replace(/[^a-z]/g, "")
    );
    if (!seq) return [];
    if (seq.length === 1) {
      return predictPrefix(seq, limit);
    }

    const startChar = seq[0];
    const endChar = seq[seq.length - 1];
    const inputPts = [];
    for (let i = 0; i < seq.length; i++) {
      const c = KEY_COORDS[seq[i]];
      if (c) inputPts.push(c);
    }
    const sampledInput = samplePolyline(inputPts, N_SAMPLES);

    const scored = [];
    for (let i = 0; i < WORD_TEMPLATES.length; i++) {
      const entry = WORD_TEMPLATES[i];
      if (entry.word.length < 2) continue;

      const dStart = keyDistance(startChar, entry.first);
      const dEnd = keyDistance(endChar, entry.last);
      // Allow exact or immediate neighbor keys at start and end of swipe
      if (dStart > 1.55 || dEnd > 1.55) continue;

      // Trajectory distance across N_SAMPLES points
      let pathDist = 0;
      const tpl = entry.template;
      for (let k = 0; k < N_SAMPLES; k++) {
        const dx = sampledInput[k][0] - tpl[k][0];
        const dy = sampledInput[k][1] - tpl[k][1];
        pathDist += Math.hypot(dx, dy);
      }
      pathDist /= N_SAMPLES;

      // Subsequence bonus: check how many characters of entry.collapsed appear in order in seq
      let sIdx = 0;
      let matchedChars = 0;
      for (let cIdx = 0; cIdx < entry.collapsed.length; cIdx++) {
        const targetChar = entry.collapsed[cIdx];
        while (sIdx < seq.length && seq[sIdx] !== targetChar) sIdx++;
        if (sIdx < seq.length) {
          matchedChars++;
          sIdx++;
        }
      }
      const subseqRatio = matchedChars / entry.collapsed.length;

      // Exact collapsed match bonus (e.g. swiping 'g' -> 'o' for 'go' or 'h' -> 'i' for 'hi')
      const exactCollapsedBonus = entry.collapsed === seq ? 0.55 : 0;

      // Frequency prior (lower rank = more common)
      const freqPenalty = (entry.rank / UNIQUE_LEXICON.length) * 0.42;
      const endpointPenalty = dStart * 0.9 + dEnd * 0.9;
      const subseqBonus = subseqRatio * 0.68;

      const totalScore = pathDist + endpointPenalty + freqPenalty - subseqBonus - exactCollapsedBonus;
      scored.push({ word: entry.word, score: totalScore });
    }

    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map((s) => s.word);
  }

  /**
   * Prefix + Typo-tolerant prediction for normal tap typing in English mode
   */
  function predictPrefix(prefix, limit = 6) {
    const p = String(prefix || "").toLowerCase().replace(/[^a-z]/g, "");
    if (!p) return ["the", "I", "to", "and", "you", "is"].slice(0, limit);

    const exactAndPrefix = [];
    const fuzzy = [];
    for (let i = 0; i < UNIQUE_LEXICON.length; i++) {
      const w = UNIQUE_LEXICON[i];
      if (w === p) {
        exactAndPrefix.unshift(w);
      } else if (w.startsWith(p)) {
        exactAndPrefix.push(w);
      } else if (p.length >= 2 && w.length >= p.length && w[0] === p[0]) {
        let diff = 0;
        for (let k = 0; k < p.length; k++) {
          if (w[k] !== p[k]) {
            if (keyDistance(w[k], p[k]) <= 1.35) diff += 0.6;
            else diff += 1.5;
          }
          if (diff > 1.6) break;
        }
        if (diff <= 1.5) fuzzy.push(w);
      }
      if (exactAndPrefix.length >= limit + 4) break;
    }

    const out = [];
    const seen = new Set();
    for (const w of [p, ...exactAndPrefix, ...fuzzy]) {
      if (w && !seen.has(w)) {
        seen.add(w);
        out.push(w === "i" ? "I" : w);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  root.Q9SwipeEngine = {
    LEXICON: UNIQUE_LEXICON,
    KEY_COORDS,
    decodeSwipe,
    predictPrefix
  };
})(typeof window !== "undefined" ? window : globalThis);
