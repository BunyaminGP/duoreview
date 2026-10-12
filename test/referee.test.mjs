// Hakemi sahte saat ve sahte terminalle test eder (model kotası harcamaz).
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { openDb } from "../dist/db.js";
import { setMeta, run, logEvent } from "../dist/flow.js";

const { createReferee } = createRequire(import.meta.url)("../app/referee.js");

const dir = mkdtempSync(join(tmpdir(), "ref-"));
const db = openDb(dir);
setMeta(db, "captain", "claude");
setMeta(db, "review_mode", "after_all");

let t = 1_000_000;
const sent = [];
const ref = await createReferee({
  distDir: resolve("dist"), getDb: () => db, now: () => t,
  write: (agent, text) => sent.push([agent, text]),
});
const advance = (ms) => { t += ms; };
const take = () => sent.splice(0);

ref.start("claude"); ref.start("codex");
ref.queueInitial("claude", "KAPTAN\nprotokol");
ref.queueInitial("codex", "ISCI protokol");

// Açılışta henüz sessizlik süresi dolmadı → hiçbir şey yazılmaz
ref.tick();
assert.deepEqual(take(), []);

// Claude hâlâ çıktı üretiyor (meşgul) → yazılmaz. Codex'te güven sorusu var → yazılmaz.
advance(6000);
ref.noteOutput("claude", "working...");
ref.noteOutput("codex", "\x1b[1mDo you trust the files in this folder?\x1b[0m\n1. Yes, continue");
advance(1000);
ref.tick();
assert.deepEqual(take(), [], "meşgul/onay beklerken yazılmamalı");
assert.equal(ref.statuses().codex.status, "busy");

// Sessizlik: Claude'a protokol (satır sonları temizlenmiş) gider, Codex hâlâ onay bekliyor
advance(6000);
ref.tick();
assert.deepEqual(take(), [["claude", "KAPTAN protokol"]]);
assert.equal(ref.statuses().codex.status, "approval");

// Kullanıcı Codex'te soruyu cevaplar → ekran değişir → sonra sessizlik → protokol gider
ref.noteInput("codex");                        // kullanıcı cevap yazdı
ref.noteOutput("codex", "\nTrusted. How can I help?");
ref.noteOutput("claude", "planlıyor...");       // kaptan plan çıkarırken meşgul
advance(6000);
ref.noteOutput("claude", "planlıyor...");
ref.tick();
assert.deepEqual(take(), [["codex", "ISCI protokol"]]);

// Kaptan planı yazar: codex'e atanmış iş var → codex'e "sıra sende" dürtmesi
const post = (title, assignee) => run(db, "INSERT INTO tasks(title, assignee) VALUES (?,?)", title, assignee);
post("a", "claude"); post("b", "codex");
advance(6000);
ref.tick();
const nudges = take();
assert.equal(nudges.length, 2);
assert.match(nudges[0][1], /Sıra sende: CLAIM #1/);
assert.match(nudges[1][1], /Sıra sende: CLAIM #2/);

// Aynı durum için 90 sn dolmadan tekrar dürtme yok; dolunca tekrar var, 3'ten sonra durur
advance(30_000); ref.tick(); assert.deepEqual(take(), []);
for (let i = 0; i < 2; i++) { advance(100_000); ref.tick(); assert.equal(take().length, 2, `tekrar ${i + 1}`); }
advance(100_000); ref.tick();
assert.deepEqual(take(), [], "en fazla 3 dürtme");

// claude işi alıp gönderir; codex da öyle → REVIEW durumunda ortak dürtülür
run(db, "UPDATE tasks SET status='REVIEW', owner='claude' WHERE id=1");
run(db, "UPDATE tasks SET status='REVIEW', owner='codex' WHERE id=2");
advance(6000); ref.tick();
const rev = take();
assert.equal(rev.length, 2);
assert.match(rev[0][1], /REVIEW #2/);   // claude codex'in işini inceler
assert.match(rev[1][1], /REVIEW #1/);

// send_prompt: ortağın terminaline teslim edilir ve okundu işaretlenir
run(db, "INSERT INTO messages(sender, recipient, kind, text) VALUES ('claude','codex','prompt',?)", "App.js hook'unu kontrol et");
advance(6000); ref.tick();
const pr = take();
assert.deepEqual(pr, [["codex", "[claude ajanından prompt] App.js hook'unu kontrol et"]]);
advance(6000); ref.tick();
assert.ok(!take().some(([, x]) => x.includes("prompt]")), "prompt ikinci kez teslim edilmemeli");

// Çıkan ajan durdurulursa artık yazılmaz
ref.stop("codex");
advance(200_000); ref.tick();
assert.ok(take().every(([a]) => a !== "codex"));

const ev = db.prepare("SELECT text FROM events WHERE actor='app'").all();
assert.ok(ev.length >= 6);
console.log("REFEREE OK (", ev.length, "olay )");
// Gecikmeli teslim bitmeden mesaj okunmuş sayılmaz ve ikinci kez gönderilmez.
{
  let complete;
  let writes = 0;
  const delayed = await createReferee({
    distDir: resolve("dist"), getDb: () => db, now: () => t,
    write: () => { writes++; return new Promise((resolve) => { complete = resolve; }); },
  });
  const id = Number(run(db, "INSERT INTO messages(sender,recipient,kind,text) VALUES ('claude','codex','prompt','teslim')").lastInsertRowid);
  const read = () => db.prepare("SELECT read FROM messages WHERE id=?").get(id).read;
  delayed.start("codex"); advance(6000); delayed.tick();
  assert.equal(read(), 0);
  advance(10000); delayed.tick();
  assert.equal(writes, 1);
  complete(false); await Promise.resolve();
  assert.equal(read(), 0, "başarısız teslim yeniden denenebilir");
  advance(6000); delayed.tick();
  assert.equal(writes, 2);
  complete(true); await Promise.resolve();
  assert.equal(read(), 1);

  delayed.queueInitial("codex", "başlangıç");
  advance(6000); delayed.tick();
  complete(false); await Promise.resolve();
  advance(6000); delayed.tick();
  assert.equal(writes, 4, "başarısız başlangıç mesajı kaybolmaz");
  complete(true); await Promise.resolve();

  const stoppedId = Number(run(db, "INSERT INTO messages(sender,recipient,kind,text) VALUES ('claude','codex','prompt','durdu')").lastInsertRowid);
  advance(6000); delayed.tick(); delayed.stop("codex");
  complete(true); await Promise.resolve();
  assert.equal(db.prepare("SELECT read FROM messages WHERE id=?").get(stoppedId).read, 0, "eski oturum teslimi yeni oturuma yazılmaz");
}
db.close(); rmSync(dir, { recursive: true, force: true });

// --- Kota koruması: kota doluysa ajana hiçbir şey yazılmaz, dolunca yenilenince sürer ---
{
  const dir2 = mkdtempSync(join(tmpdir(), "ref2-"));
  const db2 = openDb(dir2);
  setMeta(db2, "captain", "claude");
  run(db2, "INSERT INTO tasks(title, assignee) VALUES ('a','claude')");
  let full = true; const out = []; let t2 = 5_000_000;
  const ref2 = await createReferee({
    distDir: resolve("dist"), getDb: () => db2, now: () => t2,
    write: (a, x) => out.push([a, x]),
    blocked: (a) => (a === "claude" && full ? "5 saatlik kota %97" : null),
  });
  ref2.start("claude"); t2 += 10_000;
  ref2.tick();
  assert.deepEqual(out, [], "kota doluyken dürtme yok");
  assert.equal(ref2.statuses().claude.status, "quota");
  assert.match(ref2.statuses().claude.why, /%97/);
  full = false; t2 += 10_000;
  ref2.tick();
  assert.equal(out.length, 1, "kota yenilenince dürtme sürer");
  const evs = db2.prepare("SELECT text FROM events").all().map((e) => e.text).join(" | ");
  assert.match(evs, /kota yenilenene kadar/); assert.match(evs, /kota yenilendi/);
  console.log("KOTA KORUMASI OK");
  db2.close(); rmSync(dir2, { recursive: true, force: true });
}

// --- Codex açılış menüleri onay sorusudur: Enter "Update now" ya da "Trust and continue" seçerdi ---
{
  const dir3 = mkdtempSync(join(tmpdir(), "ref3-"));
  const db3 = openDb(dir3);
  setMeta(db3, "captain", "claude");
  const out = []; let t3 = 9_000_000;
  const ref3 = await createReferee({ distDir: resolve("dist"), getDb: () => db3, now: () => t3, write: (a, x) => out.push([a, x]) });
  // Gerçek Codex 0.162 ekranlarından (ANSI silinince boşlukların bir kısmı kaybolur)
  const screens = [
    "Updat available · 0.162.0 → 0.162.1Release notes: https://github.com/openai/codex/releases/latest› 1. Update now (runs `npm install -g @openai/codex`) 2.Skip3.Skipuntilnextversionenter continue · esc skip",
    "Folder accessC:\\proje Trustthisfolder?Codexcanread,edit,andrunfileshere. › 1. Trust and continue 2.Quitenter continue · esc quit",
    "❯ 1. Yes  2. No, and tell Claude what to do differently",
  ];
  for (const screen of screens) {
    ref3.start("codex"); ref3.queueInitial("codex", "protokol");
    ref3.noteOutput("codex", screen);
    t3 += 10_000; ref3.tick();
    assert.equal(ref3.statuses().codex.status, "approval", screen.slice(0, 30));
    assert.equal(ref3.awaitingApproval("codex"), true);
  }
  assert.deepEqual(out, [], "menü açıkken terminale yazılmamalı");
  // Kullanıcı menüyü geçince protokol gider
  ref3.noteInput("codex"); ref3.noteOutput("codex", "›Ask Codex to do anything ? for shortcuts");
  t3 += 10_000; ref3.tick();
  assert.deepEqual(out, [["codex", "protokol"]]);
  // Ajanın kendi araç çağrısındaki "approve" kelimesi onay sorusu değildir
  out.length = 0;
  ref3.noteOutput("codex", '• Called duoreview.review_task({"id":3,"verdict":"approve_with_notes","comment":"ok"})');
  t3 += 10_000; ref3.tick();
  assert.equal(ref3.awaitingApproval("codex"), false);
  assert.notEqual(ref3.statuses().codex.status, "approval");
  console.log("AÇILIŞ MENÜLERİ OK");
  db3.close(); rmSync(dir3, { recursive: true, force: true });
}
