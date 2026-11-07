// Ajan yaşam döngüsü ve kullanıcı mesajı hazırlama. Sahte PTY ve sahte saatle; gerçek süreç açmaz.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { createLifecycle, createPasteTracker, prepareMessage, isTerminalReport, createInputGate, MAX_MESSAGE, STOP_TIMEOUT_MS, VERIFY_MS } =
  createRequire(import.meta.url)("../app/lifecycle.js");

function rig() {
  const r = { t: 0, timers: [], spawned: [], data: [], exits: [], killed: [], dead: new Set(), failSpawn: null, nextPid: 100 };
  const fakeTerm = () => {
    const term = { pid: r.nextPid++, killedBySelf: 0, kill() { term.killedBySelf++; } };
    term.onData = (fn) => { term.emit = fn; };
    term.onExit = (fn) => { term.exit = (code) => { r.dead.add(term.pid); fn({ exitCode: code }); }; };
    return term;
  };
  r.life = createLifecycle({
    agents: ["claude", "codex"],
    spawn: (agent, opts) => {
      if (r.failSpawn) throw r.failSpawn;
      const term = fakeTerm();
      r.spawned.push({ agent, opts, term });
      return term;
    },
    killTree: (pid) => r.killed.push(pid),
    alive: (pid) => !!pid && !r.dead.has(pid),
    onData: (agent, data) => r.data.push([agent, data]),
    onExit: (agent, info) => r.exits.push([agent, info]),
    now: () => r.t,
    later: (fn, ms) => { const h = { at: r.t + ms, fn }; r.timers.push(h); return h; },
    clear: (h) => { r.timers = r.timers.filter((x) => x !== h); },
  });
  r.run = (ms) => {
    const end = r.t + ms;
    for (;;) {
      r.timers.sort((a, b) => a.at - b.at);
      if (!r.timers.length || r.timers[0].at > end) break;
      const h = r.timers.shift();
      r.t = h.at;
      h.fn();
    }
    r.t = end;
  };
  r.term = (i = -1) => r.spawned.at(i).term;
  return r;
}

// Durdur → başlat: aynı panelde yeni süreç, yeni nesil
{
  const r = rig();
  assert.deepEqual(r.life.start("claude", { cols: 80 }), { ok: true, gen: 1 });
  assert.equal(r.life.life("claude"), "RUNNING");
  assert.equal(r.life.current("claude"), r.term());
  assert.equal(r.life.stop("claude"), true);
  assert.equal(r.life.life("claude"), "STOPPING");
  assert.equal(r.life.current("claude"), null, "kapanmakta olan sürece yazılmaz");
  assert.deepEqual(r.life.start("claude", {}), { ok: false, error: "lifeStopping" }, "kapanma doğrulanmadan ikinci süreç yok");
  assert.equal(r.spawned.length, 1);
  r.term().exit(1);
  assert.equal(r.life.life("claude"), "STOPPED", "kullanıcı durdurduysa çıkış kodu hata sayılmaz");
  assert.deepEqual(r.exits.at(-1)[1].userStop, true);
  assert.equal(r.timers.length, 0, "zaman aşımı temizlendi");
  assert.deepEqual(r.life.start("claude", {}), { ok: true, gen: 2 });
  assert.equal(r.life.active().join(), "claude");
  assert.equal(r.life.life("codex"), "STOPPED", "diğer ajan etkilenmez");
}

// Çift başlatma tek süreç açar
{
  const r = rig();
  r.life.start("codex", {});
  assert.deepEqual(r.life.start("codex", {}), { ok: false, error: "running" });
  assert.equal(r.spawned.length, 1);
}

// Eski sürecin geç gelen çıktısı ve kapanışı yeni süreci etkilemez
{
  const r = rig();
  r.life.start("claude", {});
  const old = r.term();
  r.life.stop("claude");
  r.run(STOP_TIMEOUT_MS);
  assert.deepEqual(r.killed, [old.pid], "onExit gelmedi: süreç ağacı kapatıldı");
  r.dead.add(old.pid);
  r.run(VERIFY_MS);
  assert.equal(r.life.life("claude"), "STOPPED");
  r.life.start("claude", {});
  const fresh = r.term();
  old.emit("eski çıktı");
  old.exit(0);
  assert.equal(r.life.life("claude"), "RUNNING");
  assert.equal(r.life.current("claude"), fresh);
  assert.equal(r.life.generation("claude"), 2);
  fresh.emit("yeni");
  assert.deepEqual(r.data, [["claude", "yeni"]]);
}

// Süreç ağacı kapatılamazsa FAILED, kapandığı doğrulanana dek yeniden başlatma yok
{
  const r = rig();
  r.life.start("claude", {});
  const stuck = r.term();
  r.life.stop("claude");
  r.run(STOP_TIMEOUT_MS + VERIFY_MS);
  assert.equal(r.life.life("claude"), "FAILED");
  assert.deepEqual(r.life.why("claude"), { key: "lifeStuck" });
  assert.deepEqual(r.life.start("claude", {}), { ok: false, error: "lifeStuck" });
  assert.equal(r.spawned.length, 1);
  assert.ok(r.life.active().includes("claude"), "ayarlar kilitli kalır");
  r.dead.add(stuck.pid);
  assert.equal(r.life.start("claude", {}).ok, true);
  assert.equal(r.spawned.length, 2);
}

// Başlatma hatası FAILED; sonra yeniden denenebilir
{
  const r = rig();
  r.failSpawn = new Error("spawn failed, error code: 2");
  const res = r.life.start("codex", {});
  assert.equal(res.ok, false);
  assert.equal(res.error, r.failSpawn);
  assert.equal(r.life.life("codex"), "FAILED");
  assert.equal(r.life.why("codex").error, r.failSpawn);
  r.failSpawn = null;
  assert.equal(r.life.start("codex", {}).ok, true);
  assert.equal(r.life.why("codex"), "");
}

// Kendiliğinden kapanma: 0 → EXITED, diğer → FAILED + kod
{
  const r = rig();
  r.life.start("claude", { resume: true });
  r.t = 2000;
  r.term().exit(0);
  assert.equal(r.life.life("claude"), "EXITED");
  r.life.start("claude", {});
  r.term().exit(3);
  assert.equal(r.life.life("claude"), "FAILED");
  assert.deepEqual(r.life.why("claude"), { key: "lifeExit", code: 3 });
  const [, info] = r.exits.at(-1);
  assert.equal(info.userStop, false);
  assert.deepEqual(info.opts, {});
  assert.equal(r.exits[0][1].opts.resume, true, "çıkış bilgisi başlatma seçeneklerini taşır (resume yeniden denemesi için)");
  assert.equal(r.life.stop("claude"), false, "çalışmayan ajan durdurulmaz");
}

// Bracketed paste kipi parça parça gelen çıktıdan izlenir
{
  const p = createPasteTracker();
  assert.equal(p.on, false);
  p.feed("abc\x1b[?20");
  assert.equal(p.on, false);
  p.feed("04hdef");
  assert.equal(p.on, true);
  p.feed("x".repeat(100));
  assert.equal(p.on, true);
  p.feed("\x1b[?2004l");
  assert.equal(p.on, false);
  p.feed("\x1b[?1049;2004h\x1b[?25l");
  assert.equal(p.on, true, "birden çok parametreli DECSET");
  p.feed("\x1b[?1049l");
  assert.equal(p.on, true, "başka kip 2004'ü kapatmaz");
  p.reset();
  assert.equal(p.on, false);
}

// Kullanıcı mesajı: veri olarak gider, kontrol karakteri ve sınır açık hatayla reddedilir
{
  const tr = "Çalışma ağacı: ışığı söndür, öğün, ŞĞÜİ 🧪 ✓";
  assert.deepEqual(prepareMessage(tr, { bracketed: false }), { ok: true, data: tr });
  assert.deepEqual(prepareMessage("a\tb", { bracketed: false }), { ok: true, data: "a\tb" }, "tab korunur");
  assert.deepEqual(prepareMessage("bir\r\niki\nüç", { bracketed: true }), { ok: true, data: "\x1b[200~bir\riki\rüç\x1b[201~" });
  assert.deepEqual(prepareMessage("a\n\n", { bracketed: true }), { ok: true, data: "\x1b[200~a\r\r\x1b[201~" }, "sondaki satır sonları da korunur");
  assert.deepEqual(prepareMessage("bir\niki", { bracketed: false }), { ok: false, error: "sendMultiline" });
  assert.deepEqual(prepareMessage("a\n", { bracketed: false }), { ok: false, error: "sendMultiline" }, "satır sonu kesilip tek satır sayılmaz");
  for (const bad of ["x\x1b[201~rm -rf", "\x03", "a\x00b", "a\x7f", "a\x9b2J"])
    assert.deepEqual(prepareMessage(bad, { bracketed: true }), { ok: false, error: "sendControl" }, JSON.stringify(bad));
  assert.deepEqual(prepareMessage("  \n ", { bracketed: true }), { ok: false, error: "sendEmpty" });
  assert.deepEqual(prepareMessage(42, { bracketed: true }), { ok: false, error: "sendEmpty" });
  const long = "ğ".repeat(MAX_MESSAGE);
  assert.equal(prepareMessage(long, { bracketed: true }).data.length, MAX_MESSAGE + 12, "sınırdaki metin kesilmez");
  assert.deepEqual(prepareMessage(long + "x", { bracketed: true }), { ok: false, error: "sendTooLong" });
}

// xterm'in kendi cevapları kullanıcı girdisi sayılmaz; tuşlar, oklar ve bracketed paste sayılır
{
  for (const r of ["\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[12;40R", "\x1b[0n", "\x1b[?2004;1$y", "\x1b[I", "\x1b[O", "\x1b]11;rgb:0f0f/1111/1515\x1b\\", "\x1b[I\x1b[12;1R"])
    assert.equal(isTerminalReport(r), true, JSON.stringify(r));
  for (const u of ["a", "\r", "\x1b[200~metin\x1b[201~", "\x1b[A", "\x1bb", "\x1b", "\x03", "\x16", "\x1b[I merhaba"])
    assert.equal(isTerminalReport(u), false, JSON.stringify(u));
}

// Giriş kapısı: agent:send ve pty:write işleyicilerinin mantığı (main.js bunları yalnız bağlar)
function gateRig({ approval = false, bracketed = true, injectResult = true } = {}) {
  const g = { log: [], holds: [], running: { claude: true, codex: false }, approval, bracketed, injectResult, active: new Set() };
  const term = (agent) => ({ write: (d) => g.log.push(["write", agent, d]) });
  const inject = async (agent, data) => {
    g.log.push(["inject", agent, data]);
    if (g.injectResult instanceof Error) throw g.injectResult;
    return g.injectResult;
  };
  inject.cancel = (agent) => g.log.push(["cancel", agent]);
  inject.busy = (agent) => g.active.has(agent);
  g.gate = createInputGate({
    isAgent: (a) => ["claude", "codex", "gemini"].includes(a),
    current: (a) => (g.running[a] ? term(a) : null),
    inject,
    awaitingApproval: () => g.approval,
    noteInput: (a) => { g.log.push(["note", a]); g.approval = false; }, // gerçek referee.noteInput onay kuyruğunu siler
    bracketed: () => g.bracketed,
    setHold: (a, h) => g.holds.push([a, h]),
  });
  return g;
}
{
  // Otomatik gönderim beklerken kullanıcının yapıştırması onu iptal eder; terminal raporu etmez
  let g = gateRig();
  assert.deepEqual(g.gate.write("claude", "\x1b[200~kullanıcı metni\x1b[201~"), { ok: true });
  assert.deepEqual(g.log.slice(0, 1), [["cancel", "claude"]]);
  g = gateRig();
  g.gate.write("claude", "\x1b[12;40R");
  assert.ok(!g.log.some((x) => x[0] === "cancel"));
  assert.deepEqual(g.log.at(-1), ["write", "claude", "\x1b[12;40R"]);
  g = gateRig();
  g.gate.write("claude", "\x1b[A");
  assert.deepEqual(g.log[0], ["cancel", "claude"], "ok tuşu da kullanıcı girdisidir");
  // Ham girişte sınır aşımı açık hata, yazılmaz; duran ajana yazılmaz
  g = gateRig();
  assert.deepEqual(g.gate.write("claude", "x".repeat(MAX_MESSAGE + 1)), { ok: false, error: "sendTermLong" });
  assert.deepEqual(g.gate.write("codex", "a"), { ok: false, error: "sendNotRunning" });
  assert.deepEqual(g.gate.write("x", "a"), { ok: false, error: "sendNotRunning" });
  assert.equal(g.log.length, 0);
  // Onay sorusu ekrandayken ham terminal yanıtı geçer
  g = gateRig({ approval: true });
  assert.deepEqual(g.gate.write("claude", "1"), { ok: true });
}
{
  // Mesaj: Unicode ve satır sonları aynen, bracketed paste ile; hold gönderim boyunca tutulur ve bırakılır
  let g = gateRig();
  const msg = "Merhaba Codex,\nşu dosyaya bak: ğüşıöç 🧪\n\tson satır";
  assert.deepEqual(await g.gate.send("claude", msg), { ok: true });
  assert.deepEqual(g.log.find((x) => x[0] === "inject"), ["inject", "claude", "\x1b[200~Merhaba Codex,\rşu dosyaya bak: ğüşıöç 🧪\r\tson satır\x1b[201~"]);
  assert.deepEqual(g.holds, [["claude", true], ["claude", false]]);
  // Onay ekranında gönderim açık hatayla reddedilir; onay kuyruğu silinmez, inject çağrılmaz
  g = gateRig({ approval: true });
  assert.deepEqual(await g.gate.send("claude", "evet"), { ok: false, error: "sendBusy" });
  assert.equal(g.approval, true);
  assert.equal(g.log.length, 0);
  assert.deepEqual(g.holds, []);
  // Yanlış ajan, duran süreç, çakışan gönderim, kip kapalı çok satır, kontrol karakteri
  g = gateRig({ bracketed: false });
  assert.deepEqual(await g.gate.send("root", "a"), { ok: false, error: "sendNotRunning" });
  assert.deepEqual(await g.gate.send("codex", "a"), { ok: false, error: "sendNotRunning" });
  assert.deepEqual(await g.gate.send("claude", "bir\niki"), { ok: false, error: "sendMultiline" });
  assert.deepEqual(await g.gate.send("claude", "a\x1b[2J"), { ok: false, error: "sendControl" });
  g.active.add("claude");
  assert.deepEqual(await g.gate.send("claude", "a"), { ok: false, error: "sendBusy" });
  assert.equal(g.log.length, 0);
  assert.deepEqual(g.holds, [], "reddedilen gönderim kilit almaz");
  // Teslim edilemeyen ya da hata veren gönderimde kilit bırakılır
  for (const injectResult of [false, new Error("pty kapandı")]) {
    g = gateRig({ injectResult });
    assert.deepEqual(await g.gate.send("claude", "a"), { ok: false, error: "sendBusy" });
    assert.deepEqual(g.holds, [["claude", true], ["claude", false]]);
  }
}

console.log("lifecycle OK");
