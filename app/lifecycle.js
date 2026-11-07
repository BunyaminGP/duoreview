// Ajan süreçlerinin yaşam döngüsü ve kullanıcı mesajının terminale hazırlanması. Electron'a bağımlı değildir
// (spawn, süreç ağacı sonlandırma ve saat dışarıdan verilir; testlerde sahteleri kullanılır).
// Her başlatma yeni bir nesildir: eski sürecin geç gelen çıktısı ya da kapanışı yeni kaydı değiştiremez.
const STOP_TIMEOUT_MS = 3000; // kill sonrası onExit bu kadar gelmezse süreç ağacı zorla kapatılır
const VERIFY_MS = 1500;       // zorla kapatmadan sonra sürecin gerçekten bittiğine bakılır

function createLifecycle({ agents, spawn, killTree, alive, onData, onExit, onChange = () => {}, now = Date.now, later = setTimeout, clear = clearTimeout }) {
  const rec = Object.fromEntries(agents.map((a) => [a, { gen: 0, term: null, pid: 0, opts: null, life: "STOPPED", why: "", userStop: false, startedAt: 0, timer: null }]));
  const set = (r, life, why = "") => { r.life = life; r.why = why; };

  function finish(agent, r, exitCode) {
    if (r.timer) { clear(r.timer); r.timer = null; }
    const info = { exitCode, userStop: r.userStop, startedAt: r.startedAt, gen: r.gen, opts: r.opts };
    r.term = null; r.pid = 0;
    if (r.userStop) set(r, "STOPPED");
    else if (exitCode === 0) set(r, "EXITED");
    else set(r, "FAILED", { key: "lifeExit", code: exitCode });
    onExit(agent, info);
    onChange(agent);
  }

  return {
    /** Yeni süreç açar. Çalışan, kapanmakta olan ya da kapatılamamış süreç varken açmaz. */
    start(agent, opts) {
      const r = rec[agent];
      if (r.life === "RUNNING" || r.life === "STOPPING") return { ok: false, error: r.life === "STOPPING" ? "lifeStopping" : "running" };
      if (r.term) {
        if (alive(r.pid)) return { ok: false, error: "lifeStuck" };
        r.term = null; r.pid = 0; // kapandığı sonradan doğrulandı
      }
      const gen = ++r.gen;
      let term;
      try { term = spawn(agent, opts); } catch (e) {
        set(r, "FAILED", { error: e });
        onChange(agent);
        return { ok: false, error: e };
      }
      Object.assign(r, { term, pid: term.pid, opts, userStop: false, startedAt: now() });
      set(r, "RUNNING");
      term.onData((data) => { if (r.gen === gen) onData(agent, data); });
      term.onExit(({ exitCode }) => { if (r.gen === gen && r.term === term) finish(agent, r, exitCode); });
      onChange(agent);
      return { ok: true, gen };
    },

    /** Kullanıcı durdurdu. onExit gelmezse süreç ağacı kapatılır; o da olmazsa yeniden başlatma engellenir. */
    stop(agent) {
      const r = rec[agent];
      if (r.life !== "RUNNING") return false;
      const { term, gen } = r;
      r.userStop = true;
      set(r, "STOPPING");
      onChange(agent);
      try { term.kill(); } catch {}
      r.timer = later(() => {
        if (r.gen !== gen || r.term !== term) return;
        try { killTree(r.pid); } catch {}
        r.timer = later(() => {
          if (r.gen !== gen || r.term !== term) return;
          r.timer = null;
          if (!alive(r.pid)) { finish(agent, r, null); return; }
          set(r, "FAILED", { key: "lifeStuck" }); // term kalır: start, süreç gerçekten bitene dek reddeder
          onChange(agent);
        }, VERIFY_MS);
      }, STOP_TIMEOUT_MS);
      return true;
    },

    /** Yazılabilir süreç (yalnız RUNNING). */
    current(agent) { return rec[agent].life === "RUNNING" ? rec[agent].term : null; },
    generation(agent) { return rec[agent].gen; },
    life(agent) { return rec[agent].life; },
    why(agent) { return rec[agent].why; },
    /** Çalışan ya da kapanmakta olan ajanlar (ayarlar bu sırada kilitli kalır). */
    active() { return agents.filter((a) => rec[a].life === "RUNNING" || rec[a].life === "STOPPING" || rec[a].term); },
    killAll() { for (const a of agents) try { rec[a].term?.kill(); } catch {} },
  };
}

// ---- kullanıcı mesajı ---------------------------------------------------------
// Ajanın çok satırlı yapıştırmayı (bracketed paste, DECSET 2004) açıp açmadığını çıktıdan izler.
// Kaçış dizisi iki parçaya bölünmüş gelebilir; önceki parçanın sonu saklanır.
const MODE_RE = /\x1b\[\?([\d;]*)([hl])/g;
function createPasteTracker() {
  let tail = "", on = false;
  return {
    feed(chunk) {
      const buf = tail + chunk;
      for (const m of buf.matchAll(MODE_RE)) if (m[1].split(";").includes("2004")) on = m[2] === "h";
      tail = buf.slice(-24);
    },
    reset() { tail = ""; on = false; },
    get on() { return on; },
  };
}

const MAX_MESSAGE = 100_000; // UTF-16 kod birimi
// \t, \n, \r dışındaki C0, DEL ve C1: mesaj veri olarak kalsın, terminal komutu ya da paste'ten kaçış olmasın.
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/;

/** Kullanıcının mesajını terminale yazılacak veriye çevirir. Hata anahtarları i18n anahtarıdır. */
function prepareMessage(text, { bracketed }) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "sendEmpty" };
  if (text.length > MAX_MESSAGE) return { ok: false, error: "sendTooLong" };
  if (CONTROL_RE.test(text)) return { ok: false, error: "sendControl" };
  const body = text.replace(/\r\n|\n|\r/g, "\r");
  if (!bracketed && body.includes("\r")) return { ok: false, error: "sendMultiline" };
  return { ok: true, data: bracketed ? `\x1b[200~${body}\x1b[201~` : body };
}

// xterm'in kendiliğinden ürettiği cevaplar: aygıt özniteliği (c), imleç konumu (R), durum (n), kip sorgusu ($y), odak (I/O), OSC.
// Bunlar dışındaki her şey (tuşlar, oklar, bracketed paste) kullanıcı girdisidir.
const REPORT_RE = /^(?:\x1b\[[?>=]?[\d;]*[cRn]|\x1b\[\??[\d;]*\$y|\x1b\[[IO]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/;
const isTerminalReport = (data) => REPORT_RE.test(data);

/** Terminale giden kullanıcı girdisinin kapısı: ham tuşlar (write) ve mesaj alanı (send). Hata anahtarları i18n anahtarıdır. */
function createInputGate({ isAgent, current, inject, awaitingApproval, noteInput, bracketed, setHold }) {
  return {
    write(agent, data) {
      if (!isAgent(agent) || typeof data !== "string") return { ok: false, error: "sendNotRunning" };
      if (data.length > MAX_MESSAGE) return { ok: false, error: "sendTermLong" };
      const term = current(agent);
      if (!term) return { ok: false, error: "sendNotRunning" };
      // Kullanıcı yazdıysa bekleyen otomatik metin ve Enter'ı iptal edilir: ikisi birleşip gönderilmesin
      if (!isTerminalReport(data)) inject.cancel(agent);
      noteInput(agent);
      term.write(data);
      return { ok: true };
    },
    async send(agent, text) {
      if (!isAgent(agent) || !current(agent)) return { ok: false, error: "sendNotRunning" };
      // Ekranda onay sorusu varsa mesajın Enter'ı onu cevaplar: kullanıcı onayı terminalden verir
      if (inject.busy(agent) || awaitingApproval(agent)) return { ok: false, error: "sendBusy" };
      const m = prepareMessage(text, { bracketed: bracketed(agent) });
      if (!m.ok) return m;
      setHold(agent, true);
      try {
        noteInput(agent);
        return (await inject(agent, m.data)) ? { ok: true } : { ok: false, error: "sendBusy" };
      } catch {
        return { ok: false, error: "sendBusy" };
      } finally {
        setHold(agent, false);
      }
    },
  };
}

module.exports = { createLifecycle, createPasteTracker, prepareMessage, isTerminalReport, createInputGate, MAX_MESSAGE, STOP_TIMEOUT_MS, VERIFY_MS };
