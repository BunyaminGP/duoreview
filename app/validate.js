// Arayüzden (renderer) gelen her değer ana süreçte doğrulanır: allow-list ve sınırlar.
// Electron'a bağımlı değildir; testlerde doğrudan kullanılır.
const fs = require("node:fs");

const AGENTS = ["claude", "codex", "gemini"];
const MODES = ["after_all", "immediate"];
const KICKOFFS = ["joint", "cross", "solo"];
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max", "ultra"];
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
  // Takım en az iki ajan; sıra her zaman AGENTS sırası (söz ve inceleme sırası buna bağlı)
  const team = Array.isArray(c.team) ? AGENTS.filter((a) => c.team.includes(a)) : [];
  const members = team.length >= 2 ? team : ["claude", "codex"];
  return {
    team: members,
    captain: pick(c.captain, members, members[0]),
    reviewMode: pick(c.reviewMode, MODES, "after_all"),
    kickoff: pick(c.kickoff, KICKOFFS, "joint"),
    subagents: pick(c.subagents, ["off", "research", "scoped"], "research"),
    profile: pick(c.profile, PROFILES, "dengeli"),
    brief: typeof c.brief === "string" ? c.brief : "",
    verify: typeof c.verify === "string" ? c.verify.trim().slice(0, 1000) : "",
    models: Object.fromEntries(AGENTS.map((a) => [a, model(c.models?.[a])])),
    efforts: Object.fromEntries(AGENTS.map((a) => [a, pick(c.efforts?.[a], EFFORTS, "")])),
  };
}

function sanitizeUi(ui) {
  ui = ui && typeof ui === "object" ? ui : {};
  const clamp = (v, lo, hi, def) => typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
  const cols = Object.fromEntries(AGENTS.map((a) => [a, clamp(ui.cols?.[a], 0.01, 1, 1 / 3)]));
  const sum = Object.values(cols).reduce((a, b) => a + b, 0);
  return {
    cols: Object.fromEntries(AGENTS.map((a) => [a, cols[a] / sum])),
    side: Math.round(clamp(ui.side, 260, 600, 340)),
    font: Object.fromEntries(AGENTS.map((a) => [a, Math.round(clamp(ui.font?.[a], 9, 24, 13))])),
    composer: Object.fromEntries(AGENTS.map((a) => [a, Math.round(clamp(ui.composer?.[a], 40, 2000, 52))])),
    max: isAgent(ui.max) ? ui.max : null,
    advanced: ui.advanced === true,
  };
}

module.exports = { AGENTS, MODES, KICKOFFS, EFFORTS, PROFILES, DECISIONS, isAgent, dim, isDir, sanitizeCfg, sanitizeUi };
