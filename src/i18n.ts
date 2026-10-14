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
    captainPlanning: "Kaptan ({captain}) planı hazırlıyor.",
    waitingPartner: "{partner} ajanının bitirmesi/incelemesi bekleniyor.",
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
    needAgentId: 'AGENT_ID env zorunlu: "claude", "codex" ya da "gemini"',
    needDataDir: "DUOREVIEW_DIR env zorunlu (veri klasörü)",
    dNextAction: "Sıradaki adımı verir; sıradaki iş senin görevinse üstlenir. Cevabında next olmayan adımdan sonra çağır.",
    dPostTasks: "[Kaptan] Görev ekle. touches=dokunulacak dosya/klasörler, assignee=takımdaki ajan (claude|codex|gemini), depends_on=önce bitmesi gereken mevcut görev id'leri.",
    dAssignTask: "[Kaptan] TODO görevi ata/yeniden ata.",
    dStatus: "Pano özeti (satır başına bir görev). detail=true: özet ve son inceleme notları da gelir. id: o görevin tam tarifi.",
    dClaimTask: "Belirli bir TODO görevi üstlen (next_action sıradakini kendisi üstlenir); cevapta görev tarifi gelir.",
    dSubmitTask: "İşi incelemeye gönder. summary en çok 3 satır.",
    dReviewTask:
      "Ortağın görevini incele. request_changes YALNIZ severity=blocker (çökme, derleme kırığı, normal kullanımda veri kaybı) " +
      "ya da major (tarife aykırılık) için. Nadir/varsayımsal durum (disk dolu, depolama hatası), stil, ek iyileştirme: approve_with_notes. " +
      "Önceki bulgular kapandıysa onayla; yeni köşe durumu arayıp turu uzatma. " +
      "Aynı işi belirgin biçimde daha sade ya da hızlı yapmanın yolunu görüyorsan comment'e somut olarak yaz (hangi dosya, nasıl). " +
      "İstenmemiş dosya/soyutlama ve ilgisiz değişiklik major sayılır.",
    dSendPrompt: "Ortağının terminaline prompt yaz (boşa çıkınca teslim edilir). to yoksa tüm ortaklarına gider. Kısa ve kendi kendine yeten olsun.",
    dReadInbox: "Okunmamış mesajlar.",
    onlyCaptain: "Yetki kaptanda ({captain}).",
    onlyCaptainShort: "Yalnız kaptan.",
    notTodoOrMissing: "Görev yok ya da TODO değil.",
    noTask: "Görev yok.",
    notYours: "Bu görev sende değil ya da gönderilebilir durumda değil.",
    notInReview: "Görev incelemede değil.",
    ownWork: "Kendi işini inceleyemezsin.",
    notYourReview: "Bu görevin inceleyicisi {who}.",
    notInTeam: "Bu oturumda takımda değilsin (takım: {team}).",
    notInTeamAssignee: "Takımda olmayan ajan: {who} (takım: {team}).",
    badRecipient: "Alıcı ortaklarından biri olmalı: {team}.",
    teamLine: "Takım: {team}.",
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
    partnerAnalyzing: "{partner} kendi incelemesini yazıyor.",
    partnerReplying: "Tartışmada söz {partner} ajanında.",
    roleCaptain: "Rolün: KAPTAN ve işçi.",
    roleWorker: "Rolün: işçi; kaptan {captain}.",
    briefLine: "Kullanıcının talimatı: {brief}",
    loop:
      "Döngü: next_action ile başla, dönen action'ı uygula. Araç cevabında next alanı varsa sıradaki adım odur; yoksa next_action çağır. " +
      "FINISH_WORK→görev sana verildi: işi yap, submit_task | " +
      "REVIEW→git diff/grep ile değişen kısımları oku, mümkünse çalıştır, review_task | REWORK→bulguları düzelt, submit_task | " +
      "DISCUSS→gelen not ve mesajları oku, discuss ile yanıtla | WAIT→dur, uygulama seni uyandırır, yoklama yapma | " +
      "Görev tarifini yeniden okumak için status(id). " +
      "ALL_DONE→status(detail) ile kullanıcıya kısa özet ver. Ortaklarının görevlerindeki dosyalara dokunma. " +
      "Tasarım kararı belirsizse koda başlamadan open_thread ile ortaklarına sor. " +
      "Projenin kurallarına uy; commit, push, merge yapma, anahtar dosyalarına dokunma.",
    loopJoint:
      "Ortak açılış: ANALYZE→talimatı kendi başına yerine getir (kodu oku, talimat istiyorsa internette araştır); ortağını bekleme, " +
      "bulgularını post_note ile yaz. Notlar hepiniz yazana kadar birbirinizden gizlidir, sonra DISCUSS ile farkları tartışırsınız. " +
      "PLAN (kaptan)→notları ve tartışmayı birleştir, post_tasks ile işleri takımdaki ajanlara dengeli böl; iş çıkmıyorsa post_tasks(tasks:[]). " +
      "Plan da ortakların onayından geçer.",
    loopSolo: "PLAN (kaptan)→talimatı incele, post_tasks ile işleri takımdaki ajanlara dengeli böl.",
    reviewNow: "İnceleme anında.",
    reviewLater: "İnceleme tüm işler bitince.",
    style:
      "Üslup (kod, not, özet, mesaj, arayüz metni): " +
      "Kodda çevredeki kodun adlandırmasına ve yorum yoğunluğuna uy; kodu tekrar eden yorum, istenmemiş soyutlama/ayar/yedek yol, " +
      "olamayacak hataya try-catch, istenmemiş dosya (özet, README), dokunmadığın kodu yeniden biçimleme yok; en küçük diff. " +
      "Metinde ilk cümlede sonucu söyle; giriş cümlesi, kapanış özeti, övgü, emoji, serpiştirilmiş kalın yazı, üçlü sıralama kalıbı, " +
      "'kapsamlı/sağlam/sorunsuz' türü sıfatlar yok; iddiayı dosya:satır, sayı ya da komut çıktısıyla destekle; bilmiyorsan öyle yaz. " +
      "Tartışmada katılmıyorsan söyle ve nedenini göster, nezaketen onaylama; ortağının yazdığını tekrar etme, eksik ya da yanlış bulduğunu yaz.",
    dPostNote: "Analiz/bulgu notu yaz (kullanıcı uygulamada okur). ANALYZE adımında açılış notun budur.",
    dDiscuss: "Tartışmaya yanıt yaz. stance: agree (katılıyorum; son öneriyi yazan dışında herkes agree deyince tartışma kapanır) | object (katılmıyorum, gerekçesiyle) | propose (yeni öneri).",
    dOpenThread: "Ortaklarınla tartışma aç: yaklaşım, tasarım kararı, itiraz. task=ilgili görev no.",
    dReadThread: "id yoksa tartışma listesi; id ile notlar ve tüm mesajlar.",
    dDropTask: "[Kaptan] TODO görevi sil.",
    kickoffFirst: "Önce ortak inceleme ve tartışma bitmeli (next_action çağır).",
    noThread: "Tartışma yok ya da kapanmış.",
    notYourTurn: "Söz sırası sende değil.",
    tooManyThreads: "Açık {n} tartışman var; önce onlar kapansın.",
    unbalanced: "Yük dengesiz ({split}). Gerekçen yoksa assign_task ile dengele.",
    topicKickoff: "Açılış: incelemelerin karşılaştırması",
    topicPlan: "Plan ve iş bölümü",
    evNote: "not yazdı: {title}",
    evKickoffNote: "açılış incelemesini yazdı",
    evKickoffOpen: "tüm incelemeler hazır → tartışma #{id} açıldı",
    evPost: "tartışma #{id}: {stance}",
    evThreadAgreed: "tartışma #{id} uzlaşmayla kapandı",
    evThreadSplit: "tartışma #{id} ayrışmayla kapandı (mesaj sınırı)",
    evThreadOpened: "tartışma #{id} açtı: {topic}",
    evNoTasks: "plan: görev çıkmadı (yalnız inceleme)",
    evDropped: "#{id} görevini sildi",
    planOpen: "Plan tartışması bitmeden görev alınamaz.",
    depsPending: "Öncül görevler bitmedi: {ids}.",
    badDeps: "depends_on içinde olmayan görev: {ids}.",
    isDependency: "#{id} başka bir görevin öncülü; silinemez.",
    planDetail: "Ayrıntı: status(id)",
  },
  en: {
    captainPlanning: "The captain ({captain}) is preparing the plan.",
    waitingPartner: "Waiting for {partner} to finish or review.",
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
    needAgentId: 'AGENT_ID env is required: "claude", "codex" or "gemini"',
    needDataDir: "DUOREVIEW_DIR env is required (data directory)",
    dNextAction: "Returns the next step and takes the task if it is yours. Call it after a step whose reply had no next.",
    dPostTasks: "[Captain] Add tasks. touches=files/folders to be modified, assignee=an agent in the team (claude|codex|gemini), depends_on=ids of existing tasks that must be done first.",
    dAssignTask: "[Captain] Assign/reassign a TODO task.",
    dStatus: "Board summary (one task per line). detail=true also returns summaries and the latest review notes. id: that task's full spec.",
    dClaimTask: "Take a specific TODO task (next_action takes the next one by itself); the reply contains the task spec.",
    dSubmitTask: "Submit the work for review. summary: 3 lines at most.",
    dReviewTask:
      "Review your partner's task. request_changes ONLY for severity=blocker (crash, broken build, data loss in normal use) " +
      "or major (violates the spec). Rare/hypothetical cases (disk full, storage errors), style, extra polish: approve_with_notes. " +
      "If earlier findings are resolved, approve; do not hunt for new corner cases to prolong the loop. " +
      "If you see a clearly simpler or faster way to do the same job, put it in comment concretely (which file, how). " +
      "Unrequested files/abstractions and unrelated changes count as major.",
    dSendPrompt: "Write a prompt into a partner's terminal (delivered when it goes idle). Without to it goes to all your partners. Keep it short and self-contained.",
    dReadInbox: "Unread messages.",
    onlyCaptain: "Only the captain ({captain}) may do this.",
    onlyCaptainShort: "Captain only.",
    notTodoOrMissing: "Task does not exist or is not TODO.",
    noTask: "No such task.",
    notYours: "This task is not yours or cannot be submitted in its current state.",
    notInReview: "Task is not in review.",
    ownWork: "You cannot review your own work.",
    notYourReview: "The reviewer of this task is {who}.",
    notInTeam: "You are not in the team for this session (team: {team}).",
    notInTeamAssignee: "Agent not in the team: {who} (team: {team}).",
    badRecipient: "The recipient must be one of your partners: {team}.",
    teamLine: "Team: {team}.",
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
    partnerAnalyzing: "{partner} is writing its own analysis.",
    partnerReplying: "It is {partner}'s turn in the discussion.",
    roleCaptain: "Your role: CAPTAIN and worker.",
    roleWorker: "Your role: worker; the captain is {captain}.",
    briefLine: "The user's instruction: {brief}",
    loop:
      "Loop: start with next_action and carry out the returned action. If a tool reply has a next field, that is your next step; otherwise call next_action. " +
      "FINISH_WORK→the task is yours: do the work, submit_task | " +
      "REVIEW→read the changed parts with git diff/grep, run them if you can, review_task | REWORK→fix the findings, submit_task | " +
      "DISCUSS→read the incoming note and messages, answer with discuss | WAIT→stop, the app wakes you, do not poll | " +
      "To read a task spec again: status(id). " +
      "ALL_DONE→give the user a short summary via status(detail). Do not touch files of your partners' tasks. " +
      "If a design decision is unclear, ask your partners with open_thread before writing code. " +
      "Follow the project's rules; do not commit, push, merge, or touch key files.",
    loopJoint:
      "Joint kickoff: ANALYZE→carry out the instruction on your own (read the code, research the web if the instruction asks for it); do not wait for your partner, " +
      "write your findings with post_note. Notes stay hidden from each other until all are in, then you argue the differences in DISCUSS. " +
      "PLAN (captain)→merge the notes and the discussion, split the work evenly between the agents in the team with post_tasks; if there is no work, post_tasks(tasks:[]). " +
      "The plan also goes past your partners.",
    loopSolo: "PLAN (captain)→study the instruction, split the work evenly between the agents in the team with post_tasks.",
    reviewNow: "Review immediately.",
    reviewLater: "Review once all work is done.",
    style:
      "Style (code, notes, summaries, messages, UI copy): " +
      "In code match the naming and comment density around you; no comments that restate the code, no unrequested abstraction/option/fallback, " +
      "no try-catch for errors that cannot happen, no unrequested files (summaries, READMEs), no reformatting of code you did not change; smallest diff. " +
      "In text put the result in the first sentence; no opener, no closing recap, no praise, no emoji, no scattered bold, no rule-of-three lists, " +
      "no adjectives like 'comprehensive/robust/seamless'; back a claim with file:line, a number or command output; if you do not know, say so. " +
      "In discussion say when you disagree and show why, do not agree to be polite; do not repeat what your partner wrote, write what is missing or wrong.",
    dPostNote: "Write an analysis/findings note (the user reads it in the app). In the ANALYZE step this is your kickoff note.",
    dDiscuss: "Reply in a discussion. stance: agree (the discussion closes once everyone but the author of the last proposal agrees) | object (disagree, with the reason) | propose (new proposal).",
    dOpenThread: "Open a discussion with your partners: approach, design decision, objection. task=related task id.",
    dReadThread: "Without id: list of discussions; with id: notes and all messages.",
    dDropTask: "[Captain] Delete a TODO task.",
    kickoffFirst: "The joint analysis and discussion must finish first (call next_action).",
    noThread: "No such discussion, or it is closed.",
    notYourTurn: "It is not your turn.",
    tooManyThreads: "You have {n} open discussions; let those close first.",
    unbalanced: "The load is uneven ({split}). Unless you have a reason, rebalance with assign_task.",
    topicKickoff: "Kickoff: comparing the analyses",
    topicPlan: "Plan and split of work",
    evNote: "wrote a note: {title}",
    evKickoffNote: "wrote its kickoff analysis",
    evKickoffOpen: "all analyses are in → discussion #{id} opened",
    evPost: "discussion #{id}: {stance}",
    evThreadAgreed: "discussion #{id} closed in agreement",
    evThreadSplit: "discussion #{id} closed split (message limit)",
    evThreadOpened: "opened discussion #{id}: {topic}",
    evNoTasks: "plan: no tasks (analysis only)",
    evDropped: "deleted task #{id}",
    planOpen: "No task can be taken before the plan discussion ends.",
    depsPending: "Prerequisite tasks are not done: {ids}.",
    badDeps: "depends_on names tasks that do not exist: {ids}.",
    isDependency: "#{id} is a prerequisite of another task; it cannot be deleted.",
    planDetail: "Details: status(id)",
  },
} as const;

export type Key = keyof (typeof MESSAGES)["tr"];

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
