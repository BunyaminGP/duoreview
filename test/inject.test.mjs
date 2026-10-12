// Terminale yazma: Enter yankı durulunca gider, yutulursa yinelenir, onay sorusunda basılmaz. Sahte saatle.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { createInjector, SETTLE_MS, CHECK_MS, RETRIES } = createRequire(import.meta.url)("../app/inject.js");

function rig({ alive = true, approval = false } = {}) {
  const r = { t: 0, out: 0, sent: [], timers: [], alive, approval };
  r.inject = createInjector({
    write: (_a, data) => { if (!r.alive) return false; r.sent.push(data); return true; },
    lastOutputAt: () => r.out,
    awaitingApproval: () => r.approval,
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

// Enter yutulduysa (ajan sessiz) yinelenir, en çok RETRIES kez
{
  const r = rig();
  r.inject("codex", "kısa");
  r.run(60_000);
  assert.equal(r.enters(), 1 + RETRIES);
}

// Ekranda onay sorusu varken yineleme yapılmaz: Enter soruyu kullanıcı adına cevaplardı
{
  const r = rig({ approval: true });
  r.inject("claude", "kısa");
  r.run(60_000);
  assert.equal(r.enters(), 1);
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

console.log("INJECT OK");
