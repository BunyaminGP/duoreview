// Ajanın bağlamına giren metni ölçer: araç tanımları, protokol mesajları ve tipik araç cevapları.
// Kullanım: node test/tokens.mjs        (karakter sayısı; token ≈ karakter / 3 Türkçe-JSON karışımı için kaba tahmin)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { openDb } from "../dist/db.js";
import { setMeta, run } from "../dist/flow.js";

const require = createRequire(import.meta.url);
const { protocol } = require("../app/protocol.js");

const dir = mkdtempSync(join(tmpdir(), "tok-"));
const db = openDb(dir);
setMeta(db, "captain", "claude");
setMeta(db, "review_mode", "after_all");

const DESC = "docs/AJAN_PROMPTLARI.md 'Parça 6'. Kur'an tümünü indir (alquran.cloud, sıralı, küçük gecikme, yeniden deneme, ilerleme, iptal) ve ayet ayet ses takibi: hooks/useQuranAudio.js oluştur, App.js'teki ses API'sini birebir karşılasın, sürekli takip modu, QuranReader çalan ayeti vurgulasın. Türkçe sesli meal EKLEME (lisans).";
const SUM = "Tümünü indir akışı ve useQuranAudio hook'u eklendi; App.js ses bölümü hook'a taşındı; QuranReader çalan ayeti vurgular. Lint 0 hata, node testleri geçti.";
const mk = (i, status, owner) => run(db, "INSERT INTO tasks(title, description, touches, assignee, owner, status, summary, files) VALUES (?,?,?,?,?,?,?,?)",
  `Parça ${i}: örnek görev başlığı`, DESC, JSON.stringify(["App.js", "hooks/", "components/QuranReader.js"]),
  owner, owner, status, SUM, JSON.stringify(["hooks/useQuranAudio.js", "utils/quranCache.js", "components/QuranReader.js"]));

async function connect(agent) {
  const c = new Client({ name: agent, version: "1" });
  await c.connect(new StdioClientTransport({
    command: "node", args: [resolve("dist/server.js")],
    env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: dir },
  }));
  return c;
}
const claude = await connect("claude");
const codex = await connect("codex");
const rows = [];
const size = async (label, c, name, args = {}) => {
  try {
    const r = await c.callTool({ name, arguments: args });
    rows.push([label, r.content[0].text.length]);
  } catch { rows.push([label, "—"]); }
};

// 1) Araç tanımları (her turda bağlamda duran sabit yük)
const tools = (await claude.listTools()).tools;
const schemaChars = JSON.stringify(tools).length;

// 2) Protokol mesajları
const cfg = { captain: "claude", brief: "docs klasöründeki belgeleri oku; yapılacak işleri çıkar ve panoya yaz.", reviewMode: "after_all", projectDir: "C:\\path\\to\\project" };
const proto = {
  "protokol: kaptan": protocol("claude", cfg).length,
  "protokol: işçi": protocol("codex", cfg).length,
  "protokol: devam": protocol("claude", { ...cfg, resume: true }).length,
};

// 3) Tipik cevaplar (her sorgu turunda)
await size("next_action PLAN (kaptan)", claude, "next_action");
await size("next_action WAIT (işçi, plan yok)", codex, "next_action");
for (let i = 1; i <= 6; i++) mk(i, "TODO", i % 2 ? "claude" : "codex");
await size("next_action CLAIM", claude, "next_action");
await size("claim_task", claude, "claim_task", { id: 1 });
await size("next_action FINISH_WORK", claude, "next_action");
await size("submit_task", claude, "submit_task", { id: 1, summary: SUM, files: ["a.js"] });
for (const id of [2, 3, 4, 5, 6]) run(db, "UPDATE tasks SET status='REVIEW', summary=?, files=? WHERE id=?", SUM, JSON.stringify(["hooks/useQuranAudio.js", "utils/quranCache.js"]), id);
await size("next_action REVIEW", codex, "next_action");
await size("review_task (onay)", codex, "review_task", { id: 1, verdict: "approve", comment: "ok" });
run(db, "UPDATE tasks SET status='REWORK', rounds=1 WHERE id=3");
run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment) VALUES (3,'codex','request_changes','hooks/useQuranAudio.js:40 audioStatus iptalde sıfırlanmıyor; yeniden başlatınca eski ayet çalıyor. Düzelt ve testini ekle.')");
await size("next_action REWORK", codex, "next_action");
for (const n of ["list_tasks", "status"]) await size(n, claude, n);
await size("report", claude, "report");
run(db, "UPDATE tasks SET status='DONE'");
await size("next_action ALL_DONE", claude, "next_action");

const sum = (a) => a.reduce((s, [, n]) => s + (typeof n === "number" ? n : 0), 0);
console.log("\n--- sabit yük (her turda bağlamda) ---");
console.log(`araç tanımları: ${tools.length} araç, ${schemaChars} karakter ≈ ${Math.round(schemaChars / 3)} token`);
for (const [k, v] of Object.entries(proto)) console.log(`${k.padEnd(28)} ${String(v).padStart(5)} kr ≈ ${Math.round(v / 3)} token (oturumda 1 kez)`);
console.log("\n--- araç cevapları ---");
for (const [k, v] of rows) console.log(`${k.padEnd(36)} ${String(v).padStart(5)} kr`);
const flowRows = rows.filter(([k]) => /^(next_action|claim_task|submit_task|review_task)/.test(k));
console.log(`\ntipik tek görev döngüsü (next_action x4 + claim + submit + review): ${sum(flowRows)} kr ≈ ${Math.round(sum(flowRows) / 3)} token`);
console.log(`JSON: ${JSON.stringify({ schemaChars, proto, rows: Object.fromEntries(rows), tools: tools.length })}`);

await claude.close(); await codex.close(); db.close();
rmSync(dir, { recursive: true, force: true });
