// Arayüzden (renderer) gelen her değer ana süreçte doğrulanır: allow-list ve sınırlar.
// Electron'a bağımlı değildir; testlerde doğrudan kullanılır.
const fs = require("node:fs");

const AGENTS = ["claude", "codex"];
const MODES = ["after_all", "immediate"];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"];
const PROFILES = ["ekonomik", "dengeli", "guclu", "ozel"];
const DECISIONS = ["accept", "rework", "rereview"];
const MODEL_RE = /^[\w.:/-]{0,80}$/;

const isAgent = (a) => AGENTS.includes(a);
/** Terminal satır/sütun: 2..500 arası tam sayı, değilse varsayılan. */
const dim = (n, def) => (Number.isInteger(n) && n >= 2 && n <= 500 ? n : def);
const isDir = (p) => { try { return typeof p === "string" && p.length < 1024 && fs.statSync(p).isDirectory(); } catch { return false; } };

function sanitizeCfg(c) {
  c = c && typeof c === "object" ? c : {};
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  const model = (v) => (typeof v === "string" && MODEL_RE.test(v.trim()) ? v.trim() : "");
  return {
    captain: pick(c.captain, AGENTS, "claude"),
    reviewMode: pick(c.reviewMode, MODES, "after_all"),
    profile: pick(c.profile, PROFILES, "dengeli"),
    brief: typeof c.brief === "string" ? c.brief.slice(0, 4000) : "",
    models: { claude: model(c.models?.claude), codex: model(c.models?.codex) },
    efforts: { claude: pick(c.efforts?.claude, EFFORTS, ""), codex: pick(c.efforts?.codex, EFFORTS, "") },
  };
}

module.exports = { AGENTS, MODES, EFFORTS, PROFILES, DECISIONS, isAgent, dim, isDir, sanitizeCfg };
