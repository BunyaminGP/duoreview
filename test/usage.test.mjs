// Kullanım okuyucuları: sahte Codex kaydı ve sahte Claude durum dosyası ile.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const { readCodexUsage, readClaudeUsage, windowOf } = createRequire(import.meta.url)("../app/usage.js");

const home = mkdtempSync(join(tmpdir(), "usage-"));
const day = join(home, ".codex", "sessions", "2026", "10", "03");
mkdirSync(day, { recursive: true });
const now = Date.parse("2026-10-03T10:00:00Z");
const ev = (ts, used5, reset5) => JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count",
  info: { total_token_usage: { total_tokens: 1234 } },
  rate_limits: { plan_type: "plus", primary: { used_percent: used5, window_minutes: 300, resets_at: reset5 / 1000 },
                 secondary: { used_percent: 8, window_minutes: 10080, resets_at: (now + 3 * 86400e3) / 1000 } } } });
writeFileSync(join(day, "rollout-2026-10-03T08-00-00-aaa.jsonl"),
  [ev("2026-10-03T08:10:00Z", 40, now + 3600e3), "{yarım satır", ev("2026-10-03T09:30:00Z", 62, now + 1800e3), "bozuk"].join("\n"));

let u = readCodexUsage(now, home);
assert.equal(u.ok, true);
assert.equal(u.five.pct, 62, "en son olay kullanılmalı");
assert.equal(u.five.resetsAt, now + 1800e3);
assert.equal(u.week.pct, 8);
assert.equal(u.plan, "plus");

// Sıfırlanma zamanı geçmişse pencere yenilenmiştir
u = readCodexUsage(now + 2 * 3600e3, home);
assert.equal(u.five.pct, 0); assert.equal(u.five.renewed, true); assert.equal(u.five.resetsAt, null);

assert.equal(readCodexUsage(now, join(home, "yok")).ok, false);

// Claude durum dosyası: epoch saniye ve ISO biçimi
const f = join(home, "claude-status.json");
writeFileSync(f, JSON.stringify({ at: now, model: "Haiku 4.5", ctx: 7, rate_limits: {
  five_hour: { used_percentage: 12, resets_at: (now + 600e3) / 1000 },
  seven_day: { used_percentage: 17, resets_at: new Date(now + 86400e3).toISOString() } } }));
const c = readClaudeUsage(f, now);
assert.equal(c.five.pct, 12); assert.equal(c.five.resetsAt, now + 600e3);
assert.equal(c.week.resetsAt, now + 86400e3);
assert.equal(c.model, "Haiku 4.5");
assert.equal(readClaudeUsage(join(home, "yok.json"), now).ok, false);
writeFileSync(f, JSON.stringify({ at: now, rate_limits: null }));
assert.equal(readClaudeUsage(f, now).ok, false, "limit bilgisi yoksa göstergede gizlenir");
assert.equal(windowOf(null, 1, 300, now), null);

console.log("USAGE OK");
rmSync(home, { recursive: true, force: true });
