// Q9 Input Method v2.0 Switcher Menu Logic (Google Input Tools / Chrome 速成 Plugin Style)
(function () {
  "use strict";

  const extApi = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;
  const helperEngine = new Q9Engine(Q9_DATA);

  const $ = (id) => document.getElementById(id);

  let state = {
    enabled: true,
    mode: "shape",
    variant: "trad",
    keyboardLayout: "all",
    followCursor: true,
    scale: 0.85,
    opacity: 0.96,
    autoHideIdle: false
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function render() {
    const btnToggle = $("btn-master-toggle");
    const banner = $("direct-banner");
    const bannerText = $("banner-text");

    if (state.enabled) {
      btnToggle.textContent = "已啟用 ON";
      btnToggle.classList.remove("off");
      banner.classList.remove("off");
      bannerText.textContent = "直接點擊網頁任何輸入框即可打字（免 Copy & Paste！單按 Shift 切換中/英）";
    } else {
      btnToggle.textContent = "已暫停 OFF";
      btnToggle.classList.add("off");
      banner.classList.add("off");
      bannerText.textContent = "大口輸入法目前暫停中，點擊右上角按鈕或按 Alt+Q 即可恢復直接打字。";
    }

    $("item-shape").classList.toggle("active", state.mode === "shape");
    $("item-stroke").classList.toggle("active", state.mode === "stroke");
    $("select-layout").value = state.keyboardLayout;
    $("btn-var-trad").classList.toggle("active", state.variant === "trad");
    $("btn-var-simp").classList.toggle("active", state.variant === "simp");
    $("btn-win-follow").classList.toggle("active", state.followCursor);
    $("btn-win-dock").classList.toggle("active", !state.followCursor);

    const pct = Math.round((state.scale || 0.85) * 100);
    if ($("scale-val-badge")) $("scale-val-badge").textContent = `${pct}%`;
    if ($("slider-scale")) $("slider-scale").value = String(pct);

    for (const btn of document.querySelectorAll(".preset-btn")) {
      const btnPct = Math.round(Number(btn.getAttribute("data-scale")) * 100);
      btn.classList.toggle("active", Math.abs(btnPct - pct) <= 3);
    }

    if ($("btn-opacity-toggle")) {
      const isTranslucent = state.opacity < 0.9;
      $("btn-opacity-toggle").classList.toggle("active", isTranslucent);
      $("btn-opacity-toggle").textContent = isTranslucent ? `半透明 (${Math.round(state.opacity * 100)}%)` : "半透明";
    }
    if ($("btn-autohide-toggle")) {
      $("btn-autohide-toggle").classList.toggle("active", Boolean(state.autoHideIdle));
    }
  }

  function syncAndBroadcast() {
    render();
    if (extApi && extApi.storage && extApi.storage.local) {
      try {
        extApi.storage.local.set({
          q9_enabled: state.enabled,
          q9_mode: state.mode,
          q9_variant: state.variant,
          q9_layout: state.keyboardLayout,
          q9_follow_cursor: state.followCursor,
          q9_pinned: !state.followCursor,
          q9_scale: state.scale,
          q9_opacity: state.opacity,
          q9_auto_hide: state.autoHideIdle
        });
      } catch (_) {}
    }

    if (extApi && extApi.runtime && extApi.runtime.sendMessage) {
      try {
        extApi.runtime.sendMessage({
          type: "Q9_BROADCAST_CONFIG",
          enabled: state.enabled,
          mode: state.mode,
          variant: state.variant,
          keyboardLayout: state.keyboardLayout,
          followCursor: state.followCursor,
          scale: state.scale,
          opacity: state.opacity,
          autoHideIdle: state.autoHideIdle
        });
      } catch (_) {}
    }

    if (extApi && extApi.tabs && extApi.tabs.query) {
      try {
        extApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs[0] && tabs[0].id) {
            extApi.tabs.sendMessage(
              tabs[0].id,
              {
                type: "Q9_SET_CONFIG",
                enabled: state.enabled,
                mode: state.mode,
                variant: state.variant,
                keyboardLayout: state.keyboardLayout,
                followCursor: state.followCursor,
                pinned: !state.followCursor,
                scale: state.scale,
                opacity: state.opacity,
                autoHideIdle: state.autoHideIdle
              },
              () => {
                void (extApi.runtime && extApi.runtime.lastError);
              }
            );
          }
        });
      } catch (_) {}
    }
  }

  // Load saved state
  if (extApi && extApi.storage && extApi.storage.local) {
    try {
      extApi.storage.local.get(
        [
          "q9_enabled",
          "q9_mode",
          "q9_variant",
          "q9_layout",
          "q9_follow_cursor",
          "q9_scale",
          "q9_opacity",
          "q9_auto_hide"
        ],
        (res) => {
          if (res) {
            if (typeof res.q9_enabled === "boolean") state.enabled = res.q9_enabled;
            if (res.q9_mode) state.mode = res.q9_mode;
            if (res.q9_variant) state.variant = res.q9_variant;
            if (res.q9_layout) state.keyboardLayout = res.q9_layout;
            if (typeof res.q9_follow_cursor === "boolean") state.followCursor = res.q9_follow_cursor;
            if (typeof res.q9_scale === "number") state.scale = res.q9_scale;
            if (typeof res.q9_opacity === "number") state.opacity = res.q9_opacity;
            if (typeof res.q9_auto_hide === "boolean") state.autoHideIdle = res.q9_auto_hide;
          }
          syncAndBroadcast();
        }
      );
    } catch (_) {}
  }

  $("btn-master-toggle").addEventListener("click", () => {
    state.enabled = !state.enabled;
    syncAndBroadcast();
  });

  $("item-shape").addEventListener("click", () => {
    state.mode = "shape";
    state.enabled = true;
    syncAndBroadcast();
  });

  $("item-stroke").addEventListener("click", () => {
    state.mode = "stroke";
    state.enabled = true;
    syncAndBroadcast();
  });

  $("select-layout").addEventListener("change", (e) => {
    state.keyboardLayout = e.target.value;
    state.enabled = true;
    syncAndBroadcast();
  });

  $("btn-var-trad").addEventListener("click", () => {
    state.variant = "trad";
    syncAndBroadcast();
  });

  $("btn-var-simp").addEventListener("click", () => {
    state.variant = "simp";
    syncAndBroadcast();
  });

  $("btn-win-follow").addEventListener("click", () => {
    state.followCursor = true;
    syncAndBroadcast();
  });

  $("btn-win-dock").addEventListener("click", () => {
    state.followCursor = false;
    syncAndBroadcast();
  });

  if ($("slider-scale")) {
    $("slider-scale").addEventListener("input", (e) => {
      state.scale = Number(e.target.value) / 100;
      syncAndBroadcast();
    });
  }

  for (const btn of document.querySelectorAll(".preset-btn")) {
    btn.addEventListener("click", () => {
      state.scale = Number(btn.getAttribute("data-scale"));
      syncAndBroadcast();
    });
  }

  if ($("btn-opacity-toggle")) {
    $("btn-opacity-toggle").addEventListener("click", () => {
      state.opacity = state.opacity < 0.9 ? 0.96 : 0.72;
      syncAndBroadcast();
    });
  }

  if ($("btn-autohide-toggle")) {
    $("btn-autohide-toggle").addEventListener("click", () => {
      state.autoHideIdle = !state.autoHideIdle;
      syncAndBroadcast();
    });
  }

  function doLookup() {
    const q = ($("lookup-input").value || "").trim();
    if (!q) return;
    const out = [];
    for (const ch of Array.from(q).slice(0, 5)) {
      const res = helperEngine.reverseLookup(ch);
      if (!res.length) {
        out.push(`<div>【${escapeHtml(ch)}】找不到大口編碼</div>`);
        continue;
      }
      for (const item of res) {
        const shape =
          item.shapeCodes
            .map(
              (c) =>
                `<b>${c.code}</b>（${c.steps.map(escapeHtml).join(" → ")}，第${c.page}頁按 <b>${c.selectKey}</b>）`
            )
            .join("；") || "無";
        const stroke =
          item.strokeCodes
            .slice(0, 3)
            .map((c) => `<b>${c.code}</b>（第${c.page}頁按 <b>${c.selectKey}</b>）`)
            .join("；") || "無";
        const jp = item.jyutping.length ? ` 粵拼: ${escapeHtml(item.jyutping.join("/"))}` : "";
        const hk = item.isHkscs ? ` <span style="color:#dc2626;font-weight:800">[HKSCS]</span>` : "";
        out.push(`<div>【<b>${escapeHtml(item.char)}</b>】${hk}${jp}<br/>▸ 字形碼：${shape}<br/>▸ 筆劃碼：${stroke}</div>`);
      }
    }
    $("lookup-output").innerHTML = out.join(
      "<hr style='border:none;border-top:1px solid #e2e8f0;margin:4px 0'/>"
    );
  }

  $("btn-lookup").addEventListener("click", doLookup);
  $("lookup-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLookup();
  });

  $("btn-open-demo").addEventListener("click", () => {
    const url = extApi && extApi.runtime ? extApi.runtime.getURL("demo.html") : "demo.html";
    if (extApi && extApi.tabs) extApi.tabs.create({ url });
    else window.open(url, "_blank");
  });

  render();
})();
