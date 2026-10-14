// Hakem: ajanlar boşa çıkınca (ve ekranda onay sorusu yokken) terminallerine yazı gönderir.
//  1) ilk protokol mesajı  2) ortağın send_prompt'u  3) "sıra sende" dürtmesi
// Electron'a bağımlı değildir; write/getDb dışarıdan verilir (testlerde sahte verilir).
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { t } = require("./i18n");

const AGENTS = ["claude", "codex", "gemini"];
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g;
// Ekranın sonunda bir onay/güven sorusu varsa Enter'a basmak onu kullanıcı adına onaylamak olur.
// Çıplak "approve" aranmaz: ajanın kendi review_task(verdict: "approve") çağrısı ekranda görünür ve ajan boşta sanılmazdı.
// Codex açılış menüleri de (güncelleme, klasöre güven) böyledir. İmleç hareketleri silindiği için boşluklar kaybolabilir: \s* kullan.
const APPROVAL = new RegExp([
  "\\(y\\/n\\)|\\[y\\/n\\]|do you want to|do you trust|would you like to|allow (this|once|codex|claude)",
  "press enter to (confirm|continue)|1\\.\\s*yes|yes, and|trust the files|approve\\?|approval (required|needed)",
  "update\\s*now|trust\\s*this\\s*folder|trust\\s*and\\s*continue|enter\\s*continue",
  "[›❯]\\s*1\\.\\s*\\S", // seçim imleci numaralı bir seçenekte duruyor
].join("|"), "i");
// Hakemin yazdığı metin terminalde yankılanır. İçinde onay kalıbı geçerse (ör. ortağın mesajında "do you want to")
// inject kendi yankısını onay sorusu sanar, Enter'a basmaz ve mesaj sonsuza dek yeniden denenir. Eşleşme "_" ile bozulur.
function defuse(text) {
  for (let m; (m = APPROVAL.exec(text));) text = text.slice(0, m.index + 1) + "_" + text.slice(m.index + 1);
  return text;
}
const COOLDOWN_MS = 90_000;
const MAX_SAME_NUDGES = 3;

async function createReferee({ distDir, getDb, write, blocked = () => null, now = Date.now, idleMs = 5000, minStartMs = 4000 }) {
  const flow = await import(pathToFileURL(path.join(distDir, "flow.js")).href);
  const st = Object.fromEntries(AGENTS.map((a) => [a, fresh()]));

  function fresh() {
    return { running: false, sending: false, startedAt: 0, lastOutput: 0, tail: "", initial: null, nudge: { sig: "", at: 0, count: 0 }, status: "off", flow: "", why: "", quotaLogged: false };
  }

  const api = {
    start(agent) { st[agent] = { ...fresh(), running: true, startedAt: now(), lastOutput: now() }; },
    stop(agent) { st[agent] = fresh(); },
    queueInitial(agent, text) { st[agent].initial = text; },
    noteOutput(agent, data) {
      const s = st[agent];
      s.lastOutput = now();
      s.tail = (s.tail + data.replace(ANSI, "")).slice(-700);
    },
    // Kullanıcı terminale bir şey yazdıysa (ör. onay sorusunu cevapladıysa) eski ekran metni geçersizdir.
    noteInput(agent) { st[agent].tail = ""; },
    awaitingApproval(agent) { return APPROVAL.test(st[agent].tail); },
    statuses() {
      return Object.fromEntries(AGENTS.map((a) => [a, { status: st[a].status, flow: st[a].flow, why: st[a].why }]));
    },
    tick() {
      const db = getDb();
      if (!db) return;
      for (const agent of AGENTS) {
        const s = st[agent];
        if (!s.running) { s.status = "off"; continue; }
        if (s.sending) { s.status = "busy"; continue; }
        const quiet = now() - s.lastOutput >= idleMs && now() - s.startedAt >= minStartMs;
        s.status = !quiet ? "busy" : APPROVAL.test(s.tail) ? "approval" : "idle";

        let na = null;
        try { na = flow.nextAction(db, agent); s.flow = na.action; } catch { s.flow = ""; }
        if (s.status !== "idle") continue;

        // Kota doluysa ajana hiçbir şey yazma: yeni tur = boşa giden token. Pencere yenilenince kendiliğinden sürer.
        const why = blocked(agent);
        if (why) {
          s.status = "quota"; s.why = why;
          if (!s.quotaLogged) { s.quotaLogged = true; flow.logEvent(db, "app", t("evQuotaStopped", { agent, why })); }
          continue;
        }
        if (s.quotaLogged) { s.quotaLogged = false; s.why = ""; flow.logEvent(db, "app", t("evQuotaRenewed", { agent })); }

        const say = (text, why, delivered = () => {}) => {
          s.sending = true;
          s.lastOutput = now();
          s.status = "busy";
          const finish = (ok) => {
            s.sending = false;
            if (ok === false || st[agent] !== s || getDb() !== db) return;
            delivered();
            flow.logEvent(db, "app", `${agent}: ${why}`);
          };
          try {
            const result = write(agent, defuse(text.replace(/\s*\n\s*/g, " ")));
            if (result?.then) result.then(finish, () => finish(false));
            else finish(result);
          } catch { finish(false); }
        };

        if (s.initial) { const txt = s.initial; say(txt, t("evProtocolSent"), () => { if (s.initial === txt) s.initial = null; }); continue; }

        const msg = db.prepare("SELECT id, sender, text FROM messages WHERE recipient=? AND kind='prompt' AND read=0 ORDER BY id LIMIT 1").get(agent);
        if (msg) {
          say(t("promptFrom", { sender: msg.sender, text: msg.text }), t("evPromptDelivered", { sender: msg.sender }),
            () => db.prepare("UPDATE messages SET read=1 WHERE id=?").run(msg.id));
          continue;
        }

        if (!na || na.action === "WAIT" || na.action === "ALL_DONE") { s.nudge = { sig: "", at: 0, count: 0 }; continue; }
        const sig = flow.signature(na);
        const n = s.nudge;
        if (sig === n.sig) {
          if (n.count >= MAX_SAME_NUDGES || now() - n.at < COOLDOWN_MS) continue;
          n.count++; n.at = now();
        } else {
          s.nudge = { sig, at: now(), count: 1 };
        }
        const what = na.task ? `${na.action} #${na.task.id}` : na.action;
        say(t("nudge", { what }), t("evNudge", { what }));
      }
    },
  };
  return api;
}

module.exports = { createReferee, AGENTS };
