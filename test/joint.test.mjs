// Ortak açılış: iki ajan ayrı ayrı inceler, notlar ikisi de yazana dek gizlidir, sonra tartışma ve plan onayı gelir.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, one, discussion, nextAction, signature } from "../dist/flow.js";

async function team() {
  const dir = mkdtempSync(join(tmpdir(), "joint-"));
  const db = openDb(dir);
  setMeta(db, "captain", "claude");
  setMeta(db, "kickoff", "joint");
  setMeta(db, "brief", "projeyi analiz edin");
  const connect = async (agent) => {
    const c = new Client({ name: agent, version: "1" });
    await c.connect(new StdioClientTransport({
      command: "node", args: [resolve("dist/server.js")],
      env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: dir },
    }));
    return {
      call: async (name, args = {}) => {
        const r = await c.callTool({ name, arguments: args });
        const t = r.content[0].text;
        try { return { err: r.isError, data: JSON.parse(t) }; } catch { return { err: r.isError, data: t }; }
      },
      close: () => c.close(),
    };
  };
  const claude = await connect("claude"), codex = await connect("codex");
  const done = async () => { await claude.close(); await codex.close(); db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { db, claude, codex, done };
}
const next = async (a) => (await a.call("next_action")).data;

{
  const { db, claude, codex, done } = await team();

  // Kurallar ve talimat ilk cevapla gelir (terminale uzun metin yapıştırılmaz), ikinci cevapta tekrarlanmaz
  const first = await next(claude);
  assert.equal(first.action, "ANALYZE");
  assert.equal(first.brief, "projeyi analiz edin");
  assert.match(first.rules, /KAPTAN/); assert.match(first.rules, /Üslup/); assert.match(first.rules, /projeyi analiz edin/);
  assert.equal((await next(claude)).rules, undefined);
  const w = await next(codex);
  assert.equal(w.action, "ANALYZE", "işçi de inceler, kaptanı beklemez");
  assert.match(w.rules, /işçi/);

  // Kaptan inceleme bitmeden plan yazamaz
  assert.ok((await claude.call("post_tasks", { tasks: [{ title: "x" }] })).err);

  // Notlar bağımsız: ortağınki, ikisi de yazana kadar görünmez
  await claude.call("post_note", { text: "CLAUDE: flow.ts tek dosyada, test var" });
  assert.equal((await next(claude)).action, "WAIT");
  assert.ok(!JSON.stringify(await next(codex)).includes("CLAUDE:"), "ortağın notu sızmamalı");
  assert.equal((await codex.call("read_thread")).data, "");
  await codex.call("post_note", { text: "CODEX: referee.js zamanlayıcıya bağlı" });

  // Tartışma: ilk söz işçide, kaptan bekler
  assert.equal((await next(claude)).action, "WAIT");
  const d1 = await next(codex);
  assert.equal(d1.action, "DISCUSS"); assert.equal(d1.kind, "kickoff");
  assert.match(d1.note, /^CLAUDE:/); assert.equal(d1.left, 4);
  assert.ok((await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "x" })).err, "sıra kaptanda değil");
  await codex.call("discuss", { thread: d1.thread, stance: "object", text: "test kapsamı hakem zamanlamasını ölçmüyor" });
  assert.equal((await next(codex)).action, "WAIT");
  const d2 = await next(claude);
  assert.equal(d2.action, "DISCUSS");
  assert.match(d2.note, /^CODEX:/);
  assert.deepEqual(d2.posts, [{ by: "codex", stance: "object", text: "test kapsamı hakem zamanlamasını ölçmüyor" }]);
  assert.equal((await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "haklısın, plana ekliyorum" })).data, "CLOSED:agreed");

  // Plan kaptanda; iş bölümü ortağın onayından geçer, o zamana dek kimse işe başlamaz
  const plan = await next(claude);
  assert.equal(plan.action, "PLAN"); assert.equal(plan.outcome, "agreed");
  assert.equal(plan.note, undefined, "aynı not oturumda ikinci kez gönderilmez");
  const posted = await claude.call("post_tasks", { tasks: [
    { title: "a", assignee: "claude", touches: ["a/"] }, { title: "b", assignee: "claude", touches: ["b/"] },
    { title: "c", assignee: "claude", touches: ["c/"] }, { title: "d", assignee: "codex", touches: ["d/"] },
  ] });
  assert.match(posted.data.warn, /claude 3, codex 1/, "dengesiz yük uyarısı");
  assert.equal((await next(claude)).action, "WAIT");
  const p1 = await next(codex);
  assert.equal(p1.action, "DISCUSS"); assert.equal(p1.kind, "plan");
  assert.match(p1.posts[0].text, /#1 a → claude \[a\/\]/);
  await codex.call("discuss", { thread: p1.thread, stance: "object", text: "3'e 1 dengesiz, #3 bana" });
  assert.equal((await next(claude)).action, "DISCUSS");
  assert.ok(!(await claude.call("assign_task", { id: 3, assignee: "codex" })).err);
  await claude.call("discuss", { thread: p1.thread, stance: "propose", text: "#3 sana geçti" });
  await codex.call("discuss", { thread: p1.thread, stance: "agree", text: "tamam" });
  assert.equal((await next(claude)).action, "CLAIM");
  assert.equal((await next(codex)).action, "CLAIM");

  // Çalışırken açılan tartışma işi durdurmaz; ortak sıradaki adımında yanıtlar
  await claude.call("claim_task", { id: 1 });
  const ot = await claude.call("open_thread", { topic: "a/ için arayüz", text: "sync mi async mi?", task: 1 });
  assert.equal((await next(claude)).action, "FINISH_WORK");
  const q = await next(codex);
  assert.equal(q.action, "DISCUSS"); assert.equal(q.task, 1);
  // Hakem aynı tartışmanın her turunu ayrı durum sayar (dürtme sınırı tur başına)
  const s1 = signature(nextAction(db, "codex"));
  await codex.call("discuss", { thread: ot.data.thread, stance: "propose", text: "sync yeter, çağıran tek yer" });
  await claude.call("discuss", { thread: ot.data.thread, stance: "object", text: "ikinci çağıran geliyor" });
  assert.notEqual(signature(nextAction(db, "codex")), s1);
  await codex.call("discuss", { thread: ot.data.thread, stance: "agree", text: "o zaman async" });
  assert.equal((await next(codex)).action, "CLAIM");

  // Kaptan TODO görevi silebilir
  assert.ok((await codex.call("drop_task", { id: 2 })).err);
  assert.ok(!(await claude.call("drop_task", { id: 2 })).err);
  assert.ok((await claude.call("drop_task", { id: 1 })).err, "başlanmış görev silinmez");

  const talk = discussion(db);
  assert.equal(talk.notes.length, 2);
  assert.deepEqual(talk.threads.map((t) => [t.kind, t.outcome, t.posts.length]), [["kickoff", "agreed", 2], ["plan", "agreed", 4], ["free", "agreed", 4]]);
  await done();
}

// Yalnız analiz isteyen iş: görev çıkmaz, iki not ve tartışma teslimattır. Uzlaşı yoksa mesaj sınırında "ayrışma" olur.
{
  const { db, claude, codex, done } = await team();
  await next(claude); await next(codex);
  await claude.call("post_note", { text: "A", title: "claude analizi" });
  await codex.call("post_note", { text: "B" });
  const th = (await next(codex)).thread;
  for (const a of [codex, claude, codex]) await a.call("discuss", { thread: th, stance: "object", text: "katılmıyorum" });
  assert.equal((await claude.call("discuss", { thread: th, stance: "object", text: "ben de" })).data, "CLOSED:split");
  assert.equal((await next(claude)).outcome, "split");
  assert.ok(!(await claude.call("post_tasks", { tasks: [] })).err);
  assert.equal((await next(claude)).action, "ALL_DONE");
  assert.equal((await next(codex)).action, "ALL_DONE");
  // Sonradan yazılan not açılış notu sayılmaz, hemen ortaktır
  await codex.call("post_note", { text: "ek bulgu" });
  assert.equal(one(db, "SELECT kind FROM notes ORDER BY id DESC").kind, "note");
  await done();
}

console.log("JOINT OK");
