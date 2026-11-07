// Terminale yazma: Enter yankı durulunca gider, yutulursa yinelenir, onay sorusunda basılmaz. Sahte saatle.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { createInjector, SETTLE_MS, CHECK_MS, RETRIES } = createRequire(import.meta.url)("../app/inject.js");

function rig({ alive = true, approval = false } = {}) {
  const r = { t: 0, out: 0, sent: [], timers: [], alive, approval, generation: 1, pending: false };
  r.inject = createInjector({
    write: (_a, data) => { if (!r.alive) return false; r.sent.push(data); return true; },
    lastOutputAt: () => r.out,
    awaitingApproval: () => r.approval,
    generation: () => r.generation,
    inputPending: () => r.pending,
    now: () => r.t,
    later: (fn, ms) => r.timers.push({ at: r.t + ms, fn }),
  });
  /** Saati ilerletir; `echo` verilirse o ana dek terminal çıktı üretmeye devam eder. */
  r.run = (ms, echo = false) => {
    const end = r.t + ms;
    for (;;) {
      r.timers.sort((a, b) => a.at - b.at);
      if (!r.timers.length || r.timers[0].at > end) break;
      const { at, fn } = r.timers.shift();
      r.t = at;
      if (echo) r.out = r.t;
      fn();
    }
    r.t = end;
    if (echo) r.out = r.t;
  };
  r.enters = () => r.sent.filter((x) => x === "\r").length;
  return r;
}

// Uzun metnin yankısı sürerken Enter gönderilmez (Codex bunu satır sonu sayardı)
{
  const r = rig();
  r.inject("codex", "x".repeat(3000));
  r.run(3000, true);
  assert.equal(r.enters(), 0, "yankı sürerken Enter yok");
  r.run(SETTLE_MS + 100);
  assert.equal(r.enters(), 1, "yankı durulunca Enter");
  // Ajan çalışmaya başladı (sürekli çıktı) → yineleme yok
  r.run(CHECK_MS * 4, true);
  assert.equal(r.enters(), 1);
  assert.equal(r.sent[0].length, 3000);
}

// Sessiz kalan ajan için kanıtsız Enter tekrarı yapılmaz.
{
  const r = rig();
  r.inject("codex", "kısa");
  r.run(60_000);
  assert.equal(r.enters(), 1, "sessizlik ikinci Enter için kanıt değildir");
}

// Ekranda onay sorusu varken metin ve ilk Enter bile gönderilmez.
{
  const r = rig({ approval: true });
  const delivered = r.inject("claude", "kısa");
  r.run(60_000);
  assert.equal(r.enters(), 0);
  assert.equal(await delivered, false);
  assert.deepEqual(r.sent, []);
}

// Onay sorusu metin ile gecikmeli Enter arasında da çıkabilir.
{
  const r = rig();
  const delivered = r.inject("codex", "kısa");
  r.approval = true;
  r.run(60_000);
  assert.equal(r.enters(), 0);
  assert.equal(await delivered, false);
}

// Yazım gözlem penceresinde tamamlanır; onay sorusunda tekrar yok.
{
  const r = rig();
  const delivered = r.inject("codex", "kısa");
  r.run(SETTLE_MS + CHECK_MS);
  assert.equal(await delivered, true);
  r.approval = true;
  r.run(60_000);
  assert.equal(r.enters(), 1);
  const dead = rig();
  const lost = dead.inject("codex", "kısa");
  dead.alive = false;
  dead.run(60_000);
  assert.equal(await lost, false);
}

// Yankı hiç durulmasa da sonsuza dek beklenmez; kapanmış terminale yazılmaz
{
  const r = rig();
  r.inject("codex", "x");
  r.run(9000, true);
  assert.equal(r.enters(), 1);
  const dead = rig({ alive: false });
  dead.inject("codex", "x");
  dead.run(60_000);
  assert.deepEqual(dead.sent, []);
}

// İptal ve nesil değişimi, eski timer'ı yeni PTY'den ayırır.
for (const cancel of [false, true]) {
  const r = rig();
  const first = r.inject("codex", "eski");
  assert.equal(r.inject.busy("codex"), true);
  assert.equal(await r.inject("codex", "çakışma"), false);
  if (cancel) r.inject.cancel("codex");
  else r.generation++;
  r.run(60_000);
  assert.equal(await first, false);
  assert.deepEqual(r.sent, ["eski"]);
  assert.equal(r.inject.busy("codex"), false);
  const next = r.inject("codex", "yeni");
  r.run(60_000);
  assert.equal(await next, true);
  assert.deepEqual(r.sent, ["eski", "yeni", "\r"]);
}
{
  const r = rig();
  r.pending = true;
  const done = r.inject("codex", "girişte kaldığı doğrulandı");
  r.run(60_000);
  assert.equal(await done, true);
  assert.equal(r.enters(), 1 + RETRIES);
}
{
  const r = rig();
  r.pending = true;
  const done = r.inject("codex", "iptal");
  r.run(SETTLE_MS);
  r.inject.cancel("codex");
  const replacement = r.inject("codex", "yeni");
  r.pending = false;
  r.run(60_000);
  assert.equal(await done, false);
  assert.equal(await replacement, true);
  assert.deepEqual(r.sent, ["iptal", "\r", "yeni", "\r"]);
}
{
  const r = rig();
  r.pending = true;
  const done = r.inject("codex", "mesaj");
  r.run(SETTLE_MS);
  r.approval = true;
  r.run(60_000);
  assert.equal(await done, true);
  assert.equal(r.enters(), 1, "giriş bekliyor sinyali olsa bile onay ekranında tekrar yok");
}
{
  const r = rig();
  const first = r.inject("codex", "codex");
  const other = r.inject("claude", "claude");
  r.inject.cancel("codex");
  r.run(60_000);
  assert.equal(await first, false);
  assert.equal(await other, true, "bir ajanın iptali diğerini durdurmaz");
  assert.equal(r.enters(), 1);
}
console.log("INJECT OK");
