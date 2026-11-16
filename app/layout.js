// Bölme genişlik oranları, piksel dönüşümleri, sınır kırpma ve PTY resize değişim filtresi.
// Hem Electron renderer (<script>) hem de Node.js birim testleri (test/layout.test.mjs) tarafından kullanılır.
(function (root) {
  const AGENTS = ["claude", "codex", "gemini"];
  const MIN_PANE_PX = 240;
  const MIN_SIDE_PX = 260;
  const MAX_SIDE_PX = 600;
  const DEFAULT_SIDE_PX = 340;
  const MIN_FONT = 9;
  const MAX_FONT = 24;
  const DEFAULT_FONT = 13;
  const MIN_COMPOSER_PX = 40;
  const DEFAULT_COMPOSER_PX = 52;

  function clampSide(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return DEFAULT_SIDE_PX;
    return Math.min(MAX_SIDE_PX, Math.max(MIN_SIDE_PX, Math.round(n)));
  }

  function clampFont(size) {
    const n = Number(size);
    if (!Number.isFinite(n)) return DEFAULT_FONT;
    return Math.min(MAX_FONT, Math.max(MIN_FONT, Math.round(n)));
  }

  function clampComposer(px, paneHeight = 0) {
    const n = Number(px);
    if (!Number.isFinite(n)) return DEFAULT_COMPOSER_PX;
    const h = Number(paneHeight);
    const maxPx = Number.isFinite(h) && h > 0 ? Math.max(MIN_COMPOSER_PX, Math.floor(h * 0.5)) : 400;
    return Math.min(maxPx, Math.max(MIN_COMPOSER_PX, Math.round(n)));
  }

  function normalizeRatios(cols = {}, members = AGENTS) {
    const active = Array.isArray(members) && members.length ? members.filter((a) => AGENTS.includes(a)) : AGENTS;
    const src = cols && typeof cols === "object" ? cols : {};
    const out = {};
    for (const a of AGENTS) {
      const v = Number(src[a]);
      out[a] = Number.isFinite(v) && v > 0 ? v : 1 / AGENTS.length;
    }
    if (!active.length) return out;
    let sum = 0;
    for (const a of active) sum += out[a];
    if (!(sum > 0)) {
      const eq = 1 / active.length;
      for (const a of active) out[a] = eq;
      return out;
    }
    let acc = 0;
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      if (i === active.length - 1) {
        out[a] = Math.max(0, 1 - acc);
      } else {
        out[a] = out[a] / sum;
        acc += out[a];
      }
    }
    return out;
  }

  function equalRatios(members = AGENTS, prevCols = {}) {
    const active = Array.isArray(members) && members.length ? members.filter((a) => AGENTS.includes(a)) : AGENTS;
    const raw = { ...(prevCols && typeof prevCols === "object" ? prevCols : {}) };
    for (const a of active) raw[a] = 1;
    return normalizeRatios(raw, active);
  }

  function ratiosToPx(cols, members = AGENTS, totalPx = 900, minPx = MIN_PANE_PX) {
    const active = Array.isArray(members) && members.length ? members.filter((a) => AGENTS.includes(a)) : AGENTS;
    const norm = normalizeRatios(cols, active);
    const total = Math.max(0, Number(totalPx) || 0);
    const effMin = active.length > 0 ? Math.min(Math.max(0, Number(minPx) || MIN_PANE_PX), total / active.length) : 0;

    const locked = new Set();
    const px = {};
    while (true) {
      let lockedSum = 0;
      let freeWeight = 0;
      for (const a of active) {
        if (locked.has(a)) lockedSum += px[a];
        else freeWeight += norm[a];
      }
      const rem = Math.max(0, total - lockedSum);
      let changed = false;
      for (const a of active) {
        if (locked.has(a)) continue;
        const w = freeWeight > 0 ? (norm[a] / freeWeight) * rem : rem / Math.max(1, active.length - locked.size);
        if (w < effMin - 1e-7) {
          px[a] = effMin;
          locked.add(a);
          changed = true;
        } else {
          px[a] = w;
        }
      }
      if (!changed) break;
    }
    return px;
  }

  function pxToRatios(pxMap = {}, members = AGENTS, minPx = MIN_PANE_PX, prevCols = {}) {
    const active = Array.isArray(members) && members.length ? members.filter((a) => AGENTS.includes(a)) : AGENTS;
    const raw = {};
    let total = 0;
    for (const a of active) {
      const v = Number(pxMap?.[a]);
      raw[a] = Number.isFinite(v) && v > 0 ? v : MIN_PANE_PX;
      total += raw[a];
    }
    const clampedPx = ratiosToPx(raw, active, total, minPx);
    return normalizeRatios({ ...(prevCols && typeof prevCols === "object" ? prevCols : {}), ...clampedPx }, active);
  }

  function resizePair(cols, members, leftAgent, rightAgent, deltaPx, totalPx, minPx = MIN_PANE_PX) {
    const active = Array.isArray(members) && members.length ? members.filter((a) => AGENTS.includes(a)) : AGENTS;
    if (!active.includes(leftAgent) || !active.includes(rightAgent) || leftAgent === rightAgent) {
      return normalizeRatios(cols, active);
    }
    const px = ratiosToPx(cols, active, totalPx, minPx);
    const pairPx = px[leftAgent] + px[rightAgent];
    const effMin = Math.min(Math.max(0, Number(minPx) || MIN_PANE_PX), pairPx / 2);
    const delta = Number(deltaPx) || 0;
    const nextLeft = Math.min(pairPx - effMin, Math.max(effMin, px[leftAgent] + delta));
    px[leftAgent] = nextLeft;
    px[rightAgent] = pairPx - nextLeft;
    return pxToRatios(px, active, minPx, cols);
  }

  function normalizeUi(ui = {}) {
    const src = ui && typeof ui === "object" ? ui : {};
    const cols = normalizeRatios(src.cols, AGENTS);
    const side = clampSide(src.side);
    const font = {};
    const composer = {};
    for (const a of AGENTS) {
      font[a] = clampFont(src.font?.[a]);
      composer[a] = clampComposer(src.composer?.[a]);
    }
    const max = AGENTS.includes(src.max) ? src.max : null;
    const advanced = Boolean(src.advanced);
    return { cols, side, font, composer, max, advanced };
  }

  function createResizeFilter(sendFn) {
    const last = {};
    return {
      send(agent, cols, rows) {
        if (!AGENTS.includes(agent)) return false;
        if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) return false;
        const prev = last[agent];
        if (prev && prev.cols === cols && prev.rows === rows) return false;
        last[agent] = { cols, rows };
        if (typeof sendFn === "function") sendFn(agent, cols, rows);
        return true;
      },
      reset(agent) {
        if (agent) delete last[agent];
        else for (const k of Object.keys(last)) delete last[k];
      },
      getLast: (agent) => last[agent] || null,
    };
  }

  const api = {
    AGENTS,
    MIN_PANE_PX,
    MIN_SIDE_PX,
    MAX_SIDE_PX,
    DEFAULT_SIDE_PX,
    MIN_FONT,
    MAX_FONT,
    DEFAULT_FONT,
    MIN_COMPOSER_PX,
    DEFAULT_COMPOSER_PX,
    clampSide,
    clampFont,
    clampComposer,
    normalizeRatios,
    equalRatios,
    ratiosToPx,
    pxToRatios,
    resizePair,
    normalizeUi,
    createResizeFilter,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.LayoutLib = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
