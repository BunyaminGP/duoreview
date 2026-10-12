// Gerçek MCP senaryoları: çağrı sayısı ve JSON metin uzunluğu. Model token tüketimi değildir.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../dist/db.js";
import { setMeta } from "../dist/flow.js";

const dir = mkdtempSync(join(tmpdir(), "tok-"));
const db = openDb(dir);
setMeta(db, "captain", "claude");
setMeta(db, "review_mode", "after_all");
setMeta(db, "kickoff", "solo");
setMeta(db, "brief", "Görevleri paylaşın ve birbirinizin değişikliklerini inceleyin.");
const clients = {};
const rows = [];
async function call(scenario, agent, name, args = {}) {
  const r = await clients[agent].callTool({ name, arguments: args });
  const text = r.content.map((c) => c.text ?? "").join("");
  assert.ok(!r.isError, agent + "/" + name + ": " + text);
  rows.push({ scenario, agent, name, requestChars: JSON.stringify({ name, arguments: args }).length, responseChars: text.length });
  return JSON.parse(text);
}
const description = "src/cache.ts içinde iptal sonrası bekleyen isteğin durumunu sıfırla; yeni istek eski sonucu kullanmasın. İptal ve yeniden başlatma testi geçmeli.";
const files = ["src/cache.ts", "test/cache.test.ts"];
async function post(scenario) {
  const r = await call(scenario, "claude", "post_tasks", { tasks: [{ title: "İptal durumu", description, touches: files, assignee: "claude" }] });
  assert.equal(r.next.action, "FINISH_WORK");
  assert.equal(r.next.spec, description);
  return r.next.id;
}
async function submit(scenario, id) {
  const r = await call(scenario, "claude", "submit_task", { id, summary: "İptal durumu sıfırlandı; iptal ve yeniden başlatma testleri geçti.", files });
  assert.equal(r.next.action, "WAIT");
  const review = await call(scenario, "codex", "next_action");
  assert.equal(review.action, "REVIEW");
  assert.equal(review.id, id);
}
try {
  for (const agent of ["claude", "codex"]) {
    const c = new Client({ name: agent, version: "1" });
    clients[agent] = c;
    await c.connect(new StdioClientTransport({ command: "node", args: [resolve("dist/server.js")],
      env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: dir } }));
  }
  const tools = (await clients.claude.listTools()).tools;
  const schemaChars = JSON.stringify(tools).length;
  const intro = await call("ilk kurallar", "claude", "next_action");
  assert.equal(intro.action, "PLAN");
  assert.ok(intro.rules);
  assert.equal((await call("ilk kurallar", "codex", "next_action")).action, "WAIT");

  const id = await post("tek görev");
  await submit("tek görev", id);
  assert.equal((await call("tek görev", "codex", "review_task", { id, verdict: "approve", comment: "İptal ve yeniden başlatma akışı doğrulandı." })).next.action, "ALL_DONE");
  assert.equal(rows.filter((r) => r.scenario === "tek görev").length, 4);

  const redo = await post("düzeltme turu");
  await submit("düzeltme turu", redo);
  await call("düzeltme turu", "codex", "review_task", { id: redo, verdict: "request_changes", severity: "major", comment: "src/cache.ts:40 iptalde eski sonuç temizlenmiyor; testi ekle." });
  const rework = await call("düzeltme turu", "claude", "next_action");
  assert.equal(rework.action, "REWORK");
  assert.equal(rework.id, redo);
  assert.match(rework.fix, /cache/);
  await submit("düzeltme turu", redo);
  assert.equal((await call("düzeltme turu", "codex", "review_task", { id: redo, verdict: "approve", comment: "Düzeltme doğrulandı." })).next.action, "ALL_DONE");

  const totals = Object.fromEntries([...new Set(rows.map((r) => r.scenario))].map((scenario) => {
    const selected = rows.filter((r) => r.scenario === scenario);
    return [scenario, { calls: selected.length,
      requestChars: selected.reduce((n, r) => n + r.requestChars, 0),
      responseChars: selected.reduce((n, r) => n + r.responseChars, 0) }];
  }));
  console.log("Araç şeması: " + tools.length + " araç, " + schemaChars + " karakter (senaryo toplamlarına dahil değil).");
  console.table(totals);
  console.log("Tek görev: post_tasks → submit_task → inceleyenin next_action → review_task. İlk kurallar ayrı ölçüldü.");
  console.log("İstekler araç adı/argüman JSON'u, cevaplar MCP metin içeriğidir; taşıma zarfı, model bağlamı ve önbellek dahil değildir.");
  console.log("JSON: " + JSON.stringify({ tools: tools.length, schemaChars, totals, rows }));
} finally {
  await Promise.all(Object.values(clients).map((c) => c.close()));
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
