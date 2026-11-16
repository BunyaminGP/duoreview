// Kullanıcı inceleyiciyi değiştirebilir; seçim geçersizleşirse takım sırasına dönülür.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, run, one, reviewerOf, setReviewer, taskDetail } from "../dist/flow.js";

const dir = mkdtempSync(join(tmpdir(), "reviewer-"));
const db = openDb(dir);
setMeta(db, "team", "claude,codex,gemini");
run(db, "INSERT INTO tasks (title, status, owner) VALUES ('a', 'REVIEW', 'claude'), ('b', 'DONE', 'claude'), ('c', 'TODO', NULL)");
const task = (id) => one(db, "SELECT * FROM tasks WHERE id=?", id);
const events = () => one(db, "SELECT COUNT(*) n FROM events").n;

assert.equal(reviewerOf(db, task(1)), "codex", "varsayılan: sahibinden sonraki ajan");
assert.equal(taskDetail(db, 1).reviewer, "codex");
assert.equal(taskDetail(db, 3).reviewer, null, "sahipsiz görevde inceleyici yok");

assert.equal(setReviewer(db, 1, "claude"), false, "sahibi kendi işini inceleyemez");
assert.equal(setReviewer(db, 2, "gemini"), false, "biten görevde değişmez");
assert.equal(setReviewer(db, 3, "gemini"), false, "sahipsiz görevde değişmez");
assert.equal(setReviewer(db, 99, "gemini"), false);
assert.equal(events(), 0);

assert.equal(setReviewer(db, 1, "gemini"), true);
assert.equal(reviewerOf(db, task(1)), "gemini");
assert.equal(taskDetail(db, 1).reviewer, "gemini");
assert.equal(events(), 1);
assert.equal(setReviewer(db, 1, "gemini"), true, "aynı seçim yeniden olay yazmaz");
assert.equal(events(), 1);

setMeta(db, "team", "claude,codex");
assert.equal(reviewerOf(db, task(1)), "codex", "seçilen ajan takımdan çıkınca takım sırası geçerli");
assert.equal(setReviewer(db, 1, "gemini"), false, "takım dışı ajan seçilemez");

setMeta(db, "team", "claude,codex,gemini");
run(db, "UPDATE tasks SET owner='gemini' WHERE id=1");
assert.equal(reviewerOf(db, task(1)), "claude", "seçilen ajan görevin sahibi olursa takım sırası geçerli");

db.close();
rmSync(dir, { recursive: true, force: true });
console.log("REVIEWER OK");
