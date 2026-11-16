// Çapraz inceleme açılışı: bağımsız analiz (iddialı), iddia iddia hüküm, itiraz sahibine savunma, yalnız itirazlı iddiaya ek tur, kaptan kararı.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, nextAction, discussion, crossStage, signature } from "../dist/flow.js";

const TEAM = ["claude", "codex", "gemini"];
async function team() {
  const dir = mkdtempSync(join(tmpdir(), "cross-"));
  const db = openDb(dir);
  setMeta(db, "team", TEAM.join(","));
  setMeta(db, "captain", "claude");
  setMeta(db, "kickoff", "cross");
  setMeta(db, "brief", "kuyruk mimarisini değerlendirin");
  const connect = async (agent) => {
    const c = new Client({ name: agent, version: "1" });
    await c.connect(new StdioClientTransport({
      command: "node", args: [resolve("dist/server.js")],
      env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: dir, DUOREVIEW_LANG: "tr" },
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
  const a = Object.fromEntries(await Promise.all(TEAM.map(async (x) => [x, await connect(x)])));
  const done = async () => { for (const x of Object.values(a)) await x.close(); db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); };
  return { db, a, connect, done };
}
const next = async (x) => (await x.call("next_action")).data;
const delivered = (db, who) => db.prepare("SELECT item FROM deliveries WHERE recipient=? ORDER BY id").all(who).map((r) => r.item);

// Tam akış: codex C1'e itiraz eder, gemini emin değildir; claude savunur, 2. turda yalnız onlar yeniden hükmeder; kaptan karar yazar.
{
  const { db, a, connect, done } = await team();
  const { claude, gemini } = a;
  let codex = a.codex;
  const first = await next(claude);
  assert.equal(first.action, "ANALYZE");
  assert.match(first.rules, /Çapraz inceleme açılışı/);

  assert.ok((await claude.call("post_note", { text: "x" })).err, "çapraz açılışta iddiasız not olmaz");
  const n1 = await claude.call("post_note", { text: "CLAUDE: kuyruk için Redis Streams", claims: [
    { text: "Redis Streams tüketici grupları en az bir kez teslimi sağlar", evidence: "redis.io/docs XACK" },
    { text: "Sıra garantisi bölüm başına yeterli", evidence: "orders yalnız müşteri içinde sıralı" },
  ] });
  assert.deepEqual(n1.data.claims, ["C1", "C2"]);
  assert.equal(n1.data.note, "N1");
  // Bağımsızlık: ortakların notu ve iddiaları herkes yazana dek görünmez
  const peek = await codex.call("read_claims");
  assert.deepEqual(peek.data.claims, []);
  await codex.call("post_note", { text: "CODEX: Kafka öner", claims: [{ text: "Kafka bölümleri yatay ölçeklenir", evidence: "kafka.apache.org/documentation #intro_concepts" }] });
  assert.ok(!JSON.stringify(await next(codex)).includes("CLAUDE:"), "gemini yazmadan not sızmaz");
  const g = await gemini.call("post_note", { text: "GEMINI: Postgres SKIP LOCKED yeter", claims: [{ text: "Saniyede 500 iş için ayrı broker gereksiz", evidence: "pg docs SELECT FOR UPDATE SKIP LOCKED" }] });

  // Aşama 2: her ajan diğer ikisinin tam notunu ve tüm iddialarını alır
  const gx = g.data.next;
  assert.equal(gx.action, "CROSS_REVIEW"); assert.equal(gx.round, 1);
  assert.deepEqual(gx.notes.map((n) => [n.id, n.by]), [["N1", "claude"], ["N2", "codex"]]);
  assert.match(gx.notes[0].text, /^CLAUDE:/); assert.match(gx.notes[1].text, /^CODEX:/);
  assert.deepEqual(gx.claims.map((c) => c.id), ["C1", "C2", "C3"]);
  assert.equal(gx.claims[0].text, "Redis Streams tüketici grupları en az bir kez teslimi sağlar");

  // Teslim edilmeden hüküm verilemez: claude henüz next_action çağırmadı
  const early = await claude.call("assess", { items: [{ claim: "C3", verdict: "agree", text: "doğru", evidence: "x" }] });
  assert.ok(early.err); assert.match(early.data, /teslim edilmedi: C3/);
  const cx = await next(claude);
  assert.deepEqual(cx.notes.map((n) => n.by), ["codex", "gemini"]);
  assert.deepEqual(cx.claims.map((c) => c.id), ["C3", "C4"], "kendi iddiaları gelmez");
  const dx = await next(codex);
  assert.deepEqual(dx.claims.map((c) => c.id), ["C1", "C2", "C4"]);
  for (const [who, mine] of [["claude", ["N2", "N3", "C3", "C4"]], ["codex", ["N1", "N3", "C1", "C2", "C4"]], ["gemini", ["N1", "N2", "C1", "C2", "C3"]]]) {
    assert.deepEqual(delivered(db, who).sort(), mine.sort(), `${who} diğer iki ajanın gerçek içeriğini aldı`);
  }

  // Kurallar: kanıtsız agree yok, başkasının sırasındaki ya da kendi iddiası yok, tekrar yok
  assert.match((await codex.call("assess", { items: [{ claim: "C1", verdict: "agree", text: "doğru" }] })).data, /kanıt/);
  assert.match((await codex.call("assess", { items: [{ claim: "C3", verdict: "agree", text: "a", evidence: "b" }] })).data, /beklenmeyen/);
  assert.match((await codex.call("assess", { items: [{ claim: "C2", verdict: "agree", text: "a", evidence: "b" }, { claim: 2, verdict: "agree", text: "a", evidence: "b" }] })).data, /beklenmeyen/);

  const ca = await codex.call("assess", { items: [
    { claim: "C1", verdict: "disagree", text: "XACK olmadan bekleyen iş başka tüketiciye kendiliğinden geçmez; XAUTOCLAIM gerekir", evidence: "redis.io/docs/latest/commands/xautoclaim" },
    { claim: "C2", verdict: "agree", text: "müşteri başına sıra yeterli", evidence: "N1 gereksinim satırı" },
  ] });
  assert.deepEqual(ca.data.ids, ["A1", "A2"]);
  assert.equal(ca.data.next.action, "CROSS_REVIEW", "codex'in C4 hükmü eksik");
  assert.deepEqual(ca.data.next.claims.map((c) => c.id), ["C4"]);
  await codex.call("assess", { items: [{ claim: "C4", verdict: "agree", text: "500/s Postgres için düşük", evidence: "pgbench" }] });
  await gemini.call("assess", { items: [
    { claim: "C1", verdict: "unsure", text: "tüketici çökünce yeniden teslim süresi belirtilmemiş" },
    { claim: "C2", verdict: "agree", text: "doğru", evidence: "N1" },
    { claim: "C3", verdict: "agree", text: "doğru", evidence: "kafka docs" },
  ] });
  // Aşama 3 başlamadan claude'un hükmü eksik: hüküm turu bitmeden savunma yok, ortakların bu turdaki hükmü gizli
  assert.equal((await next(gemini)).action, "WAIT");
  const hidden = (await claude.call("read_claims")).data;
  assert.equal(hidden.phase, "assess:1");
  assert.equal(hidden.claims.find((c) => c.id === "C1").assessments.length, 0, "süren turda ortak hükümleri gizli");
  const last = await claude.call("assess", { items: [
    { claim: "C3", verdict: "agree", text: "doğru", evidence: "kafka docs" },
    { claim: "C4", verdict: "alternative", text: "SKIP LOCKED yerine LISTEN/NOTIFY ile yoklamasız uyandırma", evidence: "pg docs NOTIFY" },
  ] });

  // Aşama 3: itirazlar yalnız iddia sahiplerine gider; itirazsız C2 ve C3 için tur açılmaz
  assert.equal(last.data.next.action, "REBUTTAL");
  assert.deepEqual(last.data.next.claims.map((c) => [c.id, c.objections.map((o) => [o.id, o.by, o.verdict])]),
    [["C1", [["A1", "codex", "disagree"], ["A4", "gemini", "unsure"]]]]);
  const gr = await next(gemini);
  assert.equal(gr.action, "REBUTTAL");
  assert.deepEqual(gr.claims.map((c) => [c.id, c.objections.map((o) => o.id)]), [["C4", ["A8"]]]);
  assert.equal((await next(codex)).action, "WAIT", "codex'in iddiasına itiraz yok");
  assert.match((await claude.call("rebut", { items: [{ claim: "C1", action: "revise", text: "x" }] })).data, /revised/);
  const rb = await claude.call("rebut", { items: [{ claim: "C1", action: "defend", text: "XAUTOCLAIM tüketici döngüsünde zaten var; süre 30 sn", evidence: "worker.ts:42" }] });
  assert.deepEqual(rb.data.ids, ["R1"]);
  await gemini.call("rebut", { items: [{ claim: "C4", action: "withdraw", text: "LISTEN/NOTIFY daha iyi, geri çekiyorum" }] });

  // Ajan kapanıp yeniden bağlansa da kayıt kalır; yeni oturum içeriği yeniden alır
  await codex.close();
  codex = await connect("codex");
  a.codex = codex;
  // 2. tur: yalnız C1'e itiraz edenler (savunma "defend"); geri çekilen C4 için tur yok
  const r2 = await next(codex);
  assert.equal(r2.action, "CROSS_REVIEW"); assert.equal(r2.round, 2);
  assert.deepEqual(r2.claims.map((c) => [c.id, c.rebuttal.id, c.yours.id]), [["C1", "R1", "A1"]]);
  assert.equal((await next(claude)).action, "WAIT");
  const k2 = await codex.call("assess", { items: [{ claim: "C1", verdict: "disagree", text: "30 sn, 5 sn SLA'yı aşar", evidence: "N1 SLA satırı" }] });
  assert.equal(k2.data.next.action, "WAIT");
  // gemini'nin savunması (rebut) cevabındaki next, R1'i ona zaten teslim etti
  assert.ok(delivered(db, "gemini").includes("R1"));
  const g2 = await gemini.call("assess", { items: [{ claim: "C1", verdict: "agree", text: "süre belirtildi", evidence: "R1 worker.ts:42" }] });

  // Döngü sınırı: 2. turdan sonra savunma yok, kaptan karar yazar
  assert.equal(g2.data.next.action, "WAIT");
  assert.deepEqual(crossStage(db), { phase: "consensus" });
  const cons = await next(claude);
  assert.equal(cons.action, "CONSENSUS");
  assert.deepEqual(cons.claims.map((c) => [c.id, c.status]), [["C1", "contested"], ["C2", "agreed"], ["C3", "agreed"], ["C4", "withdrawn"]]);
  assert.equal(cons.claims[0].assessments.at(-1).reply_to, "R1");
  assert.equal((await next(codex)).action, "WAIT");

  assert.match((await codex.call("post_consensus", { decisions: [{ kind: "accepted", claim: "C2", text: "x" }] })).data, /kaptan/i);
  assert.match((await claude.call("post_consensus", { decisions: [{ kind: "accepted", claim: "C2", text: "x" }] })).data, /C1, C3, C4/);
  assert.match((await claude.call("post_consensus", { decisions: [
    { kind: "unresolved", claim: "C1", text: "x", refs: ["A99"] }, { kind: "accepted", claim: "C2", text: "x" },
    { kind: "accepted", claim: "C3", text: "x" }, { kind: "rejected", claim: "C4", text: "x" }] })).data, /A99/);
  const dec = await claude.call("post_consensus", { decisions: [
    { kind: "unresolved", claim: "C1", text: "yeniden teslim süresi SLA'ya uyuyor mu: codex hayır, gemini evet", refs: ["A1", "A4", "R1", "A9", "A10"] },
    { kind: "accepted", claim: "C2", text: "müşteri başına sıra", refs: ["A2", "A5"] },
    { kind: "accepted", claim: "C3", text: "Kafka ölçeklenir ama 500/s için gereksiz", refs: ["A6", "A7"] },
    { kind: "rejected", claim: "C4", text: "sahibi geri çekti; LISTEN/NOTIFY benimsendi", refs: ["A8", "R2"] },
    { kind: "missing_evidence", claim: "C1", text: "tüketici çökmesinde ölçülmüş yeniden teslim süresi" },
    { kind: "verification", text: "yük testi: 500 iş/s, tüketici öldürülünce p99 yeniden teslim < 5 sn" },
  ] });
  assert.deepEqual(dec.data.ids, ["D1", "D2", "D3", "D4", "D5", "D6"]);
  // Aşama 5'e geçiş: plan kararları taşır
  const plan = dec.data.next;
  assert.equal(plan.action, "PLAN");
  assert.deepEqual(plan.consensus.map((d) => [d.id, d.kind, d.claim ?? null]),
    [["D1", "unresolved", "C1"], ["D2", "accepted", "C2"], ["D3", "accepted", "C3"], ["D4", "rejected", "C4"], ["D5", "missing_evidence", "C1"], ["D6", "verification", null]]);
  assert.ok((await claude.call("post_consensus", { decisions: [{ kind: "accepted", claim: "C2", text: "x" }] })).err, "karar bir kez yazılır");
  const posted = await claude.call("post_tasks", { tasks: [
    { title: "yük testi", assignee: "codex", touches: ["bench/"], acceptance: ["p99 < 5 sn"] },
    { title: "LISTEN/NOTIFY", assignee: "gemini", touches: ["worker/"] },
  ] });
  assert.ok(!posted.err);
  assert.equal((await next(codex)).kind, "plan", "plan ortak onayına gider");

  // Kayıt: her mesaj hangi iddiaya/itiraza cevap verdiğini taşır, tüm geçmiş dışa aktarılır
  const rec = discussion(db);
  const c1 = rec.claims.find((c) => c.id === "C1");
  assert.deepEqual(c1.rebuttals.map((r) => [r.id, r.action, r.reply_to]), [["R1", "defend", ["A1", "A4"]]]);
  assert.deepEqual(c1.assessments.map((x) => [x.id, x.by, x.round, x.verdict, x.reply_to ?? null]),
    [["A1", "codex", 1, "disagree", null], ["A4", "gemini", 1, "unsure", null], ["A9", "codex", 2, "disagree", "R1"], ["A10", "gemini", 2, "agree", "R1"]]);
  assert.equal(rec.decisions.length, 6);
  assert.ok(rec.deliveries.some((d) => d.recipient === "claude" && d.item === "A1"), "itiraz sahibine teslim edildi");
  assert.ok(rec.deliveries.some((d) => d.recipient === "codex" && d.item === "R1"), "savunma itiraz edene teslim edildi");
  const { talkMarkdown } = (await import("node:module")).createRequire(import.meta.url)("../app/talkmd.js");
  const md = talkMarkdown(rec, { title: "T", labels: {} });
  assert.match(md, /- \*\*R1\*\* claude · round 1 · defend → A1, A4: /);
  assert.match(md, /- \*\*D1\*\* unresolved C1: .*\[A1, A4, R1, A9, A10\]/);
  await done();
}

// Gerçek ayrılık yoksa savunma turu açılmaz; iddiasını düzelten ajanın iddiasına tüm ortaklar yeniden hükmeder.
{
  const { db, a, done } = await team();
  const { claude, codex, gemini } = a;
  for (const x of TEAM) await next(a[x]);
  await claude.call("post_note", { text: "c", claims: [{ text: "c1", evidence: "e" }] });
  await codex.call("post_note", { text: "k", claims: [{ text: "k1", evidence: "e" }] });
  await gemini.call("post_note", { text: "g", claims: [{ text: "g1", evidence: "e" }] });
  for (const x of TEAM) {
    const n = await next(a[x]);
    await a[x].call("assess", { items: n.claims.map((c) => ({ claim: c.id, verdict: "agree", text: "ok", evidence: "e" })) });
  }
  assert.deepEqual(crossStage(db), { phase: "consensus" }, "itiraz yoksa tek tur");
  assert.equal((await next(claude)).action, "CONSENSUS");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM rebuttals").get().n, 0);
  await done();
}
{
  const { db, a, done } = await team();
  const { claude, codex, gemini } = a;
  for (const x of TEAM) await next(a[x]);
  await claude.call("post_note", { text: "c", claims: [{ text: "c1", evidence: "e" }] });
  await codex.call("post_note", { text: "k", claims: [{ text: "k1", evidence: "e" }] });
  await gemini.call("post_note", { text: "g", claims: [{ text: "g1", evidence: "e" }] });
  for (const x of TEAM) {
    const n = await next(a[x]);
    await a[x].call("assess", { items: n.claims.map((c) => ({ claim: c.id, verdict: c.id === "C1" && x === "codex" ? "disagree" : "agree", text: "t", evidence: "e" })) });
  }
  const s1 = signature(nextAction(db, "claude"));
  const unseen = await claude.call("rebut", { items: [{ claim: "C1", action: "revise", text: "haklısın", revised: "c1 düzeltilmiş" }] });
  assert.match(unseen.data, /teslim edilmedi: A3/, "itirazı görmeden savunma yazılmaz");
  assert.equal((await next(claude)).action, "REBUTTAL");
  assert.ok(!(await claude.call("rebut", { items: [{ claim: "C1", action: "revise", text: "haklısın", revised: "c1 düzeltilmiş" }] })).err);
  assert.notEqual(signature(nextAction(db, "claude")), s1);
  // Düzeltilen iddiaya katılmış olan gemini de yeniden hükmeder
  const g = await next(gemini);
  assert.equal(g.action, "CROSS_REVIEW");
  assert.deepEqual(g.claims.map((c) => [c.id, c.text, c.rebuttal.action]), [["C1", "c1 düzeltilmiş", "revise"]]);
  assert.equal((await next(codex)).action, "CROSS_REVIEW");
  const c1 = discussion(db).claims[0];
  assert.equal(c1.text, "c1 düzeltilmiş"); assert.equal(c1.original, "c1");
  await done();
}

// joint ve solo kiplerinde claims kabul edilmez (mevcut akış değişmez)
{
  const { db, a, done } = await team();
  setMeta(db, "kickoff", "joint");
  await next(a.claude);
  assert.match((await a.claude.call("post_note", { text: "x", claims: [{ text: "y" }] })).data, /claims yalnız/);
  assert.ok(!(await a.claude.call("post_note", { text: "x" })).err);
  await done();
}

console.log("CROSS OK");
