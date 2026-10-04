// Sunucu/akış metinleri (ajanın gördüğü cevaplar, hatalar, olay günlüğü). Dil: DUOREVIEW_LANG=tr|en
// Uygulama sürecinde (Electron) setLang ile değiştirilir. Veritabanına yazılan olay metinleri yazıldığı andaki dilde kalır.
export type Lang = "tr" | "en";
export const LANGS: Lang[] = ["tr", "en"];

let lang: Lang = process.env.DUOREVIEW_LANG === "en" ? "en" : "tr";
export const setLang = (l: string) => { lang = l === "en" ? "en" : "tr"; };
export const getLang = () => lang;

export const MESSAGES = {
  tr: {
    // akış (flow.ts)
    planHint: "Kaynak belgeleri oku, işleri post_tasks ile panoya yaz (her görevde touches ve assignee ver), sonra next_action çağır.",
    captainPlanning: "Kaptan ({captain}) planı hazırlıyor.",
    reworkHint: "Yorumları uygula, sonra submit_task çağır.",
    finishHint: "İşi bitir ve submit_task çağır.",
    reviewHint: "Değişen dosyaları gerçekten oku/test et, sonra review_task çağır. Kör onay verme.",
    claimHint: "claim_task({id}) çağır ve işe başla.",
    disputesHint: "İhtilaflı görevleri kullanıcıya raporla.",
    allApprovedHint: "Her şey onaylandı. report çağır ve kullanıcıya özet ver.",
    waitingPartner: "{partner} ajanının bitirmesi/incelemesi bekleniyor.",
    waitHint: "Beklemedesin. Uygulama seni uyandıracak; sen yoklama yapma.",
    notTodo: "Görev TODO değil.",
    assignedToOther: "Bu görev {who} ajanına atanmış.",
    quotaFull: "Payın doldu ({quota}).",
    fileClash: "#{id} aynı dosyalara dokunuyor ({owner} çalışıyor). Onun bitmesini bekle.",
    userAccepted: "Kullanıcı ihtilafı kabul ederek onayladı.",
    evAccepted: "#{id} ihtilafını kabul etti → görev onaylandı",
    userDecision: "KULLANICI KARARI (bağlayıcı): ",
    userDecisionDefault: "Bulguları kapat ve tekrar gönder.",
    evResolved: "#{id} ihtilafını çözdü → {owner} düzeltecek",
    userReopen: "Kullanıcı yeniden incelemeyi istedi: ",
    userReopenDefault: "son düzeltmeler incelensin.",
    evReopened: "#{id} ihtilafını yeniden incelemeye açtı",
    // sunucu (server.ts)
    errPrefix: "HATA",
    needAgentId: 'AGENT_ID env zorunlu: "claude" veya "codex"',
    needDataDir: "DUOREVIEW_DIR env zorunlu (veri klasörü)",
    dNextAction: "Sıradaki adımı verir. Her adımdan sonra çağır.",
    dPostTasks: "[Kaptan] Görev ekle. touches=dokunulacak dosya/klasörler, assignee=claude|codex.",
    dAssignTask: "[Kaptan] TODO görevi ata/yeniden ata.",
    dStatus: "Pano özeti (satır başına bir görev). detail=true: özet ve son inceleme notları da gelir.",
    dClaimTask: "TODO görevi üstlen; cevapta görev tarifi gelir, hemen çalış.",
    dSubmitTask: "İşi incelemeye gönder. summary en çok 3 satır.",
    dReviewTask:
      "Ortağın görevini incele. request_changes YALNIZ severity=blocker (çökme, derleme kırığı, normal kullanımda veri kaybı) " +
      "ya da major (tarife aykırılık) için. Nadir/varsayımsal durum (disk dolu, depolama hatası), stil, ek iyileştirme: approve_with_notes. " +
      "Önceki bulgular kapandıysa onayla; yeni köşe durumu arayıp turu uzatma.",
    dSendPrompt: "Ortağın terminaline prompt yaz (boşa çıkınca teslim edilir). Kısa ve kendi kendine yeten olsun.",
    dReadInbox: "Okunmamış mesajlar.",
    onlyCaptain: "Yetki kaptanda ({captain}).",
    onlyCaptainShort: "Yalnız kaptan.",
    notTodoOrMissing: "Görev yok ya da TODO değil.",
    noTask: "Görev yok.",
    notYours: "Bu görev sende değil ya da gönderilebilir durumda değil.",
    notInReview: "Görev incelemede değil.",
    ownWork: "Kendi işini inceleyemezsin.",
    reviewClosed: "İnceleme aşaması henüz açılmadı: önce tüm görevler bitmeli.",
    needReason: "Değişiklik isterken gerekçe yaz.",
    needSeverity:
      "request_changes için severity 'blocker' ya da 'major' olmalı. Nadir/varsayımsal (minor) bulgular görevi durdurmaz: verdict=approve_with_notes kullan ve bulguyu comment'e yaz.",
    evTasksAdded: "{n} görev panoya eklendi",
    evAssigned: "#{id} → {who} ajanına atandı",
    evStarted: '#{id} "{title}" başladı',
    evSubmitted: "#{id} incelemeye gönderildi",
    evApproved: "#{id} onayladı",
    evApprovedNotes: "#{id} notlarla onayladı (takip edilecek notlar var)",
    evChanges: "#{id} için değişiklik istedi (tur {round}/{max}){dispute}",
    evDisputeSuffix: " → İHTİLAF",
    disputeReply: "DISPUTE: karar kullanıcıda",
    evPrompt: "{partner} ajanına prompt gönderdi: {text}",
    colHeader: "id|durum|kim|tur|başlık",
    lastLabel: "son",
  },
  en: {
    planHint: "Read the source documents, post the work to the board with post_tasks (give each task touches and assignee), then call next_action.",
    captainPlanning: "The captain ({captain}) is preparing the plan.",
    reworkHint: "Apply the review comments, then call submit_task.",
    finishHint: "Finish the work and call submit_task.",
    reviewHint: "Actually read/test the changed files, then call review_task. Do not rubber-stamp.",
    claimHint: "Call claim_task({id}) and start working.",
    disputesHint: "Report the disputed tasks to the user.",
    allApprovedHint: "Everything is approved. Call report and give the user a summary.",
    waitingPartner: "Waiting for {partner} to finish or review.",
    waitHint: "You are waiting. The app will wake you; do not poll.",
    notTodo: "Task is not TODO.",
    assignedToOther: "This task is assigned to {who}.",
    quotaFull: "Your share is full ({quota}).",
    fileClash: "#{id} touches the same files ({owner} is working on it). Wait for it to finish.",
    userAccepted: "The user accepted the dispute and approved the task.",
    evAccepted: "#{id} dispute accepted → task approved",
    userDecision: "USER DECISION (binding): ",
    userDecisionDefault: "Close the findings and resubmit.",
    evResolved: "#{id} dispute resolved → {owner} will fix it",
    userReopen: "The user asked for a re-review: ",
    userReopenDefault: "review the latest fixes.",
    evReopened: "#{id} dispute reopened for review",
    errPrefix: "ERROR",
    needAgentId: 'AGENT_ID env is required: "claude" or "codex"',
    needDataDir: "DUOREVIEW_DIR env is required (data directory)",
    dNextAction: "Returns the next step. Call it after every step.",
    dPostTasks: "[Captain] Add tasks. touches=files/folders to be modified, assignee=claude|codex.",
    dAssignTask: "[Captain] Assign/reassign a TODO task.",
    dStatus: "Board summary (one task per line). detail=true also returns summaries and the latest review notes.",
    dClaimTask: "Take a TODO task; the reply contains the task spec, start working right away.",
    dSubmitTask: "Submit the work for review. summary: 3 lines at most.",
    dReviewTask:
      "Review your partner's task. request_changes ONLY for severity=blocker (crash, broken build, data loss in normal use) " +
      "or major (violates the spec). Rare/hypothetical cases (disk full, storage errors), style, extra polish: approve_with_notes. " +
      "If earlier findings are resolved, approve; do not hunt for new corner cases to prolong the loop.",
    dSendPrompt: "Write a prompt into your partner's terminal (delivered when it goes idle). Keep it short and self-contained.",
    dReadInbox: "Unread messages.",
    onlyCaptain: "Only the captain ({captain}) may do this.",
    onlyCaptainShort: "Captain only.",
    notTodoOrMissing: "Task does not exist or is not TODO.",
    noTask: "No such task.",
    notYours: "This task is not yours or cannot be submitted in its current state.",
    notInReview: "Task is not in review.",
    ownWork: "You cannot review your own work.",
    reviewClosed: "The review phase is not open yet: all tasks must be finished first.",
    needReason: "Give a reason when requesting changes.",
    needSeverity:
      "request_changes needs severity 'blocker' or 'major'. Rare/hypothetical (minor) findings do not block a task: use verdict=approve_with_notes and put the finding in comment.",
    evTasksAdded: "{n} tasks added to the board",
    evAssigned: "#{id} → assigned to {who}",
    evStarted: '#{id} "{title}" started',
    evSubmitted: "#{id} submitted for review",
    evApproved: "#{id} approved",
    evApprovedNotes: "#{id} approved with notes (follow-ups pending)",
    evChanges: "requested changes on #{id} (round {round}/{max}){dispute}",
    evDisputeSuffix: " → DISPUTE",
    disputeReply: "DISPUTE: the user decides",
    evPrompt: "sent a prompt to {partner}: {text}",
    colHeader: "id|status|who|round|title",
    lastLabel: "last",
  },
} as const;

export type Key = keyof (typeof MESSAGES)["tr"];

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
