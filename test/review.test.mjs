// Kanıtlı inceleme: görev başına diff, sahipsiz değişiklik, doğrulama kapısı, kabul kriterleri, alternatif → kaptan kararı.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, one } from "../dist/flow.js";

const dir = mkdtempSync(join(tmpdir(), "rv-"));
const project = mkdtempSync(join(tmpdir(), "rv-proj-"));
const git = (...args) => execFileSync("git", args, { cwd: project, stdio: "ignore" });
git("init", "-q");
git("config", "user.email", "t@t"); git("config", "user.name", "t"); git("config", "core.autocrlf", "false");
writeFileSync(join(project, "check.js"), `process.exit(require("fs").readFileSync("a.txt", "utf8").includes("hello") ? 0 : 1);\n`);
writeFileSync(join(project, "a.txt"), "old\n");
git("add", "-A"); git("commit", "-qm", "base");

const adminDb = openDb(dir);
setMeta(adminDb, "captain", "claude");
setMeta(adminDb, "review_mode", "immediate");
setMeta(adminDb, "verify", "node check.js");

async function connect(agent) {
  const c = new Client({ name: agent, version: "1" });
  await c.connect(new StdioClientTransport({
    command: "node", args: [resolve("dist/server.js")],
    env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: dir, DUOREVIEW_PROJECT: project, DUOREVIEW_LANG: "en" },
  }));
  return {
    call: async (name, args = {}) => {
      const r = await c.callTool({ name, arguments: args });
      const t = r.content[0].text;
      try { return { err: !!r.isError, data: JSON.parse(t) }; } catch { return { err: !!r.isError, data: t }; }
    },
    close: () => c.close(),
  };
}
const claude = await connect("claude");
const codex = await connect("codex");
const write = (f, s) => writeFileSync(join(project, f), s);

try {
  assert.equal((await claude.call("next_action")).data.action, "PLAN");
  // Aynı plandaki bağımlılık key ile; öncül listede sonra gelirse ya da key yoksa hata
  assert.ok((await claude.call("post_tasks", { tasks: [{ title: "x", depends_on: ["later"] }, { key: "later", title: "y" }] })).err);
  assert.ok((await claude.call("post_tasks", { tasks: [{ key: "k", title: "x" }, { key: "k", title: "y" }] })).err);
  const plan = (await claude.call("post_tasks", { tasks: [
    { key: "a", title: "A", touches: ["a.txt"], acceptance: ["a.txt contains hello"], assignee: "claude" },
    { title: "B", touches: ["b.txt"], assignee: "codex" },
    { title: "C", assignee: "codex", depends_on: ["a"] },
  ] })).data;
  assert.deepEqual(plan.ids, [1, 2, 3]);
  assert.match(plan.warn, /touches is empty: #3/);
  assert.equal(one(adminDb, "SELECT depends_on FROM tasks WHERE id=3").depends_on, "[1]");
  assert.deepEqual([plan.next.action, plan.next.id, plan.next.acceptance], ["FINISH_WORK", 1, ["a.txt contains hello"]]);
  assert.equal((await codex.call("next_action")).data.id, 2);

  write("a.txt", "draft\n"); write("stray.txt", "?\n"); write("b.txt", "b\n");
  // Doğrulama komutu geçmeden görev incelemeye girmez
  const failed = await claude.call("submit_task", { id: 1, summary: "a", files: ["a.txt"] });
  assert.ok(failed.err && /verify command failed/.test(failed.data));
  assert.equal(one(adminDb, "SELECT status FROM tasks WHERE id=1").status, "WORKING");
  write("a.txt", "hello\n");
  const sub = (await claude.call("submit_task", { id: 1, summary: "a", files: ["a.txt"] })).data;
  assert.deepEqual(sub.unclaimed, ["stray.txt"], "touches dışında değişen dosya işaretlenir");
  assert.equal(sub.next.action, "WAIT", "C, A onaylanmadan başlamaz");

  const r = (await codex.call("submit_task", { id: 2, summary: "b", files: ["b.txt"] })).data.next;
  assert.deepEqual([r.action, r.id], ["REVIEW", 1]);
  assert.match(r.diff, /\+hello/);
  assert.doesNotMatch(r.diff, /b\.txt/, "ortağın görevindeki dosya bu görevin diff'ine girmez");
  assert.match(r.diff, /stray\.txt/);
  assert.deepEqual(r.unclaimed, ["stray.txt"]);
  assert.equal(r.verify.ok, true);
  assert.deepEqual(r.acceptance, ["a.txt contains hello"]);

  // Kabul kriterleri: sayı, kanıt ve karşılanma denetlenir
  assert.match((await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok" })).data, /1 acceptance criteria/);
  assert.match((await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok", checks: [{ ok: true, evidence: " " }] })).data, /evidence for criterion 1/);
  assert.match((await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok", checks: [{ ok: false, evidence: "a.txt:1" }] })).data, /Criterion 1 is not met/);
  // Ortam yüzünden denetlenemeyen kriter (blocked) onayı engellemez ama kanıt ister
  assert.match((await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok", checks: [{ ok: false, blocked: true, evidence: "" }] })).data, /evidence for criterion 1/);
  const ap = (await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok",
    checks: [{ ok: false, blocked: true, evidence: "python -m pytest: ImportError cgi" }], alternative: "write a.txt with one fs call" })).data;
  assert.deepEqual([ap.next.action, ap.next.id], ["FINISH_WORK", 3], "öncül onaylanınca bağlı görev başlar");

  assert.equal((await claude.call("next_action")).data.id, 2);
  await claude.call("review_task", { id: 2, verdict: "approve", comment: "ok" });
  await codex.call("submit_task", { id: 3, summary: "c" });
  const done3 = (await claude.call("review_task", { id: 3, verdict: "approve", comment: "ok" })).data;

  // Tüm işler bitti ama bekleyen alternatif var: kaptan karara bağlar, ortak bekler
  assert.equal(done3.next.action, "TRIAGE");
  assert.deepEqual(done3.next.items.map((i) => [i.task, i.by, i.text]), [[1, "codex", "write a.txt with one fs call"]]);
  assert.equal((await codex.call("next_action")).data.action, "WAIT");
  assert.ok((await codex.call("triage", { review: done3.next.items[0].review, decision: "reject", reason: "x" })).err, "yalnız kaptan");
  assert.ok((await claude.call("triage", { review: done3.next.items[0].review, decision: "reject", reason: "" })).err, "gerekçe zorunlu");
  const tri = (await claude.call("triage", { review: done3.next.items[0].review, decision: "adopt", reason: "fewer calls" })).data;
  assert.equal(tri.task, 4);
  const t4 = (await codex.call("next_action")).data;
  assert.deepEqual([t4.action, t4.id, t4.acceptance], ["FINISH_WORK", 4, ["a.txt contains hello"]], "öneren uygular, kriterler korunur");
  assert.match(t4.spec, /one fs call/);
  await codex.call("submit_task", { id: 4, summary: "alt" });
  await claude.call("review_task", { id: 4, verdict: "approve", comment: "ok", checks: [{ ok: true, evidence: "a.txt:1" }] });
  assert.equal((await claude.call("next_action")).data.action, "ALL_DONE");
  assert.equal((await codex.call("next_action")).data.action, "ALL_DONE");

  // Gelen kutusu: okunan mesaj bir daha gelmez
  await claude.call("send_prompt", { text: "hi", to: "codex" });
  assert.deepEqual((await codex.call("read_inbox")).data, [{ sender: "claude", text: "hi" }]);
  assert.deepEqual((await codex.call("read_inbox")).data, []);
  console.log("REVIEW OK");
} finally {
  await claude.close(); await codex.close(); adminDb.close();
  rmSync(dir, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true });
}
