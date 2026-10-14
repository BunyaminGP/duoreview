// Ortak açılış: iki ajan ayrı ayrı inceler, notlar ikisi de yazana dek gizlidir, sonra tartışma ve plan onayı gelir.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, one, run, discussion, nextAction, signature, teamChangeBlocked } from "../dist/flow.js";

async function team(members = ["claude", "codex"]) {
  const dir = mkdtempSync(join(tmpdir(), "joint-"));
  const db = openDb(dir);
  setMeta(db, "team", members.join(","));
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
  const claude = await connect("claude"), codex = await connect("codex"), gemini = await connect("gemini");
  const done = async () => { for (const a of [claude, codex, gemini]) await a.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { db, claude, codex, gemini, done };
}
const next = async (a) => (await a.call("next_action")).data;

{
  const { db, claude, codex, done } = await team();

  // Kurallar ve talimat ilk cevapla gelir (terminale uzun metin yapıştırılmaz), ikinci cevapta tekrarlanmaz
  const first = await next(claude);
  assert.equal(first.action, "ANALYZE");
  assert.equal(first.brief, undefined, "talimat yalnız rules içinde gider");
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
  const noted = await codex.call("post_note", { text: "CODEX: referee.js zamanlayıcıya bağlı" });

  // Tartışma: ilk söz işçide, kaptan bekler
  assert.equal((await next(claude)).action, "WAIT");
  const d1 = noted.data.next;
  assert.equal(d1.action, "DISCUSS"); assert.equal(d1.kind, "kickoff");
  assert.match(d1.notes[0].text, /^CLAUDE:/); assert.equal(d1.left, 4);
  assert.ok((await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "x" })).err, "sıra kaptanda değil");
  await codex.call("discuss", { thread: d1.thread, stance: "object", text: "test kapsamı hakem zamanlamasını ölçmüyor" });
  assert.equal((await next(codex)).action, "WAIT");
  const d2 = await next(claude);
  assert.equal(d2.action, "DISCUSS");
  assert.match(d2.notes[0].text, /^CODEX:/);
  assert.deepEqual(d2.posts, [{ by: "codex", stance: "object", text: "test kapsamı hakem zamanlamasını ölçmüyor" }]);
  const agreed = await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "haklısın, plana ekliyorum" });
  assert.equal(agreed.data.result, "CLOSED:agreed");

  // Plan kaptanda; iş bölümü ortağın onayından geçer, o zamana dek kimse işe başlamaz
  const plan = agreed.data.next;
  assert.equal(plan.action, "PLAN"); assert.equal(plan.outcome, "agreed");
  assert.equal(plan.notes, undefined, "aynı not oturumda ikinci kez gönderilmez");
  const posted = await claude.call("post_tasks", { tasks: [
    { title: "a", assignee: "claude", touches: ["a/"] }, { title: "b", assignee: "claude", touches: ["b/"] },
    { title: "c", assignee: "claude", touches: ["c/"] }, { title: "d", assignee: "codex", touches: ["d/"] },
  ] });
  assert.match(posted.data.warn, /claude 3, codex 1/, "dengesiz yük uyarısı");
  assert.equal((await next(claude)).action, "WAIT");
  assert.ok((await codex.call("claim_task", { id: 4 })).err, "plan onayı doğrudan claim ile atlanamaz");
  const p1 = await next(codex);
  assert.equal(p1.action, "DISCUSS"); assert.equal(p1.kind, "plan");
  assert.match(p1.posts[0].text, /#1 a → claude \[a\/\]/);
  await codex.call("discuss", { thread: p1.thread, stance: "object", text: "3'e 1 dengesiz, #3 bana" });
  assert.equal((await next(claude)).action, "DISCUSS");
  assert.ok(!(await claude.call("assign_task", { id: 3, assignee: "codex" })).err);
  await claude.call("discuss", { thread: p1.thread, stance: "propose", text: "#3 sana geçti" });
  const accepted = await codex.call("discuss", { thread: p1.thread, stance: "agree", text: "tamam" });
  assert.equal(accepted.data.next.action, "FINISH_WORK");
  assert.equal(accepted.data.next.id, 3);
  assert.equal((await next(claude)).action, "FINISH_WORK");

  // Çalışırken açılan tartışma işi durdurmaz; ortak sıradaki adımında yanıtlar
  const ot = await claude.call("open_thread", { topic: "a/ için arayüz", text: "sync mi async mi?", task: 1 });
  assert.equal((await next(claude)).action, "FINISH_WORK");
  assert.equal((await next(codex)).action, "FINISH_WORK", "önce üstlenilmiş iş tamamlanır");
  const q = (await codex.call("submit_task", { id: 3, summary: "c tamam", files: ["c/x"] })).data.next;
  assert.equal(q.action, "DISCUSS"); assert.equal(q.task, 1);
  // Hakem aynı tartışmanın her turunu ayrı durum sayar (dürtme sınırı tur başına)
  const s1 = signature(nextAction(db, "codex"));
  await codex.call("discuss", { thread: ot.data.thread, stance: "propose", text: "sync yeter, çağıran tek yer" });
  await claude.call("discuss", { thread: ot.data.thread, stance: "object", text: "ikinci çağıran geliyor" });
  assert.notEqual(signature(nextAction(db, "codex")), s1);
  const closed = await codex.call("discuss", { thread: ot.data.thread, stance: "agree", text: "o zaman async" });
  assert.equal(closed.data.next.action, "FINISH_WORK");
  assert.equal(closed.data.next.id, 4);

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
  const split = await claude.call("discuss", { thread: th, stance: "object", text: "ben de" });
  assert.equal(split.data.result, "CLOSED:split");
  assert.equal(split.data.next.outcome, "split");
  assert.ok(!(await claude.call("post_tasks", { tasks: [] })).err);
  assert.equal((await next(claude)).action, "ALL_DONE");
  assert.equal((await next(codex)).action, "ALL_DONE");
  // Sonradan yazılan not açılış notu sayılmaz, hemen ortaktır
  await codex.call("post_note", { text: "ek bulgu" });
  assert.equal(one(db, "SELECT kind FROM notes ORDER BY id DESC").kind, "note");
  await done();
}

// Üç ajan: notlar herkes yazınca açılır, söz sırası kaptandan sonraki işçiyle döner, son öneriyi yazan dışındaki herkes katılınca uzlaşılır.
// İnceleme döngüseldir: claude'un işini codex, codex'inkini gemini, gemini'ninkini claude inceler.
{
  const { db, claude, codex, gemini, done } = await team(["claude", "codex", "gemini"]);
  for (const a of [claude, codex, gemini]) assert.equal((await next(a)).action, "ANALYZE");
  await claude.call("post_note", { text: "CLAUDE notu" });
  await codex.call("post_note", { text: "CODEX notu" });
  const w = await next(codex);
  assert.equal(w.action, "WAIT"); assert.match(w.why, /gemini/);
  const g = await gemini.call("post_note", { text: "GEMINI notu" });
  assert.equal(g.data.next.action, "WAIT", "ilk söz kaptandan sonraki işçide (codex)");
  const d1 = await next(codex);
  assert.equal(d1.action, "DISCUSS"); assert.equal(d1.left, 6);
  assert.deepEqual(d1.notes.map((n) => n.by), ["claude", "gemini"]);
  assert.ok((await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "x" })).err, "sıra codex'te");
  await codex.call("discuss", { thread: d1.thread, stance: "object", text: "gemini notu eksik" });
  const d2 = await next(gemini);
  assert.equal(d2.action, "DISCUSS"); assert.deepEqual(d2.notes.map((n) => n.by), ["claude", "codex"]);
  const a1 = await gemini.call("discuss", { thread: d1.thread, stance: "agree", text: "codex haklı" });
  assert.equal(a1.data.left, 4, "tek agree üç kişide tartışmayı kapatmaz");
  const a2 = await claude.call("discuss", { thread: d1.thread, stance: "agree", text: "plana ekliyorum" });
  assert.equal(a2.data.result, "CLOSED:agreed");
  assert.equal(a2.data.next.action, "PLAN");

  assert.ok((await claude.call("post_tasks", { tasks: [{ title: "x", assignee: "nobody" }] })).err);
  const posted = await claude.call("post_tasks", { tasks: [
    { title: "a", assignee: "claude", touches: ["a/"] }, { title: "b", assignee: "codex", touches: ["b/"] },
    { title: "c", assignee: "gemini", touches: ["c/"] }, { title: "d", assignee: "gemini", touches: ["d/"] },
  ] });
  assert.equal(posted.data.warn, undefined, "2-1-1 dengeli sayılır");
  assert.equal(posted.data.quota, 2);
  const p1 = await next(codex);
  assert.equal(p1.action, "DISCUSS"); assert.equal(p1.kind, "plan");
  assert.equal((await codex.call("discuss", { thread: p1.thread, stance: "agree", text: "tamam" })).data.next.action, "WAIT", "gemini de onaylamalı");
  assert.equal((await gemini.call("discuss", { thread: p1.thread, stance: "agree", text: "tamam" })).data.next.id, 3);

  // Mesaj: alıcı yoksa tüm ortaklara, kendine gönderilemez
  assert.ok((await gemini.call("send_prompt", { text: "x", to: "gemini" })).err);
  await gemini.call("send_prompt", { text: "c/ bitti sayılır" });
  assert.deepEqual(db.prepare("SELECT recipient FROM messages ORDER BY id").all().map((r) => r.recipient), ["claude", "codex"]);

  assert.equal((await next(claude)).id, 1);
  assert.equal((await next(codex)).id, 2);
  await claude.call("submit_task", { id: 1, summary: "a", files: ["a/x"] });
  await codex.call("submit_task", { id: 2, summary: "b", files: ["b/x"] });
  await gemini.call("submit_task", { id: 3, summary: "c", files: ["c/x"] });
  assert.equal((await gemini.call("submit_task", { id: 4, summary: "d", files: ["d/x"] })).data.next.action, "REVIEW");
  assert.ok((await gemini.call("review_task", { id: 1, verdict: "approve", comment: "ok" })).err, "#1'in inceleyicisi codex");
  const reviews = { claude: await next(claude), codex: await next(codex), gemini: await next(gemini) };
  assert.deepEqual(Object.values(reviews).map((r) => [r.action, r.id]), [["REVIEW", 3], ["REVIEW", 1], ["REVIEW", 2]]);
  await done();
}

// Takımda olmayan ajan bekler; görev ona atanamaz. Yarım iş varken takım değişmez (görev sahipsiz kalırdı).
{
  const { db, claude, gemini, done } = await team(["claude", "codex"]);
  const n = await next(gemini);
  assert.equal(n.action, "WAIT"); assert.match(n.why, /takımda değilsin/);
  assert.match((await claude.call("assign_task", { id: 1, assignee: "gemini" })).data, /Takımda olmayan/);
  const trio = ["claude", "codex", "gemini"];
  assert.equal(teamChangeBlocked(db, trio), false, "boş panoda takım değişebilir");
  await claude.call("post_note", { text: "açılış notu" });
  assert.equal(teamChangeBlocked(db, trio), true, "süren açılışta değişmez");
  assert.equal(teamChangeBlocked(db, ["claude", "codex"]), false, "aynı takım her zaman başlar");
  setMeta(db, "planned", "1");
  run(db, "INSERT INTO tasks(title, status, owner) VALUES ('x', 'WORKING', 'codex')");
  assert.equal(teamChangeBlocked(db, trio), true, "bitmemiş görev varken değişmez");
  run(db, "UPDATE tasks SET status='DONE'");
  assert.equal(teamChangeBlocked(db, trio), false, "hepsi bitince değişebilir");
  await done();
}

console.log("JOINT OK");
