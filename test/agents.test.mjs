// CLI bulma: ortam değişkeniyle verilen yol kullanılır; olmayan yol hata verir. Ajan başlatmaz, kota harcamaz.
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
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

// Gemini (agy): MCP kaydı ve araç izni global ayara yazılır, kapanınca geri alınır.
// Sahte agy: node, --require ile çağrıyı kaydeden betiği çalıştırıp çıkar.
const calls = join(dir, "agy-calls.txt").replace(/\\/g, "/");
writeFileSync(join(dir, "fake-agy.cjs"), `require("fs").appendFileSync("${calls}", JSON.stringify(process.argv.slice(2)) + "\\n"); process.exit(process.env.FAKE_AGY_FAIL ? 1 : 0);`);
const callLog = () => readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
process.env.DUOREVIEW_GEMINI_BIN = process.execPath;
process.env.NODE_OPTIONS = `--require "${join(dir, "fake-agy.cjs").replace(/\\/g, "/")}"`;
const g = agents.buildSpec("gemini", join(dir, "data"), { model: "gemini-3.8-flash-high", effort: "low" });
assert.deepEqual(g, { file: process.execPath, args: ["--model", "gemini-3.8-flash-high", "--effort", "low"] });

const home = join(dir, "home"), settings = join(home, ".gemini", "antigravity-cli", "settings.json");
mkdirSync(join(home, ".gemini", "antigravity-cli"), { recursive: true });
writeFileSync(settings, JSON.stringify({ trustedWorkspaces: ["C:\\x"] }));
const read = () => JSON.parse(readFileSync(settings, "utf8"));
agents.registerGemini(join(dir, "data"), home);
const [add] = readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.deepEqual(add.slice(0, 1), ["add"]);
assert.ok(add.includes("AGENT_ID=gemini") && add.indexOf("duoreview") > add.lastIndexOf("--env"), "--env bayrakları addan önce");
assert.deepEqual(read(), { trustedWorkspaces: ["C:\\x"], permissions: { allow: ["mcp(duoreview/*)"] } });
agents.unregisterGemini(home);
assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n").map((l) => JSON.parse(l))[1], ["remove", "duoreview"]);
assert.deepEqual(read(), { trustedWorkspaces: ["C:\\x"] }, "boş kalan izin anahtarları da silinir");
// Kullanıcının kendi koyduğu izin kapanışta silinmez
writeFileSync(settings, JSON.stringify({ permissions: { allow: ["mcp(duoreview/*)"] } }));
agents.registerGemini(join(dir, "data"), home);
agents.unregisterGemini(home);
assert.deepEqual(read().permissions.allow, ["mcp(duoreview/*)"]);
// Kullanıcının önceden tanımladığı duoreview kaydı silinmez, kapanışta geri yazılır
const mcpConfig = join(home, ".gemini", "config", "mcp_config.json");
mkdirSync(join(home, ".gemini", "config"), { recursive: true });
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { duoreview: { command: "eski" }, diger: { command: "x" } } }));
let n = callLog().length;
agents.registerGemini(join(dir, "data"), home);
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { duoreview: { command: "yeni" }, diger: { command: "x" } } })); // agy mcp add'in güncellemesi
agents.unregisterGemini(home);
assert.deepEqual(callLog().slice(n).map((c) => c[0]), ["add"], "önceki kayıt varken remove çağrılmaz");
assert.deepEqual(JSON.parse(readFileSync(mcpConfig, "utf8")).mcpServers, { duoreview: { command: "eski" }, diger: { command: "x" } });
// Kayıt eklenemezse kapanışta remove çağrılmaz
writeFileSync(mcpConfig, JSON.stringify({ mcpServers: {} }));
process.env.FAKE_AGY_FAIL = "1";
n = callLog().length;
assert.throws(() => agents.registerGemini(join(dir, "data"), home));
agents.unregisterGemini(home);
assert.deepEqual(callLog().slice(n).map((c) => c[0]), ["add"]);
delete process.env.FAKE_AGY_FAIL;
delete process.env.NODE_OPTIONS;

// Geçersiz yol → yok sayılır, normal aramaya düşer (bulunamazsa anlaşılır hata)
process.env.DUOREVIEW_CLAUDE_BIN = join(dir, "yok");
process.env.DUOREVIEW_CODEX_BIN = join(dir, "yok");
process.env.DUOREVIEW_GEMINI_BIN = join(dir, "yok");
const oldPath = process.env.PATH, oldHome = process.env.USERPROFILE, oldHome2 = process.env.HOME, oldApp = process.env.APPDATA, oldLocal = process.env.LOCALAPPDATA;
process.env.PATH = dir; process.env.HOME = dir; process.env.USERPROFILE = dir; process.env.LOCALAPPDATA = dir; delete process.env.APPDATA;
assert.throws(() => agents.resolveClaude(), /DUOREVIEW_CLAUDE_BIN/);
assert.throws(() => agents.resolveCodex(), /DUOREVIEW_CODEX_BIN/);
assert.throws(() => agents.resolveGemini(), /DUOREVIEW_GEMINI_BIN/);
Object.assign(process.env, { PATH: oldPath }); if (oldHome) process.env.USERPROFILE = oldHome; if (oldHome2) process.env.HOME = oldHome2; if (oldApp) process.env.APPDATA = oldApp; if (oldLocal) process.env.LOCALAPPDATA = oldLocal;

rmSync(dir, { recursive: true, force: true });
console.log("AGENTS OK");
