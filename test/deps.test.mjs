import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../dist/db.js";
import { claimable, nextAction, one, openThread, reviewPhaseOpen, run, setMeta } from "../dist/flow.js";

const dir = mkdtempSync(join(tmpdir(), "deps-"));
let db = openDb(dir);
try {
  setMeta(db, "planned", "1");
  run(db, "INSERT INTO tasks(title, owner, status) VALUES ('öncül','claude','WORKING')");
  run(db, "INSERT INTO tasks(title, assignee, depends_on) VALUES ('bağlı','codex','[1]')");
  const task = () => one(db, "SELECT * FROM tasks WHERE id=2");
  assert.ok(claimable(db, "codex", task()));
  assert.equal(reviewPhaseOpen(db), false);
  run(db, "UPDATE tasks SET status='REVIEW' WHERE id=1");
  assert.equal(reviewPhaseOpen(db), true, "bağlı TODO öncül incelemesini engellemez");
  assert.equal(nextAction(db, "codex").action, "REVIEW");
  run(db, "UPDATE tasks SET status='DISPUTE' WHERE id=1");
  assert.ok(claimable(db, "codex", task()), "ihtilaf onay değildir");
  assert.equal(nextAction(db, "codex").action, "WAIT");
  run(db, "UPDATE tasks SET status='DONE' WHERE id=1");
  assert.equal(claimable(db, "codex", task()), null);
  assert.equal(reviewPhaseOpen(db), false, "hazır iş varsa after_all bekler");
  assert.equal(nextAction(db, "codex").action, "CLAIM");
  assert.equal(task().status, "TODO", "saf zamanlayıcı işi üstlenmez");
  const thread = openThread(db, { kind: "plan", topic: "plan", by: "claude", blocking: true });
  assert.ok(claimable(db, "codex", task()), "doğrudan claim de plan onayını bekler");
  run(db, "UPDATE threads SET status='CLOSED' WHERE id=?", thread);
  setMeta(db, "review_mode", "immediate");
  assert.equal(reviewPhaseOpen(db), true);

  run(db, "UPDATE tasks SET status='WORKING', touches='[\"src/file.ts\"]' WHERE id=1");
  run(db, "UPDATE tasks SET depends_on='[]' WHERE id=2");
  for (const p of ["./src/file.ts", "src/other/../file.ts", ".", "./", "src\\file.ts",
    ...(process.platform === "win32" ? ["SRC/FILE.TS"] : [])]) {
    run(db, "UPDATE tasks SET touches=? WHERE id=2", JSON.stringify([p]));
    assert.ok(claimable(db, "codex", task()), `çakışma: ${p}`);
  }
  run(db, "UPDATE tasks SET touches='[\"src/other.ts\"]' WHERE id=2");
  assert.equal(claimable(db, "codex", task()), null);
  run(db, "UPDATE tasks SET depends_on='[999]' WHERE id=2");
  assert.ok(claimable(db, "codex", task()), "eksik öncül tamamlanmış sayılmaz");
  db.close();

  // Eski şemayı aynı verilerle aç; ikinci açılış migration'ı yinelememeli.
  db = new DatabaseSync(join(dir, "bridge.db"));
  db.exec("ALTER TABLE tasks DROP COLUMN depends_on");
  db.close();
  db = openDb(dir);
  assert.equal(task().depends_on, "[]");
  assert.equal(task().title, "bağlı");
  db.close();
  db = openDb(dir);
  assert.equal(db.prepare("PRAGMA table_info(tasks)").all().filter((c) => c.name === "depends_on").length, 1);
  console.log("DEPENDENCIES OK");
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
