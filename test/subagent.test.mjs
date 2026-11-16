// Subagent kuralı briefing'e seçilen kipe göre girer; taskDetail arayüzün görev ayrıntısını tek sorguda verir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, run, briefing, taskDetail } from "../dist/flow.js";
import { setLang, MESSAGES } from "../dist/i18n.js";

const dir = mkdtempSync(join(tmpdir(), "subagent-"));
const db = openDb(dir);
setMeta(db, "team", "claude,codex,gemini");

const KEY = { off: "subOff", research: "subResearch", scoped: "subScoped" };
for (const lang of ["tr", "en"]) {
  setLang(lang);
  const M = MESSAGES[lang];
  run(db, "DELETE FROM meta WHERE key='subagents'");
  assert.ok(briefing(db, "claude").includes(M.subResearch), `${lang}: kayıt yokken research`);
  for (const [mode, key] of Object.entries(KEY)) {
    setMeta(db, "subagents", mode);
    const text = briefing(db, "codex");
    for (const k of Object.values(KEY)) assert.equal(text.includes(M[k]), k === key, `${lang}/${mode}: yalnız ${key}`);
    assert.equal(text.includes(M.subRules), mode !== "off", `${lang}/${mode}: ortak kural`);
  }
  setMeta(db, "subagents", "bozuk");
  assert.ok(briefing(db, "claude").includes(M.subResearch), `${lang}: geçersiz değer research sayılır`);
}

assert.equal(taskDetail(db, 99), null);
const id = Number(run(db,
  "INSERT INTO tasks(title, description, status, owner, assignee, touches, acceptance, depends_on, summary, files, diff, unclaimed, rounds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  "Sepet", "Sepet toplamı", "REWORK", "codex", "codex", '["src/cart.js"]', '["toplam doğru"]', "[]", "bitti", '["src/cart.js"]', "+a\n-b", '["x.md"]', 1).lastInsertRowid);
run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment, checks, alternative) VALUES (?,?,?,?,?,?)",
  id, "gemini", "request_changes", "toplam yanlış", '[{"ok":false,"evidence":"src/cart.js:4"}]', "reduce kullan");
const d = taskDetail(db, id);
assert.deepEqual(d.acceptance, ["toplam doğru"]);
assert.deepEqual(d.touches, ["src/cart.js"]);
assert.deepEqual(d.depends_on, []);
assert.deepEqual(d.unclaimed, ["x.md"]);
assert.equal(d.diff, "+a\n-b");
assert.equal(d.description, "Sepet toplamı");
assert.deepEqual(d.reviews, [{ reviewer: "gemini", verdict: "request_changes", comment: "toplam yanlış", checks: [{ ok: false, evidence: "src/cart.js:4" }], alternative: "reduce kullan" }]);
const bare = taskDetail(db, Number(run(db, "INSERT INTO tasks(title) VALUES ('boş')").lastInsertRowid));
assert.deepEqual([bare.reviews, bare.acceptance, bare.diff, bare.verify], [[], [], "", null]);

db.close();
rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
console.log("SUBAGENT OK");
