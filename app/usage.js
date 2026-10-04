// Kalan kullanım (5 saatlik pencere + haftalık) okuyucuları. Yalnız yerel dosyaları okur; ağa çıkmaz.
//  Codex : ~/.codex/sessions/**/rollout-*.jsonl içindeki token_count olaylarının rate_limits alanı
//  Claude: DuoReview'in başlattığı oturumun statusLine verisi (usage-writer.cjs ile yazılan dosya)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { t } = require("./i18n");

const TAIL_BYTES = 400 * 1024;

const desc = (dir) => { try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; } };

/** En yeni rollout dosyaları (yıl/ay/gün klasörlerinden, yeniden eskiye). */
function newestRollouts(limit, home = os.homedir()) {
  const root = path.join(home, ".codex", "sessions");
  const out = [];
  for (const y of desc(root)) for (const m of desc(path.join(root, y))) for (const d of desc(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d);
    for (const f of desc(dir)) {
      if (f.startsWith("rollout-") && f.endsWith(".jsonl")) out.push(path.join(dir, f));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally { fs.closeSync(fd); }
}

function readHead(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.toString("utf8", 0, n);
  } finally { fs.closeSync(fd); }
}

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Pencereyi ortak biçime çevirir; sıfırlanma zamanı geçtiyse pencere yenilenmiştir (%0). */
function windowOf(pct, resetsAt, windowMin, now) {
  if (pct == null) return null;
  const resetMs = toMs(resetsAt);
  const renewed = resetMs != null && resetMs <= now;
  return { pct: renewed ? 0 : Math.round(pct), resetsAt: renewed ? null : resetMs, windowMin: windowMin ?? null, renewed };
}

function readCodexUsage(now = Date.now(), home = os.homedir()) {
  for (const file of newestRollouts(3, home)) {
    let text;
    try { text = readTail(file, TAIL_BYTES); } catch { continue; }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes("rate_limits")) continue;
      try {
        const j = JSON.parse(lines[i]);
        const rl = j.payload?.rate_limits;
        if (j.payload?.type !== "token_count" || !rl) continue;
        return {
          ok: true, plan: rl.plan_type ?? null, asOf: Date.parse(j.timestamp) || null,
          five: windowOf(rl.primary?.used_percent, rl.primary?.resets_at, rl.primary?.window_minutes, now),
          week: windowOf(rl.secondary?.used_percent, rl.secondary?.resets_at, rl.secondary?.window_minutes, now),
          tokens: j.payload.info?.total_token_usage?.total_tokens ?? null,
        };
      } catch { /* yarım satır olabilir */ }
    }
  }
  return { ok: false, note: t("noCodexUsage") };
}

function readClaudeUsage(statusFile, now = Date.now()) {
  let s;
  try { s = JSON.parse(fs.readFileSync(statusFile, "utf8")); } catch { return { ok: false, note: t("afterFirstReply") }; }
  const rl = s.rate_limits;
  if (!rl) return { ok: false, asOf: s.at, note: t("noLimitInfo") };
  const f = rl.five_hour, w = rl.seven_day;
  return {
    ok: true, asOf: s.at, model: s.model ?? null, ctx: s.ctx ?? null, cost: s.cost ?? null,
    five: windowOf(f?.used_percentage, f?.resets_at, 300, now),
    week: windowOf(w?.used_percentage, w?.resets_at, 10080, now),
  };
}

/** Codex oturumlarında görülen modeller (model seçim önerileri için). */
function listCodexModels(home = os.homedir()) {
  const seen = new Set();
  try {
    const cfg = fs.readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    const m = cfg.match(/^\s*model\s*=\s*"([^"]+)"/m);
    if (m) seen.add(m[1]);
  } catch {}
  for (const file of newestRollouts(15, home)) {
    try {
      const head = readHead(file, 30000);
      for (const m of head.matchAll(/"model":"([^"]+)"/g)) seen.add(m[1]);
    } catch {}
  }
  return [...seen];
}

module.exports = { readCodexUsage, readClaudeUsage, listCodexModels, windowOf };
