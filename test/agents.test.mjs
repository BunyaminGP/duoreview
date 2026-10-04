// CLI bulma: ortam değişkeniyle verilen yol kullanılır; olmayan yol hata verir. Ajan başlatmaz, kota harcamaz.
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const req = createRequire(import.meta.url);
const agents = req("../app/agents.js");

const dir = mkdtempSync(join(tmpdir(), "agents-"));
const fakeClaude = join(dir, "my-claude"), fakeCodex = join(dir, "my-codex");
writeFileSync(fakeClaude, "x"); writeFileSync(fakeCodex, "x");

process.env.DUOREVIEW_CLAUDE_BIN = fakeClaude;
process.env.DUOREVIEW_CODEX_BIN = fakeCodex;
assert.equal(agents.resolveClaude(), fakeClaude);
assert.deepEqual(agents.resolveCodex(), { file: fakeCodex, args: [] });

const c = agents.buildSpec("claude", join(dir, "data"), { model: "sonnet", effort: "low" });
assert.equal(c.file, fakeClaude);
assert.ok(c.args.includes("--mcp-config") && c.args.includes("mcp__duoreview") && c.args.includes("sonnet"));
const x = agents.buildSpec("codex", join(dir, "data"), { model: "gpt-x", effort: "high" });
assert.equal(x.file, fakeCodex);
assert.ok(x.args.some((a) => a.startsWith("mcp_servers.duoreview.command=")) && x.args.includes("gpt-x"));

// Geçersiz yol → yok sayılır, normal aramaya düşer (bulunamazsa anlaşılır hata)
process.env.DUOREVIEW_CLAUDE_BIN = join(dir, "yok");
process.env.DUOREVIEW_CODEX_BIN = join(dir, "yok");
const oldPath = process.env.PATH, oldHome = process.env.USERPROFILE, oldHome2 = process.env.HOME, oldApp = process.env.APPDATA;
process.env.PATH = dir; process.env.HOME = dir; process.env.USERPROFILE = dir; delete process.env.APPDATA;
assert.throws(() => agents.resolveClaude(), /DUOREVIEW_CLAUDE_BIN/);
assert.throws(() => agents.resolveCodex(), /DUOREVIEW_CODEX_BIN/);
Object.assign(process.env, { PATH: oldPath }); if (oldHome) process.env.USERPROFILE = oldHome; if (oldHome2) process.env.HOME = oldHome2; if (oldApp) process.env.APPDATA = oldApp;

rmSync(dir, { recursive: true, force: true });
console.log("AGENTS OK");
