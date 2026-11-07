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
    dPostTasks:
      "[Kaptan] Görev ekle. touches=dokunulacak dosya/klasörler (çakışma denetimi buna bakar), acceptance=inceleyicinin tek tek doğrulayacağı ölçülebilir kriterler, " +
      "assignee=takımdaki ajan (claude|codex|gemini), key=aynı plandaki görevlerin bağlanacağı kısa ad, " +
      "depends_on=önce bitmesi gereken görevler: aynı plandakiler key ile (listede önce gelmeli), mevcut olanlar id ile.",
    dAssignTask: "[Kaptan] TODO görevi ata/yeniden ata.",
    dStatus: "Pano özeti (satır başına bir görev). detail=true: özet ve son inceleme notları da gelir. id: o görevin tam tarifi.",
    dClaimTask: "Belirli bir TODO görevi üstlen (next_action sıradakini kendisi üstlenir); cevapta görev tarifi gelir.",
    dSubmitTask: "İşi incelemeye gönder. summary en çok 3 satır. Doğrulama komutu tanımlıysa önce o çalışır; başarısızsa görev incelemeye girmez.",
    dReviewTask:
      "Ortağın görevini incele. request_changes YALNIZ severity=blocker (çökme, derleme kırığı, normal kullanımda veri kaybı) " +
      "ya da major (tarife ya da bir kabul kriterine aykırılık) için. Nadir/varsayımsal durum (disk dolu, depolama hatası), stil, ek iyileştirme: approve_with_notes. " +
      "Önceki bulgular kapandıysa onayla; yeni köşe durumu arayıp turu uzatma. " +
      "checks: görevin her kabul kriteri için sırayla {ok, evidence}; evidence dosya:satır, komut çıktısı ya da test adı. " +
      "Kriter bu ortamda denetlenemiyorsa (ör. projenin testleri bu Python sürümünde çalışmıyor) blocked=true ver, evidence'a denenen komutu ve hatasını yaz; bu onayı engellemez, ortamı kurmaya uğraşıp turu uzatma. " +
      "alternative: aynı işi belirgin biçimde daha sade, hızlı ya da algoritmik olarak daha iyi yapmanın yolunu görüyorsan somut yaz (dosya, yöntem, kazanç: karmaşıklık, satır, süre); kaptan karara bağlar. " +
      "İstenmemiş dosya/soyutlama ve ilgisiz değişiklik (unclaimed listesine bak) major sayılır.",
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
      "REVIEW→cevaptaki diff görevin kendi değişikliğidir (truncated varsa oradaki komutla tamamını oku); dosyaları aç, mümkünse çalıştır; " +
      "görevi tarifle, kabul kriterlerini checks ile karşılaştır; daha sade/hızlı yol görüyorsan alternative'e yaz; review_task | REWORK→bulguları düzelt, submit_task | " +
      "TRIAGE (kaptan)→her alternatif için triage: gerçekten daha iyiyse adopt, değilse teknik gerekçeyle reject | " +
      "DISCUSS→gelen not ve mesajları oku, discuss ile yanıtla | WAIT→dur, uygulama seni uyandırır, yoklama yapma | " +
      "Görev tarifini yeniden okumak için status(id). " +
      "ALL_DONE→status(detail) ile kullanıcıya kısa özet ver. Ortaklarının görevlerindeki dosyalara dokunma. " +
      "Tasarım kararı belirsizse koda başlamadan open_thread ile ortaklarına sor. " +
      "Projenin kurallarına uy; commit, push, merge yapma, anahtar dosyalarına dokunma.",
    loopJoint:
      "Ortak açılış: ANALYZE→talimatı kendi başına yerine getir (kodu oku, talimat istiyorsa internette araştır); ortağını bekleme, " +
      "bulgularını post_note ile yaz. Notlar hepiniz yazana kadar birbirinizden gizlidir, sonra DISCUSS ile farkları tartışırsınız. " +
      "PLAN (kaptan)→notları ve tartışmayı birleştir, post_tasks ile işleri takımdaki ajanlara dengeli böl (her göreve touches ve bu makinede denetlenebilir acceptance); iş çıkmıyorsa post_tasks(tasks:[]). " +
      "Plan da ortakların onayından geçer; itiraz haklıysa kaptan önce panoyu assign_task/drop_task/post_tasks ile değiştirir, sonra discuss ile yazar.",
    loopSolo: "PLAN (kaptan)→talimatı incele, post_tasks ile işleri takımdaki ajanlara dengeli böl (her göreve touches ve bu makinede denetlenebilir acceptance).",
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
    captainLabel: "kaptan",
    captainTriage: "Kaptan ({captain}) inceleyicilerin alternatif önerilerini karara bağlıyor.",
    dupKey: "Aynı key iki görevde: {key}.",
    badDepKey: "depends_on'da çözülemeyen değer: {keys}. Aynı plandaki göreve key ile bağlan (öncül listede önce gelmeli), mevcut göreve id ile.",
    noTouches: "touches boş: {ids}. Bu görevlerde dosya çakışma denetimi çalışmaz; tarifte dosyaları belirt.",
    verifyFailed: "Doğrulama komutu başarısız ({cmd}, çıkış {code}); görev incelemeye girmedi. Düzelt, tekrar submit_task. Çıktının sonu:\n{out}",
    evVerifyFailed: "#{id} doğrulama komutundan geçmedi (çıkış {code})",
    needChecks: "Görevin {n} kabul kriteri var: checks ile her biri için sırayla {ok, evidence} ver.",
    needEvidence: "{n}. kriterin kanıtı boş: dosya:satır, komut çıktısı ya da test adı yaz.",
    unmetCriterion: "{n}. kriter karşılanmadı: onay verilemez, request_changes (severity=major) kullan. Ortam yüzünden denetlenemediyse blocked=true ver.",
    dTriage: "[Kaptan] İnceleyicinin alternatif önerisini karara bağla. adopt: öneri yeni görev olur (varsayılan sahibi öneren); reject: teknik gerekçe yaz.",
    noAlternative: "Bekleyen böyle bir alternatif yok.",
    evAltAdopted: "#{id} için alternatifi benimsedi → yeni görev #{task}",
    evAltRejected: "#{id} için alternatifi reddetti: {reason}",
    altTitle: "Alternatif (#{id}): {title}",
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
    dPostTasks:
      "[Captain] Add tasks. touches=files/folders to be modified (the conflict guard uses it), acceptance=measurable criteria the reviewer checks one by one, " +
      "assignee=an agent in the team (claude|codex|gemini), key=short name other tasks in the same plan can link to, " +
      "depends_on=tasks that must be done first: in the same plan by key (must come earlier in the list), existing ones by id.",
    dAssignTask: "[Captain] Assign/reassign a TODO task.",
    dStatus: "Board summary (one task per line). detail=true also returns summaries and the latest review notes. id: that task's full spec.",
    dClaimTask: "Take a specific TODO task (next_action takes the next one by itself); the reply contains the task spec.",
    dSubmitTask: "Submit the work for review. summary: 3 lines at most. If a verify command is set it runs first; if it fails the task does not enter review.",
    dReviewTask:
      "Review your partner's task. request_changes ONLY for severity=blocker (crash, broken build, data loss in normal use) " +
      "or major (violates the spec or an acceptance criterion). Rare/hypothetical cases (disk full, storage errors), style, extra polish: approve_with_notes. " +
      "If earlier findings are resolved, approve; do not hunt for new corner cases to prolong the loop. " +
      "checks: one {ok, evidence} per acceptance criterion of the task, in order; evidence is file:line, command output or a test name. " +
      "If a criterion cannot be checked in this environment (e.g. the project's tests do not run on this Python), set blocked=true and put the command you tried and its error in evidence; that does not block approval, do not spend the round building the environment. " +
      "alternative: if you see a clearly simpler, faster or algorithmically better way to do the same job, describe it concretely (file, method, gain: complexity, lines, time); the captain decides. " +
      "Unrequested files/abstractions and unrelated changes (see the unclaimed list) count as major.",
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
      "REVIEW→the diff in the reply is the task's own change (if truncated is set, read the rest with that command); open the files, run them if you can; " +
      "compare the work with the spec and the acceptance criteria via checks; if you see a simpler/faster way, put it in alternative; review_task | REWORK→fix the findings, submit_task | " +
      "TRIAGE (captain)→triage each alternative: adopt if it is really better, otherwise reject with a technical reason | " +
      "DISCUSS→read the incoming note and messages, answer with discuss | WAIT→stop, the app wakes you, do not poll | " +
      "To read a task spec again: status(id). " +
      "ALL_DONE→give the user a short summary via status(detail). Do not touch files of your partners' tasks. " +
      "If a design decision is unclear, ask your partners with open_thread before writing code. " +
      "Follow the project's rules; do not commit, push, merge, or touch key files.",
    loopJoint:
      "Joint kickoff: ANALYZE→carry out the instruction on your own (read the code, research the web if the instruction asks for it); do not wait for your partner, " +
      "write your findings with post_note. Notes stay hidden from each other until all are in, then you argue the differences in DISCUSS. " +
      "PLAN (captain)→merge the notes and the discussion, split the work evenly between the agents in the team with post_tasks (touches and acceptance that can be checked on this machine, on every task); if there is no work, post_tasks(tasks:[]). " +
      "The plan also goes past your partners; if an objection is right, the captain first changes the board with assign_task/drop_task/post_tasks, then answers with discuss.",
    loopSolo: "PLAN (captain)→study the instruction, split the work evenly between the agents in the team with post_tasks (touches and acceptance that can be checked on this machine, on every task).",
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
    captainLabel: "captain",
    captainTriage: "The captain ({captain}) is deciding on the reviewers' alternative proposals.",
    dupKey: "The same key on two tasks: {key}.",
    badDepKey: "depends_on has values that cannot be resolved: {keys}. Link to a task in the same plan by key (the prerequisite must come earlier in the list), to an existing task by id.",
    noTouches: "touches is empty: {ids}. The file-conflict guard does not work for these tasks; name the files in the spec.",
    verifyFailed: "The verify command failed ({cmd}, exit {code}); the task did not enter review. Fix it and submit_task again. End of output:\n{out}",
    evVerifyFailed: "#{id} did not pass the verify command (exit {code})",
    needChecks: "The task has {n} acceptance criteria: give checks with one {ok, evidence} per criterion, in order.",
    needEvidence: "The evidence for criterion {n} is empty: give file:line, command output or a test name.",
    unmetCriterion: "Criterion {n} is not met: you cannot approve, use request_changes (severity=major). If the environment kept you from checking it, set blocked=true.",
    dTriage: "[Captain] Decide on a reviewer's alternative proposal. adopt: it becomes a new task (by default owned by the proposer); reject: give a technical reason.",
    noAlternative: "No such pending alternative.",
    evAltAdopted: "adopted the alternative for #{id} → new task #{task}",
    evAltRejected: "rejected the alternative for #{id}: {reason}",
    altTitle: "Alternative (#{id}): {title}",
  },
} as const;

export type Key = keyof (typeof MESSAGES)["tr"];

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}
