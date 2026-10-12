// Arayüzden gelen değerlerin doğrulanması (allow-list ve sınırlar).
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const V = createRequire(import.meta.url)("../app/validate.js");

assert.ok(V.isAgent("claude") && V.isAgent("codex"));
for (const bad of ["", "Claude", "../x", null, undefined, 1, {}]) assert.equal(V.isAgent(bad), false, String(bad));

assert.equal(V.dim(80, 100), 80);
for (const bad of [0, 1, -5, 501, 1.5, NaN, "80", null, undefined]) assert.equal(V.dim(bad, 100), 100, String(bad));

const dir = mkdtempSync(join(tmpdir(), "val-"));
writeFileSync(join(dir, "f.txt"), "x");
assert.equal(V.isDir(dir), true);
assert.equal(V.isDir(join(dir, "f.txt")), false, "dosya klasör değildir");
assert.equal(V.isDir(join(dir, "yok")), false);
for (const bad of [null, undefined, 5, {}, "x".repeat(2000)]) assert.equal(V.isDir(bad), false);
rmSync(dir, { recursive: true, force: true });

const ok = V.sanitizeCfg({ captain: "codex", reviewMode: "immediate", kickoff: "solo", profile: "guclu", brief: "iş", models: { claude: "opus", codex: " gpt-5-codex " }, efforts: { claude: "high", codex: "low" } });
assert.deepEqual(ok, { captain: "codex", reviewMode: "immediate", kickoff: "solo", profile: "guclu", brief: "iş", models: { claude: "opus", codex: "gpt-5-codex" }, efforts: { claude: "high", codex: "low" } });

const evil = V.sanitizeCfg({ captain: "root", reviewMode: "x", profile: "?", brief: "a".repeat(9000), models: { claude: "x; rm -rf /", codex: "$(calc)" }, efforts: { claude: "turbo", codex: 5 } });
assert.equal(evil.captain, "claude"); assert.equal(evil.reviewMode, "after_all"); assert.equal(evil.profile, "dengeli"); assert.equal(evil.kickoff, "joint");
assert.equal(evil.brief.length, 4000);
assert.deepEqual(evil.models, { claude: "", codex: "" }, "model adında kabuk karakterleri olamaz");
assert.deepEqual(evil.efforts, { claude: "", codex: "" });
for (const junk of [null, undefined, 3, "x", []]) assert.equal(V.sanitizeCfg(junk).captain, "claude");
assert.ok(V.DECISIONS.includes("accept") && !V.DECISIONS.includes("delete"));
console.log("VALIDATE OK");
