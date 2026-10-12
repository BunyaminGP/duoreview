import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, all, resolveDispute, one } from "../dist/flow.js";

const dir = mkdtempSync(join(tmpdir(), "ab-"));
const serverPath = resolve("dist/server.js");

// Uygulamanın yaptığı gibi rol ve kip veritabanına yazılır
const adminDb = openDb(dir);
setMeta(adminDb, "captain", "claude");
setMeta(adminDb, "review_mode", "after_all");

async function connect(agent) {
  const c = new Client({ name: agent, version: "1" });
  await c.connect(new StdioClientTransport({
    command: "node", args: [serverPath],
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
}
const claude = await connect("claude");
const codex = await connect("codex");
const act = async (a) => (await a.call("next_action")).data.action;

// --- Plan aşaması: kaptan PLAN görür, işçi bekler ---
assert.equal(await act(claude), "PLAN");
assert.equal(await act(codex), "WAIT");
assert.ok((await codex.call("post_tasks", { tasks: [{ title: "x" }] })).err, "işçi görev ekleyememeli");

const t = (title, assignee, touches) => ({ title, assignee, touches });
await claude.call("post_tasks", { tasks: [
  t("hutbe", "claude", ["scripts/", "data/khutbahs.json"]),    // 1
  t("kuran ses", "claude", ["App.js", "hooks/"]),               // 2
  t("kaza hesabı", "codex", ["screens/Kaza.js"]),               // 3
  t("kartlar", "codex", ["App.js"]),                            // 4 → #2 ile çakışır
  t("imsakiye", "codex", ["screens/Imsakiye.js"]),              // 5
  t("deep link", "claude", ["linking/"]),                       // 6
] });

// --- Çalışma aşaması ---
// next_action sıradaki görevi kendisi üstlenir: tarif aynı cevapta gelir, ayrı claim_task gerekmez
const c3 = (await codex.call("next_action")).data;
assert.deepEqual([c3.action, c3.id, c3.touches], ["FINISH_WORK", 3, ["screens/Kaza.js"]]);
assert.ok(!(await claude.call("claim_task", { id: 2 })).err);           // claude App.js'te çalışıyor
const clash = await codex.call("claim_task", { id: 4 });
assert.ok(clash.err && /aynı dosyalara/.test(clash.data), "dosya çakışması engellenmeli");
assert.ok((await codex.call("claim_task", { id: 1 })).err, "başkasına atanan alınamaz");

// submit cevabı sıradaki adımı taşır: #3 bitince #5 üstlenilmiş gelir
const s3 = (await codex.call("submit_task", { id: 3, summary: "tamam", files: ["f.js"] })).data;
assert.deepEqual([s3.next.action, s3.next.id], ["FINISH_WORK", 5]);
// codex'in elinde yalnız çakışan #4 kaldı → bekler (claude bitirmeli)
let w = (await codex.call("submit_task", { id: 5, summary: "tamam", files: ["f.js"] })).data.next;
assert.equal(w.action, "WAIT");
assert.match(w.why, /aynı dosyalara/);

// Claude kendi işlerini bitirir
assert.equal((await claude.call("submit_task", { id: 2, summary: "ses", files: ["App.js"] })).data.next.id, 1);
assert.equal((await claude.call("submit_task", { id: 1, summary: "hutbe", files: ["scripts/x"] })).data.next.id, 6);
// İnceleme aşaması henüz kapalı (#4 TODO, #6 WORKING)
assert.ok((await codex.call("review_task", { id: 1, verdict: "approve", comment: "ok" })).err, "inceleme erken açılmamalı");
await claude.call("submit_task", { id: 6, summary: "link", files: ["linking/a"] });

// Çakışma kalktı → codex #4'ü alır ve bitirir; claude bu sırada bekler
assert.equal(await act(claude), "WAIT");
assert.equal((await codex.call("next_action")).data.id, 4);
await codex.call("submit_task", { id: 4, summary: "kart", files: ["App.js"] });

// --- Çapraz inceleme aşaması ---
assert.equal(await act(claude), "REVIEW");
assert.equal(await act(codex), "REVIEW");
assert.ok((await claude.call("review_task", { id: 2, verdict: "approve", comment: "x" })).err, "kendi işini inceleyemez");
const r3 = (await claude.call("review_task", { id: 3, verdict: "request_changes", severity: "major", comment: "test eksik" })).data;
assert.deepEqual([r3.result, r3.next.action], ["REWORK 1/3", "REVIEW"]);
const rw = (await codex.call("next_action")).data;
assert.equal(rw.action, "REWORK");
assert.equal(rw.fix, "test eksik");
await codex.call("submit_task", { id: 3, summary: "test eklendi" });
for (const id of [1, 2, 6]) await codex.call("review_task", { id, verdict: "approve", comment: "iyi" });
for (const id of [3, 4, 5]) await claude.call("review_task", { id, verdict: "approve", comment: "iyi" });
assert.equal(await act(claude), "ALL_DONE");
assert.equal(await act(codex), "ALL_DONE");

// --- İnceleme politikası: minor bulgu görevi durduramaz ---
await claude.call("post_tasks", { tasks: [7, 8, 9, 10].map((n) => ({ title: "ek" + n, assignee: "codex", touches: ["ek" + n + "/"] })) });
assert.ok(!(await codex.call("claim_task", { id: 7 })).err);
for (const id of [7, 8, 9, 10]) await codex.call("submit_task", { id, summary: "v", files: [] }); // her submit sıradakini üstlenir; inceleme hepsi gönderilince açılır
const noSev = await claude.call("review_task", { id: 7, verdict: "request_changes", comment: "nadir durum" });
assert.ok(noSev.err && /approve_with_notes/.test(noSev.data), "severity olmadan reddedilmeli");
assert.ok((await claude.call("review_task", { id: 7, verdict: "request_changes", severity: "minor", comment: "disk dolu" })).err, "minor görevi durduramaz");
assert.ok(!(await claude.call("review_task", { id: 7, verdict: "approve_with_notes", comment: "disk dolu senaryosu sonraya" })).err);
assert.equal(one(adminDb, "SELECT status FROM tasks WHERE id=7").status, "DONE");

// --- İhtilaf çıkmaz sokak değildir: kullanıcı üç yoldan çözebilir ---
const toDispute = async (id) => {
  for (let i = 0; i < 3; i++) {
    await claude.call("review_task", { id, verdict: "request_changes", severity: "blocker", comment: "tur " + i });
    if (i < 2) await codex.call("submit_task", { id, summary: "v" + i });
  }
  assert.equal(one(adminDb, "SELECT status FROM tasks WHERE id=?", id).status, "DISPUTE");
};
for (const id of [8, 9, 10]) await toDispute(id);
assert.equal(await act(codex), "ALL_DONE", "ihtilaf bekleyen iş doğuran bir durum değil");

assert.ok(resolveDispute(adminDb, 8, "accept", ""));
assert.equal(one(adminDb, "SELECT status FROM tasks WHERE id=8").status, "DONE");

assert.ok(resolveDispute(adminDb, 9, "rework", "sadece X dosyasini duzelt"));
const rw9 = (await codex.call("next_action")).data;
assert.equal(rw9.action, "REWORK");
assert.match(rw9.fix, /KULLANICI KARARI.*sadece X/);
assert.equal(one(adminDb, "SELECT rounds FROM tasks WHERE id=9").rounds, 0, "tur sayaci sifirlanmali");
assert.ok(rw9.spec === undefined || typeof rw9.spec === "string");
await codex.call("submit_task", { id: 9, summary: "duzeltildi" });
await claude.call("review_task", { id: 9, verdict: "approve", comment: "ok" });

assert.ok(resolveDispute(adminDb, 10, "rereview", "son duzeltmelere bak"));
assert.equal((await claude.call("next_action")).data.action, "REVIEW");
assert.ok(!resolveDispute(adminDb, 10, "accept"), "DISPUTE olmayan goreve karar uygulanamaz");
await claude.call("review_task", { id: 10, verdict: "approve", comment: "ok" });
assert.equal(await act(claude), "ALL_DONE");

// --- token tasarrufu: tarif bir oturumda bir kez gelir, cevaplar küçüktür ---
run_(adminDb, 9);
function run_(db, id) { db.prepare("UPDATE tasks SET status='REWORK', owner='codex' WHERE id=?").run(id); }
const first = (await codex.call("next_action")).data, second = (await codex.call("next_action")).data;
assert.equal(second.spec, undefined, "tarif ikinci kez gönderilmemeli");
assert.ok(JSON.stringify(second).length < 400, "next_action cevabı küçük kalmalı");
adminDb.prepare("UPDATE tasks SET status='DONE' WHERE id=9").run();

// --- bağımlılık girişi, status(id), sayaç ---
assert.ok(/99/.test((await claude.call("post_tasks", { tasks: [{ title: "y", depends_on: [99] }] })).data), "olmayan öncül reddedilmeli");
const added = (await claude.call("post_tasks", { tasks: [{ title: "ön", assignee: "codex", description: "tarif" }] })).data;
const dep = (await claude.call("post_tasks", { tasks: [{ title: "bağlı", assignee: "claude", depends_on: added.ids }] })).data;
assert.equal(dep.next.action, "WAIT", "öncül bitmeden bağlı görev başlamaz");
assert.ok((await claude.call("drop_task", { id: added.ids[0] })).err, "öncül silinemez");
const st = (await codex.call("status", { id: added.ids[0] })).data;
assert.deepEqual([st.spec, st.status, st.depends_on], ["tarif", "TODO", []]);
assert.deepEqual((await claude.call("status", { id: dep.ids[0] })).data.depends_on, added.ids);
assert.ok(!(await claude.call("drop_task", { id: dep.ids[0] })).err);
assert.ok(!(await claude.call("drop_task", { id: added.ids[0] })).err);
const calls = one(adminDb, "SELECT value FROM meta WHERE key='calls:codex'").value;
await codex.call("status");
assert.equal(Number(one(adminDb, "SELECT value FROM meta WHERE key='calls:codex'").value), Number(calls) + 1);
assert.ok(Number(one(adminDb, "SELECT value FROM meta WHERE key='chars_out:codex'").value) > 0);

// --- düz bir görev (tartışma ve yeniden çalışma yok) dört araç çağrısıdır: üstlen, gönder, incelemeye uyan, incele ---
const callsOf = () => ["claude", "codex"].reduce((n, a) => n + Number(one(adminDb, "SELECT value FROM meta WHERE key=?", "calls:" + a).value), 0);
const solo = (await claude.call("post_tasks", { tasks: [{ title: "tek", assignee: "codex" }] })).data.ids[0];
const before = callsOf();
assert.equal((await codex.call("next_action")).data.id, solo);
assert.equal((await codex.call("submit_task", { id: solo, summary: "v" })).data.next.action, "WAIT");
assert.equal((await claude.call("next_action")).data.action, "REVIEW");
assert.equal((await claude.call("review_task", { id: solo, verdict: "approve", comment: "ok" })).data.next.action, "ALL_DONE");
assert.equal(callsOf() - before, 4);

// --- send_prompt / not ---
await claude.call("send_prompt", { text: "App.js'teki hook'u kontrol eder misin?" });
const inbox = (await codex.call("read_inbox")).data;
assert.deepEqual(inbox.map((m) => m.sender), ["claude"]);
assert.match(inbox[0].text, /hook/);
assert.deepEqual((await codex.call("read_inbox")).data, []);

// --- olay günlüğü ---
const ev = all(adminDb, "SELECT actor, text FROM events ORDER BY id");
assert.ok(ev.length >= 15 && ev.some((e) => /prompt gönderdi/.test(e.text)));

console.log("E2E OK (", ev.length, "olay )");
await claude.close(); await codex.close();
adminDb.close();
rmSync(dir, { recursive: true, force: true });
