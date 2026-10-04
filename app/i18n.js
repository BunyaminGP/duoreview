// Uygulama metinleri (arayüz, ajan protokolü, hakem, hata açıklamaları). Hem Electron ana süreci (require)
// hem de arayüz (<script>) kullanır. Yeni dil eklemek için STR'ye bir blok daha eklemek yeterlidir.
// Sunucu (MCP) metinleri ayrı: src/i18n.ts
(function (root) {
  const STR = {
    tr: {
      langName: "Türkçe",
      // --- arayüz: üst çubuk ---
      project: "Proje", pickTitle: "Klasör seç", captain: "Kaptan", review: "İnceleme",
      modeAfterAll: "Hepsi bitince", modeImmediate: "Anında",
      resetTitle: "Görev panosunu ve geçmişi temizle", reset: "Panoyu sıfırla", teamStart: "▶ Takımı başlat",
      language: "Dil",
      profile: "Profil", profEco: "Ekonomik", profBal: "Dengeli", profPower: "Güçlü", profCustom: "Özel",
      modelPh: "model (boş = varsayılan)", effortTitle: "Düşünme eforu", effortDefault: "efor: varsayılan",
      modelsNote: "Ajan başlarken uygulanır. Düşük efor = daha az token.",
      briefLabel: "Kaptana talimat", start: "Başlat", stop: "Durdur",
      boardTitle: "Görev panosu", eventsTitle: "Olaylar",
      decisionTitle: "⚖ Karar senin", decisionHint: "Ajanlar anlaşamadı. Kararın bağlayıcıdır.",
      decisionPh: "İsteğe bağlı talimat (ör. sadece X düzelt, Y'ye dokunma)",
      dAccept: "✔ Kabul et", dAcceptTitle: "Görevi olduğu gibi onayla",
      dRereview: "👁 Yeniden incelensin", dRereviewTitle: "Sahibi zaten düzelttiyse ortak yeniden baksın",
      dRework: "↻ Düzeltsin", dReworkTitle: "Sahibine talimatınla geri gönder",
      // --- arayüz: dinamik ---
      roleCaptain: "★ kaptan + işçi", roleWorker: "işçi",
      cantSwitch: "Çalışırken proje değiştirilemez.",
      confirmReset: "Bu projenin görev panosu ve olay geçmişi silinsin mi?",
      confirmNoNote: "Talimat yazmadan gönderilsin mi? Ajan önceki bulguları kapatmaya çalışır.",
      procClosed: "[süreç kapandı, kod {code}]",
      stOff: "kapalı", stBusy: "çalışıyor", stIdle: "boşta", stApproval: "onay bekliyor?", stQuota: "kota dolu",
      quotaFullWhy: "kota dolu · {why}",
      fPLAN: "plan bekleniyor", fCLAIM: "sırada: işe başla", fFINISH_WORK: "işte", fREVIEW: "sırada: inceleme",
      fREWORK: "sırada: düzeltme", fWAIT: "ortağı bekliyor", fALL_DONE: "bitti",
      sTODO: "yapılacak", sWORKING: "çalışıyor", sREVIEW: "incelemede", sREWORK: "düzeltmede", sDONE: "bitti", sDISPUTE: "ihtilaf",
      doneOf: "{done}/{total} bitti", round: "tur {n}",
      emptyBoard: "Henüz görev yok. Kaptan planı yazınca burada görünür.",
      moreDisputes: "  (+{n} ihtilaf daha)",
      now: "şimdi", renewed: "yenilendi", dayHour: "{d}g {h}sa", hourMin: "{h}sa {m}dk", min: "{m}dk",
      pct: "%{n}", w5h: "5sa", wWeek: "hafta", usageWaiting: "kullanım: bekleniyor",
      ctx: "bağlam %{n}", minAgo: "{n} dk önceki veri", planLabel: "plan: {plan}",
      // --- ana süreç ---
      defaultBrief: "docs klasöründeki belgeleri oku; yapılacak işleri çıkar ve panoya yaz.",
      evTeamStarted: "takım başlatıldı — kaptan: {captain}, inceleme: {mode}",
      evModeImmediate: "anında", evModeAfterAll: "hepsi bitince",
      evResume: "panoda görev var → kaldığı yerden devam modu",
      quota5h: "5 saatlik kota %{pct}", quotaWeek: "haftalık kota %{pct}",
      // --- usage.js ---
      noCodexUsage: "Henüz Codex kullanım kaydı yok", afterFirstReply: "İlk yanıttan sonra görünür",
      noLimitInfo: "Bu hesapta kullanım limiti bilgisi yok",
      // --- hakem ---
      evProtocolSent: "takım protokolü gönderildi",
      evPromptDelivered: "{sender}'in promptu teslim edildi",
      promptFrom: "[{sender} ajanından prompt] {text}",
      evQuotaStopped: "{agent}: {why} — kota yenilenene kadar dürtme durduruldu",
      evQuotaRenewed: "{agent}: kota yenilendi, dürtme sürüyor",
      nudge: "[Takım] Sıra sende: {what}. next_action çağır ve dönen aksiyonu uygula.",
      evNudge: "sıra sende dürtmesi ({what})",
      // --- hata açıklamaları ---
      errBusy: "Dosya başka bir işlem tarafından kullanılıyor (çoğu zaman Claude Code güncellemesi hâlâ sürüyor). Güncelleme bitince \"Başlat\"a tekrar bas.",
      errBadExe: "Çalıştırılabilir dosya geçerli değil (yarım kalmış kurulum). npm i -g @anthropic-ai/claude-code ile yeniden kur.",
      errBadDir: "Proje klasörü geçersiz ya da silinmiş.",
      errNotFound: "Dosya bulunamadı.",
      evSpawnFail: "{agent} başlatılamadı: {msg}",
      termSpawnFail: "[DuoReview] {agent} başlatılamadı",
      claudeNotFound: "Claude Code çalıştırılabilir dosyası bulunamadı. Denenen yerler:\n  {tried}\nÇözüm: npm i -g @anthropic-ai/claude-code (ya da DUOREVIEW_CLAUDE_BIN ile yolunu ver).",
      notOnPath: "{name} PATH içinde bulunamadı (Codex için Node.js gerekli)",
      codexNotFound: "Codex CLI bulunamadı. Çözüm: npm i -g @openai/codex (ya da DUOREVIEW_CODEX_BIN ile yolunu ver).",
      // --- ajan protokolü ---
      pHead: "Sen {agent}, ortağın {partner}; araçlar duoreview MCP'de. Proje: {dir}.",
      pRules:
        "Döngü: next_action çağır, action'ı uygula: CLAIM→claim_task | FINISH_WORK→işi yap, submit_task (özet en çok 3 satır) | " +
        "REVIEW→dosyaları baştan sona okuma, git diff/grep ile değişen kısımlara bak, review_task | REWORK→bulguları düzelt, submit_task | " +
        "WAIT→bekle, seni uyandıracağım, yoklama yapma | ALL_DONE→status(detail) ile kullanıcıya kısa özet. " +
        "request_changes yalnız blocker/major için; nadir durumlarda approve_with_notes. İhtilafı kullanıcı çözer. " +
        "Ortağın görevindeki dosyalara dokunma; takılırsan send_prompt. Yanıtların kısa olsun. " +
        "Projenin kurallarına uy; main'e merge, push ve anahtar dosyalarına dokunma.",
      pResume: "Takım kaldığı yerden devam ediyor: plan yapma, görev ekleme. Önce next_action çağır.",
      pReviewNow: "İnceleme anında.", pReviewLater: "İnceleme tüm işler bitince.",
      pCaptain:
        "Sen KAPTAN+işçisin. Talimat: {brief} " +
        "Belgeleri oku, işleri küçük bağımsız görevlere böl ve post_tasks ile yaz (touches=dokunulacak dosyalar, assignee); " +
        "yükü dengele, ortak dosyalara dokunanları aynı kişiye ver. Sonra next_action ile çalış.",
      pWorker: "Sen İŞÇİsin; kaptan {captain} plan hazırlıyor. Talimat (bilgi): {brief} next_action çağır; plan gelene dek WAIT.",
    },
    en: {
      langName: "English",
      project: "Project", pickTitle: "Choose folder", captain: "Captain", review: "Review",
      modeAfterAll: "When all done", modeImmediate: "Immediate",
      resetTitle: "Clear the task board and history", reset: "Reset board", teamStart: "▶ Start team",
      language: "Language",
      profile: "Profile", profEco: "Economy", profBal: "Balanced", profPower: "Powerful", profCustom: "Custom",
      modelPh: "model (empty = default)", effortTitle: "Reasoning effort", effortDefault: "effort: default",
      modelsNote: "Applied when the agent starts. Lower effort = fewer tokens.",
      briefLabel: "Instruction for the captain", start: "Start", stop: "Stop",
      boardTitle: "Task board", eventsTitle: "Events",
      decisionTitle: "⚖ Your call", decisionHint: "The agents could not agree. Your decision is binding.",
      decisionPh: "Optional instruction (e.g. fix only X, don't touch Y)",
      dAccept: "✔ Accept", dAcceptTitle: "Approve the task as it is",
      dRereview: "👁 Re-review", dRereviewTitle: "If the owner already fixed it, have the partner look again",
      dRework: "↻ Fix it", dReworkTitle: "Send it back to the owner with your instruction",
      roleCaptain: "★ captain + worker", roleWorker: "worker",
      cantSwitch: "The project cannot be changed while agents are running.",
      confirmReset: "Delete this project's task board and event history?",
      confirmNoNote: "Send without an instruction? The agent will try to close the previous findings.",
      procClosed: "[process exited, code {code}]",
      stOff: "off", stBusy: "working", stIdle: "idle", stApproval: "waiting for approval?", stQuota: "quota full",
      quotaFullWhy: "quota full · {why}",
      fPLAN: "waiting for plan", fCLAIM: "next: start a task", fFINISH_WORK: "working", fREVIEW: "next: review",
      fREWORK: "next: rework", fWAIT: "waiting for partner", fALL_DONE: "done",
      sTODO: "to do", sWORKING: "working", sREVIEW: "in review", sREWORK: "rework", sDONE: "done", sDISPUTE: "dispute",
      doneOf: "{done}/{total} done", round: "round {n}",
      emptyBoard: "No tasks yet. They appear here once the captain writes the plan.",
      moreDisputes: "  (+{n} more disputes)",
      now: "now", renewed: "renewed", dayHour: "{d}d {h}h", hourMin: "{h}h {m}m", min: "{m}m",
      pct: "{n}%", w5h: "5h", wWeek: "week", usageWaiting: "usage: waiting",
      ctx: "context {n}%", minAgo: "data from {n} min ago", planLabel: "plan: {plan}",
      defaultBrief: "Read the documents in the docs folder; extract the work to be done and post it to the board.",
      evTeamStarted: "team started — captain: {captain}, review: {mode}",
      evModeImmediate: "immediate", evModeAfterAll: "when all done",
      evResume: "the board has tasks → resuming where it left off",
      quota5h: "5-hour quota {pct}%", quotaWeek: "weekly quota {pct}%",
      noCodexUsage: "No Codex usage record yet", afterFirstReply: "Shown after the first reply",
      noLimitInfo: "No usage limit information for this account",
      evProtocolSent: "team protocol sent",
      evPromptDelivered: "prompt from {sender} delivered",
      promptFrom: "[prompt from {sender}] {text}",
      evQuotaStopped: "{agent}: {why} — nudging paused until the quota renews",
      evQuotaRenewed: "{agent}: quota renewed, nudging resumes",
      nudge: "[Team] Your turn: {what}. Call next_action and carry out the returned action.",
      evNudge: "your-turn nudge ({what})",
      errBusy: "The file is in use by another process (often a Claude Code update is still running). Press \"Start\" again when it finishes.",
      errBadExe: "The executable is not valid (half-finished install). Reinstall with npm i -g @anthropic-ai/claude-code.",
      errBadDir: "The project folder is invalid or was deleted.",
      errNotFound: "File not found.",
      evSpawnFail: "{agent} failed to start: {msg}",
      termSpawnFail: "[DuoReview] {agent} failed to start",
      claudeNotFound: "Claude Code executable not found. Tried:\n  {tried}\nFix: npm i -g @anthropic-ai/claude-code (or point DUOREVIEW_CLAUDE_BIN at it).",
      notOnPath: "{name} not found on PATH (Node.js is required for Codex)",
      codexNotFound: "Codex CLI not found. Fix: npm i -g @openai/codex (or point DUOREVIEW_CODEX_BIN at it).",
      pHead: "You are {agent}, your partner is {partner}; the tools are in the duoreview MCP. Project: {dir}.",
      pRules:
        "Loop: call next_action and carry out the action: CLAIM→claim_task | FINISH_WORK→do the work, submit_task (summary: 3 lines max) | " +
        "REVIEW→do not read files end to end, look at the changed parts with git diff/grep, then review_task | REWORK→fix the findings, submit_task | " +
        "WAIT→wait, I will wake you, do not poll | ALL_DONE→give the user a short summary via status(detail). " +
        "request_changes only for blocker/major; in rare cases approve_with_notes. The user resolves disputes. " +
        "Do not touch files of your partner's task; if stuck, use send_prompt. Keep replies short. " +
        "Follow the project's rules; do not merge to main, push, or touch key files.",
      pResume: "The team is resuming where it left off: do not plan, do not add tasks. Call next_action first.",
      pReviewNow: "Review immediately.", pReviewLater: "Review once all work is done.",
      pCaptain:
        "You are the CAPTAIN+worker. Instruction: {brief} " +
        "Read the documents, split the work into small independent tasks and write them with post_tasks (touches=files to be modified, assignee); " +
        "balance the load, give tasks that touch shared files to the same person. Then work via next_action.",
      pWorker: "You are a WORKER; the captain {captain} is preparing the plan. Instruction (for information): {brief} Call next_action; WAIT until the plan arrives.",
    },
  };

  const LANGS = Object.keys(STR);
  let lang = "tr";
  const norm = (l) => (STR[l] ? l : String(l || "").toLowerCase().startsWith("tr") ? "tr" : "en");
  const setLang = (l) => { lang = norm(l); };
  const getLang = () => lang;
  const t = (key, params) =>
    String((STR[lang][key] ?? STR.tr[key] ?? key)).replace(/\{(\w+)\}/g, (_, k) => (params && params[k] !== undefined ? params[k] : `{${k}}`));

  const api = { STR, LANGS, norm, setLang, getLang, t };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof window !== "undefined" ? window : globalThis);
