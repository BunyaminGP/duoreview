// Ajanın terminaline metin yazar ve Enter'a basar. Electron'a bağımlı değildir (testlerde sahte saat verilir).
// Codex TUI'si art arda hızlı gelen karakterleri yapıştırma sayar ve o sırada gelen Enter'ı satır sonu olarak ekler.
// Sabit bir bekleme uzun metinde yetmez: Enter, yankı durulunca gönderilir ve ajan çalışmaya başlamadıysa yinelenir.
const SETTLE_MS = 500;      // yankı bu kadar sustuysa metin tamamen işlendi
const MAX_SETTLE_MS = 8000;
const CHECK_MS = 1600;      // Enter'dan sonra ajanın çalışmaya başlamasına tanınan süre
const RETRIES = 2;

function createInjector({ write, lastOutputAt, awaitingApproval, now = Date.now, later = setTimeout }) {
  return function inject(agent, text) {
    if (!write(agent, text)) return;
    const started = now();
    const pressEnter = (left) => {
      if (!write(agent, "\r")) return;
      later(() => {
        // Gönderilen ajan sürekli çıktı üretir (çalışma göstergesi). Sessizlik, Enter'ın yutulduğunu gösterir.
        const silent = now() - lastOutputAt(agent) >= CHECK_MS / 2;
        // Ekranda onay sorusu varsa Enter onu kullanıcı adına cevaplar: basılmaz.
        if (left > 0 && silent && !awaitingApproval(agent)) pressEnter(left - 1);
      }, CHECK_MS);
    };
    const settle = () => {
      if (now() - lastOutputAt(agent) >= SETTLE_MS || now() - started >= MAX_SETTLE_MS) return pressEnter(RETRIES);
      later(settle, 100);
    };
    later(settle, SETTLE_MS);
  };
}

module.exports = { createInjector, SETTLE_MS, MAX_SETTLE_MS, CHECK_MS, RETRIES };
