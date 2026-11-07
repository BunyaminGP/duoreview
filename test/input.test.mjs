import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const inputLib = require("../app/input.js");
const i18n = require("../app/i18n.js");

const {
  RESET_TUI_MODES_SEQ,
  resetTerminalModes,
  handleTerminalKey,
  createPasteTargetManager,
  createComposerController,
  createHoldController,
  getLifecycleButtonState,
  formatLifecycleStatus,
} = inputLib;

test("1. Tuş kombinasyonları, seçim kopyalama ve boş pano görüntü geçişi", () => {
  // Ctrl+C seçim varken kopyalar
  const copyRes = handleTerminalKey(
    { key: "c", ctrlKey: true, shiftKey: false, altKey: false },
    { hasSelection: true, selectedText: "seçilen metin 🚀" }
  );
  assert.equal(copyRes.handled, true);
  assert.equal(copyRes.action, "copy");
  assert.equal(copyRes.text, "seçilen metin 🚀");

  // Ctrl+C seçim yokken terminale bırakır
  const sigintRes = handleTerminalKey(
    { key: "c", ctrlKey: true, shiftKey: false, altKey: false },
    { hasSelection: false }
  );
  assert.equal(sigintRes.handled, false);

  // Ctrl+V panoda metin varken metni yapıştırır
  const pasteRes = handleTerminalKey(
    { key: "v", ctrlKey: true, shiftKey: false, altKey: false },
    { clipboardText: "satır 1\nsatır 2 Türkçe şçöğüı" }
  );
  assert.equal(pasteRes.handled, true);
  assert.equal(pasteRes.action, "paste");
  assert.equal(pasteRes.text, "satır 1\nsatır 2 Türkçe şçöğüı");

  // Ctrl+Shift+V ve Shift+Insert yapıştırmayı destekler
  const pasteShiftRes = handleTerminalKey(
    { key: "v", ctrlKey: true, shiftKey: true, altKey: false },
    { clipboardText: "shift v metni" }
  );
  assert.equal(pasteShiftRes.handled, true);
  assert.equal(pasteShiftRes.action, "paste");

  const pasteInsertRes = handleTerminalKey(
    { key: "Insert", ctrlKey: false, shiftKey: true, altKey: false },
    { clipboardText: "insert metni" }
  );
  assert.equal(pasteInsertRes.handled, true);
  assert.equal(pasteInsertRes.action, "paste");

  // Pano metni boşken (örn. panoda görüntü varken) terminal için 0x16 geçişi korunur
  const emptyPasteRes = handleTerminalKey(
    { key: "v", ctrlKey: true, shiftKey: false, altKey: false },
    { clipboardText: "" }
  );
  assert.equal(emptyPasteRes.handled, true);
  assert.equal(emptyPasteRes.action, "image-passthrough");
  assert.equal(emptyPasteRes.code, "\x16");
});

test("2. Asenkron pano okuma sonrası yapıştırma hedefinin başka ajana kaymaması", async () => {
  const deliveries = [];
  let clipboardValue = "Panodaki metin";

  // Simüle edilmiş gecikmeli clipboard okuyucu
  const readClipboard = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return clipboardValue;
  };

  const pasteToAgent = async (agent, text) => {
    deliveries.push({ agent, text });
  };

  const manager = createPasteTargetManager({ readClipboard, pasteToAgent });

  // claude için yapıştırma tetiklendi
  const promise = manager.triggerPaste("claude");

  // Kullanıcı bekleme anında codex veya gemini paneline odaklanmış olsa bile
  const ok = await promise;
  assert.equal(ok, true);
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].agent, "claude");
  assert.equal(deliveries[0].text, "Panodaki metin");
});

test("3. Composer çok satır Türkçe/emoji metni bridge.send'e aynen gönderir; taslak güvenliği", async () => {
  let sentPayload = null;
  let shouldFail = false;
  let delayMs = 10;

  const mockSend = async (agent, text) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (shouldFail) {
      return { ok: false, error: "ConPTY write failed" };
    }
    sentPayload = { agent, text };
    return { ok: true };
  };

  const composer = createComposerController({
    agent: "codex",
    sendFn: mockSend,
  });

  const complexText = "Birinci satır: Türkçe karakterler çşğüöı İĞÜŞÖÇ\nİkinci satır: 🚀 Çok satırlı emoji test";
  composer.setDraft(complexText);
  assert.equal(composer.getDraft(), complexText);

  // Başarılı gönderim
  const sendRes = await composer.send();
  assert.equal(sendRes.sent, true);
  assert.equal(sentPayload.agent, "codex");
  assert.equal(sentPayload.text, complexText);
  assert.equal(composer.getDraft(), ""); // Başarıda taslak temizlenir

  // Çift tıklama / gönderim sürerken ikinci çağrı engellenir
  delayMs = 40;
  composer.setDraft("İkinci mesaj");
  const p1 = composer.send();
  const p2 = composer.send(); // Eşzamanlı çağrı
  const r2 = await p2;
  assert.equal(r2.sent, false);
  assert.equal(r2.reason, "busy");
  const r1 = await p1;
  assert.equal(r1.sent, true);

  // Gönderim sürerken kullanıcının yaptığı yeni düzenlemeyi başarı yanıtında silmeme
  composer.setDraft("İlk kısım");
  const pAsync = composer.send();
  // Kullanıcı gönderim sürerken yeni metin ekliyor
  composer.setDraft("İlk kısım + eklenen yeni metin");
  const rAsync = await pAsync;
  assert.equal(rAsync.sent, true);
  // İlk kısım gönderildi, eklenen yeni metin taslakta kaldı
  assert.equal(composer.getDraft(), " + eklenen yeni metin");

  // Hata halinde taslağı koruma
  shouldFail = true;
  delayMs = 5;
  const failedText = "Kaybolmaması gereken kritik taslak metin";
  composer.setDraft(failedText);
  const failRes = await composer.send();
  assert.equal(failRes.sent, false);
  assert.equal(failRes.error, "ConPTY write failed");
  assert.equal(composer.getDraft(), failedText); // Hata durumunda taslak silinmedi
});

test("4. Hold testi yalnız odaklı dolu taslakta tutulduğunu, girişte yenilendiğini ve blur/boşaltmada bırakıldığını doğrular", () => {
  const holdEvents = [];
  const holdCtrl = createHoldController({
    setHoldFn: (agent, held) => holdEvents.push({ agent, held }),
  });

  // Boş taslağa odaklanıldığında hold açılmaz
  holdCtrl.onFocus("gemini", "");
  assert.equal(holdCtrl.isHeld("gemini"), false);

  // Odaklıyken metin girildiğinde hold açılır
  holdCtrl.onInput("gemini", "yazılan metin", true);
  assert.equal(holdCtrl.isHeld("gemini"), true);
  assert.deepEqual(holdEvents[holdEvents.length - 1], { agent: "gemini", held: true });

  // İkinci giriş yapıldığında hold(true) tekrar çağrılarak süre yenilenir
  holdCtrl.onInput("gemini", "yazılan metin devamı", true);
  assert.equal(holdCtrl.isHeld("gemini"), true);
  assert.equal(holdEvents.filter((e) => e.agent === "gemini" && e.held === true).length, 2);

  // Metin tamamen silindiğinde hold bırakılır
  holdCtrl.onInput("gemini", "", true);
  assert.equal(holdCtrl.isHeld("gemini"), false);
  assert.deepEqual(holdEvents[holdEvents.length - 1], { agent: "gemini", held: false });

  // Tekrar metin girilip blur yapıldığında hold bırakılır
  holdCtrl.onInput("gemini", "yeni metin", true);
  assert.equal(holdCtrl.isHeld("gemini"), true);
  holdCtrl.onBlur("gemini");
  assert.equal(holdCtrl.isHeld("gemini"), false);
  assert.deepEqual(holdEvents[holdEvents.length - 1], { agent: "gemini", held: false });
});

test("5. Lifecycle UI testi STOPPING sırasında yeniden başlatmayı engeller, durumları gösterir", () => {
  // RUNNING
  const runningState = getLifecycleButtonState("RUNNING");
  assert.equal(runningState.canStart, false);
  assert.equal(runningState.canStop, true);
  assert.equal(runningState.canSend, true);

  // STOPPING sırasında yeniden başlatma kilitlenir
  const stoppingState = getLifecycleButtonState("STOPPING");
  assert.equal(stoppingState.canStart, false);
  assert.equal(stoppingState.canStop, false);
  assert.equal(stoppingState.canSend, false);

  // STOPPED ve EXITED durumlarında yeniden başlatılabilir
  const stoppedState = getLifecycleButtonState("STOPPED");
  assert.equal(stoppedState.canStart, true);
  assert.equal(stoppedState.canStop, false);

  const exitedState = getLifecycleButtonState("EXITED");
  assert.equal(exitedState.canStart, true);
  assert.equal(exitedState.canStop, false);

  // FAILED durumunda tekrar başlanabilir ve neden görünür
  const failedState = getLifecycleButtonState("FAILED");
  assert.equal(failedState.canStart, true);
  assert.equal(failedState.canStop, false);

  i18n.setLang("tr");
  const formattedTr = formatLifecycleStatus("FAILED", "Bağlantı koptu (kod 1)", i18n.t);
  assert.match(formattedTr, /Bağlantı koptu \(kod 1\)/);

  i18n.setLang("en");
  const formattedEn = formatLifecycleStatus("FAILED", "Connection lost (code 1)", i18n.t);
  assert.match(formattedEn, /Connection lost \(code 1\)/);
});

test("6. Terminal geçmişi restartta term.reset/clear ile silinmez, modlar güvenle sıfırlanır", () => {
  const writtenData = [];
  let resetCalled = false;
  let clearCalled = false;

  const mockTerm = {
    write: (data) => writtenData.push(data),
    reset: () => { resetCalled = true; },
    clear: () => { clearCalled = true; },
  };

  resetTerminalModes(mockTerm);

  assert.equal(resetCalled, false, "term.reset çağrılmamalı (scrollback silinmemeli)");
  assert.equal(clearCalled, false, "term.clear çağrılmamalı (scrollback silinmemeli)");
  assert.equal(writtenData.length, 1);
  assert.equal(writtenData[0], RESET_TUI_MODES_SEQ);
});
