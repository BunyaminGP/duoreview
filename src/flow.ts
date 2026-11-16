// Takım akışı kuralları. Hem MCP sunucusu hem uygulamadaki hakem bunu kullanır.
import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { AGENTS, MAX_POSTS, MAX_CROSS_ROUNDS, type Agent } from "./db.js";
import { projectDir } from "./git.js";
import { t as tr } from "./i18n.js";

export type Task = {
  id: number; title: string; description: string; status: string;
  assignee: Agent | null; owner: Agent | null; touches: string; summary: string | null;
  files: string | null; rounds: number; updated_at: string; depends_on: string; acceptance: string;
  base: string | null; head: string | null; diff: string | null; unclaimed: string | null; verify: string | null; origin: number | null; reviewer: Agent | null;
};
export type Review = {
  id: number; task_id: number; reviewer: string; verdict: string; comment: string;
  checks: string | null; alternative: string | null; triage: string | null; triage_note: string | null;
};
export type ReviewMode = "after_all" | "immediate";
export type Kickoff = "solo" | "joint" | "cross";
export type Stance = "propose" | "object" | "agree";
export type Thread = {
  id: number; kind: "kickoff" | "plan" | "free"; topic: string; task_id: number | null; blocking: number;
  status: "OPEN" | "CLOSED"; outcome: "agreed" | "split" | null; opened_by: Agent; max_posts: number;
};
export type Post = { id: number; thread_id: number; author: Agent; stance: Stance; text: string };
export type Note = { id: number; author: Agent; kind: string; title: string; text: string };

export const all = <T>(db: DatabaseSync, sql: string, ...p: any[]) => db.prepare(sql).all(...p) as T[];
export const one = <T>(db: DatabaseSync, sql: string, ...p: any[]) => db.prepare(sql).get(...p) as T | undefined;
export const run = (db: DatabaseSync, sql: string, ...p: any[]) => db.prepare(sql).run(...p);
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

export const getMeta = (db: DatabaseSync, key: string, def: string) =>
  one<{ value: string }>(db, "SELECT value FROM meta WHERE key=?", key)?.value ?? def;
export const setMeta = (db: DatabaseSync, key: string, value: string) =>
  run(db, "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", key, value);
export const logEvent = (db: DatabaseSync, actor: string, text: string) =>
  run(db, "INSERT INTO events(actor, text) VALUES (?,?)", actor, text);

export const captainOf = (db: DatabaseSync) => getMeta(db, "captain", "claude") as Agent;
/** Takımdaki ajanlar (uygulama yazar). Bu anahtarı taşımayan eski panolar Claude + Codex sayılır. */
export const teamOf = (db: DatabaseSync): Agent[] => {
  const team = getMeta(db, "team", "").split(",").filter((a): a is Agent => (AGENTS as string[]).includes(a));
  return team.length >= 2 ? team : ["claude", "codex"];
};
export const others = (db: DatabaseSync, me: Agent) => teamOf(db).filter((a) => a !== me);
/** Bitmemiş görev ya da süren açılış varken takım değişirse görev sahipsiz, açılış eksik kalır: önce bitmeli ya da pano sıfırlanmalı. */
export const teamChangeBlocked = (db: DatabaseSync, team: string[]) =>
  team.join(",") !== teamOf(db).join(",") &&
  !!(one(db, "SELECT id FROM tasks WHERE status<>'DONE'") || (!planned(db) && one(db, "SELECT id FROM notes WHERE kind='kickoff'")));
/** Görevin inceleyicisi: kullanıcı seçtiyse o, yoksa takım sırasında sahibinden sonraki ajan (iki kişide ortak, üç kişide döngü). */
export const reviewerOf = (db: DatabaseSync, t: Task): Agent => {
  const team = teamOf(db);
  if (t.reviewer && t.reviewer !== t.owner && team.includes(t.reviewer)) return t.reviewer;
  return team[(team.indexOf(t.owner as Agent) + 1) % team.length];
};
/** Kullanıcı inceleyiciyi değiştirir (ör. inceleyicinin kotası doldu). Sahibi olan, bitmemiş görevde; sahibi dışında takımdan biri. */
export function setReviewer(db: DatabaseSync, id: number, who: Agent): boolean {
  const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
  if (!t || !t.owner || t.status === "DONE" || who === t.owner || !teamOf(db).includes(who)) return false;
  if (reviewerOf(db, t) === who) return true;
  run(db, "UPDATE tasks SET reviewer=?, updated_at=datetime('now') WHERE id=?", who, id);
  logEvent(db, "user", tr("evReviewer", { id, who }));
  return true;
}
export const reviewMode = (db: DatabaseSync) => getMeta(db, "review_mode", "after_all") as ReviewMode;

/** Subagent kuralı (ajana talimat olarak gider): off | research | scoped. */
export const subagentsOf = (db: DatabaseSync) => getMeta(db, "subagents", "research");

/** joint: plan öncesi ajanlar ayrı ayrı inceler, sonra serbest tartışır. cross: notlardaki iddialar tek tek çapraz incelenir. solo: yalnız kaptan planlar. */
export const kickoffOf = (db: DatabaseSync) => getMeta(db, "kickoff", "solo") as Kickoff;
/** Kaptan planı yazdı mı (hiç görev çıkmayan analiz/araştırma işlerinde de 1 olur). */
export const planned = (db: DatabaseSync) => getMeta(db, "planned", "0") === "1";

export const total = (db: DatabaseSync) => one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks")!.n;
export const quota = (db: DatabaseSync) => Math.ceil(total(db) / teamOf(db).length);
/** Bana atanmış ya da benim üstlendiğim görev sayısı. */
export const mineCount = (db: DatabaseSync, a: Agent) =>
  one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE owner=? OR assignee=?", a, a)!.n;

/** Proje klasörüne göre mutlak, karşılaştırılabilir yol (Windows'ta küçük harf). */
export const norm = (p: string) => {
  const absolute = resolve(projectDir(), p.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
};
export const parsePaths = (s: string | null): string[] => { try { return JSON.parse(s ?? "[]").map(norm); } catch { return []; } };
export const overlaps = (a: string[], b: string[]) =>
  a.some((x) => b.some((y) => x === y || x.startsWith(y + "/") || y.startsWith(x + "/")));

/** Bitmemiş işler. İncelemede bekleyen de sayılır: dosyalarını başkası değiştirirse inceleyici karışık değişiklik görür. */
export const ACTIVE = "('WORKING','REWORK','REVIEW')";

/** Bu görevle aynı dosyalara dokunan, ortakta bitmemiş bir görev varsa onu döndürür. */
export function conflictingTask(db: DatabaseSync, task: Task, me: Agent): Task | undefined {
  const mine = parsePaths(task.touches);
  if (!mine.length) return undefined;
  return all<Task>(db, `SELECT * FROM tasks WHERE status IN ${ACTIVE} AND owner IS NOT NULL AND owner<>? AND id<>?`, me, task.id)
    .find((t) => overlaps(mine, parsePaths(t.touches)));
}

export const pendingDependencies = (db: DatabaseSync, task: Task): number[] =>
  (JSON.parse(task.depends_on) as number[]).filter((id) =>
    one<{ status: string }>(db, "SELECT status FROM tasks WHERE id=?", id)?.status !== "DONE");

/**
 * after_all kipinde inceleme, başlanabilecek iş kalmayınca açılır. Öncülünü ya da aynı dosyadaki incelemeyi bekleyen iş
 * kapıyı kapalı tutmaz: o inceleme bitmeden başlayamaz, kapı kapalı kalırsa ikisi birbirini bekler.
 */
export const reviewPhaseOpen = (db: DatabaseSync) =>
  reviewMode(db) === "immediate" ||
  (one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE status='WORKING'")!.n === 0 &&
    !all<Task>(db, "SELECT * FROM tasks WHERE status='TODO'").some((t) =>
      !pendingDependencies(db, t).length && !conflictingTask(db, t, t.assignee ?? ("" as Agent))));

export function claimable(db: DatabaseSync, me: Agent, t: Task): string | null {
  if (t.status !== "TODO") return tr("notTodo");
  if (one(db, "SELECT id FROM threads WHERE blocking=1 AND status='OPEN'")) return tr("planOpen");
  const pending = pendingDependencies(db, t);
  if (pending.length) return tr("depsPending", { ids: pending.join(", ") });
  if (t.assignee && t.assignee !== me) return tr("assignedToOther", { who: t.assignee });
  if (!t.assignee && mineCount(db, me) >= quota(db)) return tr("quotaFull", { quota: quota(db) });
  const c = conflictingTask(db, t, me);
  if (c) return tr("fileClash", { id: c.id, owner: c.owner ?? "" });
  return null;
}

// ---- notlar ve tartışmalar -------------------------------------------------
export const kickoffNote = (db: DatabaseSync, a: Agent) =>
  one<Note>(db, "SELECT * FROM notes WHERE kind='kickoff' AND author=? ORDER BY id", a);
export const postsOf = (db: DatabaseSync, threadId: number) =>
  all<Post>(db, "SELECT * FROM posts WHERE thread_id=? ORDER BY id", threadId);

/** Söz sırası takım sırasında döner; kaptan turun sonunda konuşur. Boş açılış tartışmasında ilk sözü kaptandan sonraki işçi alır (kaptan önce eleştiriyi duyar). */
export function nextSpeaker(db: DatabaseSync, th: Thread): Agent {
  const team = teamOf(db);
  const c = team.indexOf(captainOf(db));
  const order = [...team.slice(c + 1), ...team.slice(0, c + 1)];
  const last = one<Post>(db, "SELECT * FROM posts WHERE thread_id=? ORDER BY id DESC", th.id);
  return last ? order[(order.indexOf(last.author) + 1) % order.length] : order[0];
}
export const myTurn = (db: DatabaseSync, th: Thread, me: Agent) => nextSpeaker(db, th) === me;

export function openThread(db: DatabaseSync, o: {
  kind: Thread["kind"]; topic: string; by: Agent; taskId?: number; blocking?: boolean; text?: string;
}): number {
  const id = Number(run(db,
    "INSERT INTO threads(kind, topic, task_id, blocking, opened_by, max_posts) VALUES (?,?,?,?,?,?)",
    o.kind, o.topic, o.taskId ?? null, o.blocking ? 1 : 0, o.by, Math.ceil(MAX_POSTS[o.kind] * teamOf(db).length / 2)).lastInsertRowid);
  if (o.text) run(db, "INSERT INTO posts(thread_id, author, stance, text) VALUES (?,?, 'propose', ?)", id, o.by, o.text);
  return id;
}

/** Mesajı ekler. Son mesajı yazan dışında herkes art arda "agree" derse uzlaşmayla, mesaj sınırı dolarsa ayrışmayla kapatır. */
export function addPost(db: DatabaseSync, th: Thread, me: Agent, stance: Stance, text: string) {
  run(db, "INSERT INTO posts(thread_id, author, stance, text) VALUES (?,?,?,?)", th.id, me, stance, text);
  const posts = postsOf(db, th.id);
  const need = teamOf(db).length - 1;
  const agreed = posts.length >= need && posts.slice(-need).every((p) => p.stance === "agree");
  const n = posts.length;
  const outcome = agreed ? "agreed" : n >= th.max_posts ? "split" : null;
  run(db, "UPDATE threads SET status=?, outcome=?, updated_at=datetime('now') WHERE id=?", outcome ? "CLOSED" : "OPEN", outcome, th.id);
  return { outcome, left: th.max_posts - n };
}

const discuss = (db: DatabaseSync, th: Thread) =>
  ({ action: "DISCUSS", thread: th, key: `${th.id}:${postsOf(db, th.id).length}` });

export function nextAction(db: DatabaseSync, me: Agent): Record<string, any> {
  const captain = captainOf(db);
  if (!teamOf(db).includes(me)) return { action: "WAIT", reason: tr("notInTeam", { team: teamOf(db).join(", ") }) };
  const replying = (th: Thread) => ({ action: "WAIT", reason: tr("partnerReplying", { partner: nextSpeaker(db, th) }) });
  if (total(db) === 0 && !planned(db)) {
    if (kickoffOf(db) !== "solo") {
      if (!kickoffNote(db, me)) return { action: "ANALYZE" };
      const missing = others(db, me).filter((a) => !kickoffNote(db, a));
      if (missing.length) return { action: "WAIT", reason: tr("partnerAnalyzing", { partner: missing.join(", ") }) };
      if (kickoffOf(db) === "cross") {
        const st = crossStage(db);
        if (st.phase !== "consensus") {
          const mine = st.pending.filter((p) => p.agent === me).map((p) => p.claim);
          if (mine.length) {
            return { action: st.phase === "assess" ? "CROSS_REVIEW" : "REBUTTAL", round: st.round, claims: mine, key: `${st.phase}:${st.round}:${mine.join(",")}` };
          }
          return { action: "WAIT", reason: tr(st.phase === "assess" ? "crossAssessing" : "crossRebutting", { who: [...new Set(st.pending.map((p) => p.agent))].join(", ") }) };
        }
        if (!consensusDone(db)) {
          return me === captain ? { action: "CONSENSUS", key: "consensus" } : { action: "WAIT", reason: tr("captainConsensus", { captain }) };
        }
      }
      const th = one<Thread>(db, "SELECT * FROM threads WHERE kind='kickoff' AND status='OPEN'");
      if (th) return myTurn(db, th, me) ? discuss(db, th) : replying(th);
    }
    return me === captain
      ? { action: "PLAN" }
      : { action: "WAIT", reason: tr("captainPlanning", { captain }) };
  }

  const rework = one<Task>(db, "SELECT * FROM tasks WHERE status='REWORK' AND owner=? ORDER BY id", me);
  if (rework) {
    const last = one<{ comment: string }>(db, "SELECT comment FROM reviews WHERE task_id=? ORDER BY id DESC", rework.id);
    return { action: "REWORK", task: rework, reviewerComment: last?.comment };
  }
  const working = one<Task>(db, "SELECT * FROM tasks WHERE status='WORKING' AND owner=? ORDER BY id", me);
  if (working) return { action: "FINISH_WORK", task: working };

  const threads = all<Thread>(db, "SELECT * FROM threads WHERE status='OPEN' ORDER BY blocking DESC, id");
  const turn = threads.find((th) => myTurn(db, th, me));
  if (turn) return discuss(db, turn);
  const blocking = threads.find((th) => th.blocking);
  if (blocking) return replying(blocking);

  const toReview = reviewPhaseOpen(db)
    ? all<Task>(db, "SELECT * FROM tasks WHERE status='REVIEW' AND owner<>? ORDER BY id", me).find((t) => reviewerOf(db, t) === me)
    : undefined;
  const reviewAction = toReview && {
    action: "REVIEW", task: toReview,
  };
  if (reviewAction && reviewMode(db) === "immediate") return reviewAction;

  const todo = all<Task>(db, "SELECT * FROM tasks WHERE status='TODO' ORDER BY id");
  const startable = todo.filter((t) => !claimable(db, me, t));
  const mineFirst = startable.find((t) => t.assignee === me) ?? startable.find((t) => !t.assignee);
  if (mineFirst) {
    return { action: "CLAIM", task: { id: mineFirst.id, title: mineFirst.title } };
  }
  if (reviewAction) return reviewAction;

  const open = all<Task>(db, "SELECT id,status,owner,assignee FROM tasks WHERE status NOT IN ('DONE','DISPUTE')");
  if (!open.length) {
    const alternatives = pendingAlternatives(db);
    if (alternatives.length) {
      return me === captain
        ? { action: "TRIAGE", items: alternatives, key: alternatives.map((r) => r.id).join(",") }
        : { action: "WAIT", reason: tr("captainTriage", { captain }) };
    }
    const disputes = all<Task>(db, "SELECT id,title FROM tasks WHERE status='DISPUTE'");
    return { action: "ALL_DONE", disputes };
  }
  const blocked = todo.find((t) => t.assignee === me);
  return { action: "WAIT", waitingOn: open,
    reason: blocked ? claimable(db, me, blocked) : tr("waitingPartner", { partner: others(db, me).join(", ") }) };
}

/** İnceleyicilerin önerdiği, kaptanın henüz karara bağlamadığı alternatifler (yalnız onaylanmış görevlerde). */
export const pendingAlternatives = (db: DatabaseSync) => all<Review & { title: string; owner: string }>(db,
  `SELECT r.*, t.title, t.owner FROM reviews r JOIN tasks t ON t.id=r.task_id
   WHERE r.alternative IS NOT NULL AND r.triage IS NULL AND t.status='DONE' ORDER BY r.id`);

/**
 * İhtilaf (DISPUTE) son durak olmamalı: karar kullanıcıya aittir.
 *  accept   → görev onaylı sayılır (DONE)
 *  rework   → sahibine kullanıcının talimatıyla geri döner, tur sayacı sıfırlanır
 *  rereview → sahibi zaten düzelttiyse ortak yeniden inceler, tur sayacı sıfırlanır
 */
export type Resolution = "accept" | "rework" | "rereview";
export function resolveDispute(db: DatabaseSync, id: number, decision: Resolution, note = ""): boolean {
  return tx(db, () => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.status !== "DISPUTE") return false;
    const text = note.trim();
    if (decision === "accept") {
      run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment) VALUES (?, 'user', 'approve', ?)", id, text || tr("userAccepted"));
      run(db, "UPDATE tasks SET status='DONE', updated_at=datetime('now') WHERE id=?", id);
      logEvent(db, "user", tr("evAccepted", { id }));
    } else if (decision === "rework") {
      run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment) VALUES (?, 'user', 'request_changes', ?)", id, tr("userDecision") + (text || tr("userDecisionDefault")));
      run(db, "UPDATE tasks SET status='REWORK', rounds=0, updated_at=datetime('now') WHERE id=?", id);
      logEvent(db, "user", tr("evResolved", { id, owner: t.owner ?? "" }));
    } else {
      run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment) VALUES (?, 'user', 'reopen', ?)", id, tr("userReopen") + (text || tr("userReopenDefault")));
      run(db, "UPDATE tasks SET status='REVIEW', rounds=0, updated_at=datetime('now') WHERE id=?", id);
      logEvent(db, "user", tr("evReopened", { id }));
    }
    return true;
  });
}

const trunc = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").slice(0, n);

/**
 * Ajana giden cevabı küçültür: yalnız karar için gereken alanlar. Hatırlatma metni yok (kurallar protokolde).
 * Görev tarifi (spec) bir oturumda bir kez gönderilir; `delivered` oturum boyunca hatırlanır.
 */
export function compact(db: DatabaseSync, a: Record<string, any>, delivered: Set<number | string>, me?: Agent): Record<string, any> {
  const t = a.task as (Partial<Task> & { id: number; title: string }) | undefined;
  const once = <T extends { id: number }>(prefix: string, rows: T[]) =>
    rows.filter((r) => !delivered.has(prefix + r.id) && delivered.add(prefix + r.id));
  /** Ortakların açılış notları ve henüz görmediğim mesajlar (her biri oturumda bir kez). */
  const talk = (th: Thread | undefined) => {
    if (!th || !me) return {};
    const theirs = th.kind === "kickoff" ? others(db, me).map((a) => kickoffNote(db, a)).filter((n): n is Note => !!n) : [];
    const notes = once("n", theirs).map((n) => ({ by: n.author, text: n.text }));
    const posts = once("p", postsOf(db, th.id).filter((p) => p.author !== me)).map((p) => ({ by: p.author, stance: p.stance, text: p.text }));
    return { notes: notes.length ? notes : undefined, posts: posts.length ? posts : undefined };
  };
  /** Görev tarifi ve kabul kriterleri, oturumda bir kez. */
  const spec = (id: number) => {
    if (delivered.has(id)) return {};
    delivered.add(id);
    const row = one<{ description: string; acceptance: string }>(db, "SELECT description, acceptance FROM tasks WHERE id=?", id);
    const acceptance = JSON.parse(row?.acceptance ?? "[]") as string[];
    return { spec: row?.description || undefined, acceptance: acceptance.length ? acceptance : undefined };
  };
  switch (a.action) {
    case "WAIT": return { action: "WAIT", why: a.reason };
    case "CLAIM": return { action: "CLAIM", id: t!.id, title: t!.title };
    case "FINISH_WORK": return { action: "FINISH_WORK", id: t!.id, title: t!.title, ...spec(t!.id) };
    case "REWORK": return { action: "REWORK", id: t!.id, title: t!.title, fix: a.reviewerComment, ...spec(t!.id) };
    case "REVIEW": return { action: "REVIEW", ...reviewPacket(db, t!.id), ...spec(t!.id) };
    case "TRIAGE": return { action: "TRIAGE",
      items: (a.items as ReturnType<typeof pendingAlternatives>).map((r) => ({ review: r.id, task: r.task_id, title: r.title, owner: r.owner, by: r.reviewer, text: r.alternative })) };
    case "ALL_DONE": return { action: "ALL_DONE", disputes: (a.disputes ?? []).map((d: any) => d.id) };
    case "ANALYZE": return { action: "ANALYZE" };
    case "DISCUSS": {
      const th = a.thread as Thread;
      return { action: "DISCUSS", thread: th.id, kind: th.kind, topic: th.topic, task: th.task_id ?? undefined,
        ...talk(th), left: th.max_posts - postsOf(db, th.id).length };
    }
    case "PLAN": {
      const th = one<Thread>(db, "SELECT * FROM threads WHERE kind='kickoff' ORDER BY id DESC");
      const decided = once("d", all<Decision>(db, "SELECT * FROM decisions ORDER BY id")).map(decisionOut);
      return { action: "PLAN", outcome: th?.outcome ?? undefined, ...talk(th), consensus: decided.length ? decided : undefined };
    }
    case "CROSS_REVIEW": case "REBUTTAL": case "CONSENSUS": {
      if (!me) return { action: a.action };
      const sent: string[] = [];
      const book = ledger(db);
      const byId = new Map(book.map((c) => [c.id, c]));
      const pick = ((a.claims ?? []) as number[]).map((id) => byId.get("C" + id)!);
      if (a.action === "CONSENSUS") {
        for (const c of book) sent.push(c.id, ...c.assessments.map((x) => x.id), ...c.rebuttals.map((x) => x.id));
        deliver(db, me, sent);
        return { action: "CONSENSUS", claims: book };
      }
      if (a.action === "REBUTTAL") {
        const items = pick.map((c) => {
          const objections = c.assessments.filter((x) => x.round === a.round && x.verdict !== "agree");
          sent.push(...objections.map((x) => x.id));
          return { id: c.id, text: c.text, objections: objections.map(({ id, by, verdict, text, evidence }) => ({ id, by, verdict, text, evidence })) };
        });
        deliver(db, me, sent);
        return { action: "REBUTTAL", round: a.round, claims: items };
      }
      // CROSS_REVIEW: 1. turda ortakların tam notları (oturumda bir kez) ve iddiaları; sonraki turlarda savunma ve önceki hükmüm.
      const theirs = a.round === 1 ? once("n", others(db, me).map((x) => kickoffNote(db, x)).filter((n): n is Note => !!n)) : [];
      sent.push(...theirs.map((n) => "N" + n.id));
      const items = pick.map((c) => {
        sent.push(c.id);
        if (a.round === 1) return { id: c.id, by: c.by, text: c.text, evidence: c.evidence };
        const rebuttal = c.rebuttals.find((r) => r.round === a.round - 1)!;
        const yours = [...c.assessments].reverse().find((x) => x.by === me && x.round < a.round);
        sent.push(rebuttal.id);
        return { id: c.id, by: c.by, text: c.text, rebuttal: { id: rebuttal.id, action: rebuttal.action, text: rebuttal.text, evidence: rebuttal.evidence },
          yours: yours && { id: yours.id, verdict: yours.verdict, text: yours.text } };
      });
      deliver(db, me, sent);
      return { action: "CROSS_REVIEW", round: a.round, notes: theirs.length ? theirs.map((n) => ({ id: "N" + n.id, by: n.author, text: n.text })) : undefined, claims: items };
    }
    default: return { action: a.action };
  }
}

export const DIFF_LIMIT = 12000;
/** İnceleyiciye giden kanıt: görevin kendi diff'i (üstlenme ile gönderim arası), doğrulama sonucu, sahipsiz değişiklikler. */
export function reviewPacket(db: DatabaseSync, id: number) {
  const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id)!;
  let files: string[] = []; try { files = JSON.parse(t.files ?? "[]"); } catch {}
  const diff = t.diff ?? "";
  const unclaimed = JSON.parse(t.unclaimed ?? "[]") as string[];
  return {
    id: t.id, title: t.title, by: t.owner, summary: t.summary, files,
    diff: diff ? diff.slice(0, DIFF_LIMIT) : undefined,
    truncated: diff.length > DIFF_LIMIT ? `git diff ${t.base} ${t.head}` : undefined,
    unclaimed: unclaimed.length ? unclaimed : undefined,
    verify: t.verify ? JSON.parse(t.verify) : undefined,
  };
}

/** Arayüzdeki görev ayrıntısı: tarif, kriterler, kanıt paketi ve inceleme geçmişi. Görev yoksa null. */
export function taskDetail(db: DatabaseSync, id: number) {
  const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
  if (!t) return null;
  const list = (s: string | null) => { try { return JSON.parse(s ?? "[]") as any[]; } catch { return []; } };
  const p = reviewPacket(db, id);
  return {
    id: t.id, title: t.title, status: t.status, owner: t.owner, assignee: t.assignee, rounds: t.rounds,
    reviewer: t.owner ? reviewerOf(db, t) : null,
    description: t.description, acceptance: list(t.acceptance) as string[], touches: list(t.touches) as string[],
    depends_on: list(t.depends_on) as number[], summary: t.summary, files: p.files,
    diff: p.diff ?? "", truncated: p.truncated, unclaimed: p.unclaimed ?? [], verify: p.verify ?? null,
    reviews: all<Review>(db, "SELECT * FROM reviews WHERE task_id=? ORDER BY id", id).map((r) => ({
      reviewer: r.reviewer, verdict: r.verdict, comment: r.comment, checks: list(r.checks), alternative: r.alternative ?? null })),
  };
}

/** Hakemin tekrar dürtmeyi karar vermesi için durum imzası. */
export const signature = (a: Record<string, any>) =>
  `${a.action}:${a.task?.id ?? a.key ?? ""}:${a.task?.status ?? ""}:${a.task?.updated_at ?? ""}`;

/** Oturumun ilk next_action cevabına eklenen kurallar: rol, talimat, döngü, üslup. Terminale uzun metin yapıştırmamak için buradan gider. */
export function briefing(db: DatabaseSync, me: Agent): string {
  const captain = captainOf(db);
  const brief = getMeta(db, "brief", "");
  return [
    tr(me === captain ? "roleCaptain" : "roleWorker", { captain }),
    tr("teamLine", { team: teamOf(db).join(", ") }),
    brief && tr("briefLine", { brief }),
    tr("loop"),
    tr(({ joint: "loopJoint", cross: "loopCross", solo: "loopSolo" } as const)[kickoffOf(db)] ?? "loopSolo"),
    tr(reviewMode(db) === "immediate" ? "reviewNow" : "reviewLater"),
    tr(({ off: "subOff", scoped: "subScoped" } as const)[subagentsOf(db) as "off" | "scoped"] ?? "subResearch"),
    subagentsOf(db) !== "off" && tr("subRules"),
    tr("style"),
  ].filter(Boolean).join(" ");
}

/** Arayüz ve dışa aktarma için: tüm notlar, tartışmalar ve çapraz inceleme kaydı (iddialar, kararlar, teslimler). */
export function discussion(db: DatabaseSync) {
  return {
    claims: ledger(db),
    decisions: all<Decision>(db, "SELECT * FROM decisions ORDER BY id").map(decisionOut),
    deliveries: all<{ recipient: string; item: string; created_at: string }>(db, "SELECT recipient, item, created_at FROM deliveries ORDER BY id"),
    notes: all<Note & { created_at: string }>(db, "SELECT * FROM notes ORDER BY id"),
    threads: all<Thread & { updated_at: string }>(db, "SELECT * FROM threads ORDER BY id")
      .map((th) => ({ ...th, posts: all<Post & { created_at: string }>(db, "SELECT * FROM posts WHERE thread_id=? ORDER BY id", th.id) })),
  };
}

// ---- çapraz inceleme ------------------------------------------------------
// Kimlikler önekli gider: N (not), C (iddia), A (hüküm), R (savunma), D (karar). Araçlar sayıyı ya da önekli biçimi kabul eder.
export type Verdict = "agree" | "disagree" | "unsure" | "alternative";
export type Claim = { id: number; note_id: number; author: Agent; text: string; original: string; evidence: string };
export type Assessment = { id: number; claim_id: number; reviewer: Agent; round: number; verdict: Verdict; text: string; evidence: string; reply_to: number | null };
export type Rebuttal = { id: number; claim_id: number; author: Agent; round: number; action: "defend" | "revise" | "withdraw"; text: string; evidence: string; reply_to: string };
export type Decision = { id: number; kind: string; claim_id: number | null; text: string; refs: string; author: Agent };
export type CrossStage =
  | { phase: "assess" | "rebut"; round: number; pending: { claim: number; agent: Agent }[] }
  | { phase: "consensus" };

/** Geçerli açılışın iddiaları (pano yeniden başlatılınca eski açılış notları "note" olur, iddiaları da düşer). */
export const claimsOf = (db: DatabaseSync) =>
  all<Claim>(db, "SELECT c.* FROM claims c JOIN notes n ON n.id=c.note_id WHERE n.kind='kickoff' ORDER BY c.id");
const crossRows = (db: DatabaseSync) => {
  const claims = claimsOf(db);
  const ids = new Set(claims.map((c) => c.id));
  return {
    claims,
    as: all<Assessment>(db, "SELECT * FROM assessments ORDER BY id").filter((x) => ids.has(x.claim_id)),
    rb: all<Rebuttal>(db, "SELECT * FROM rebuttals ORDER BY id").filter((x) => ids.has(x.claim_id)),
  };
};
export const consensusDone = (db: DatabaseSync) => getMeta(db, "consensus", "0") === "1";
export const deliver = (db: DatabaseSync, to: Agent, items: string[]) => {
  for (const item of items) run(db, "INSERT OR IGNORE INTO deliveries(recipient, item) VALUES (?,?)", to, item);
};
export const wasDelivered = (db: DatabaseSync, to: Agent, item: string) =>
  !!one(db, "SELECT 1 FROM deliveries WHERE recipient=? AND item=?", to, item);

/**
 * Çapraz incelemenin sıradaki aşaması. 1. tur: her ajan ortaklarının her iddiasına hüküm verir.
 * Katılmayan, emin olmayan ya da alternatif öneren biri varsa iddia itirazlıdır ve sahibine savunmaya döner;
 * itirazsız iddiaya ek tur açılmaz. Savunmadan sonra yalnız itiraz edenler (iddia değiştiyse tüm ortaklar) yeniden hükmeder.
 * MAX_CROSS_ROUNDS'tan sonra savunma istenmez: kalan ayrılık kaptanın kararına "çözülemedi" olarak gider.
 */
export function crossStage(db: DatabaseSync): CrossStage {
  const team = teamOf(db);
  const { claims, as, rb } = crossRows(db);
  const verdict = (c: number, a: Agent, r: number) => as.find((x) => x.claim_id === c && x.reviewer === a && x.round === r)?.verdict;
  let targets = claims.flatMap((c) => team.filter((a) => a !== c.author).map((agent) => ({ claim: c.id, agent })));
  for (let round = 1; targets.length; round++) {
    const missing = targets.filter((t) => !verdict(t.claim, t.agent, round));
    if (missing.length) return { phase: "assess", round, pending: missing };
    if (round >= MAX_CROSS_ROUNDS) break;
    const contested = claims.filter((c) => targets.some((t) => t.claim === c.id && verdict(c.id, t.agent, round) !== "agree"));
    const unanswered = contested.filter((c) => !rb.some((r) => r.claim_id === c.id && r.round === round));
    if (unanswered.length) return { phase: "rebut", round, pending: unanswered.map((c) => ({ claim: c.id, agent: c.author })) };
    targets = contested.flatMap((c) => {
      const r = rb.find((x) => x.claim_id === c.id && x.round === round)!;
      if (r.action === "withdraw") return [];
      if (r.action === "revise") return team.filter((a) => a !== c.author).map((agent) => ({ claim: c.id, agent }));
      return targets.filter((t) => t.claim === c.id && verdict(c.id, t.agent, round) !== "agree");
    });
  }
  return { phase: "consensus" };
}

/** İddianın son durumu: her ortağın en son hükmüne göre. */
function claimStatus(c: Claim, as: Assessment[], rb: Rebuttal[]) {
  if (rb.some((r) => r.claim_id === c.id && r.action === "withdraw")) return "withdrawn";
  const latest = new Map<string, Verdict>();
  for (const x of as) if (x.claim_id === c.id) latest.set(x.reviewer, x.verdict);
  const v = [...latest.values()];
  if (!v.length) return "pending";
  return v.some((x) => x === "disagree" || x === "alternative") ? "contested" : v.includes("unsure") ? "unverified" : "agreed";
}

/** Tüm iddialar, hükümler ve savunmalar; kimlikler önekli. */
export function ledger(db: DatabaseSync) {
  const { claims, as, rb } = crossRows(db);
  return claims.map((c) => ({
    id: "C" + c.id, by: c.author, text: c.text, original: c.original !== c.text ? c.original : undefined, evidence: c.evidence || undefined,
    status: claimStatus(c, as, rb),
    assessments: as.filter((x) => x.claim_id === c.id).map((x) => ({
      id: "A" + x.id, by: x.reviewer, round: x.round, verdict: x.verdict, text: x.text, evidence: x.evidence || undefined,
      reply_to: x.reply_to ? "R" + x.reply_to : undefined })),
    rebuttals: rb.filter((x) => x.claim_id === c.id).map((x) => ({
      id: "R" + x.id, round: x.round, action: x.action, text: x.text, evidence: x.evidence || undefined,
      reply_to: (JSON.parse(x.reply_to) as number[]).map((i) => "A" + i) })),
  }));
}

export const decisionOut = (d: Decision) =>
  ({ id: "D" + d.id, kind: d.kind, claim: d.claim_id ? "C" + d.claim_id : undefined, text: d.text, refs: JSON.parse(d.refs) as string[] });

/** "C12", "c12" ya da 12 → 12; önek tutmazsa NaN. */
export function refId(v: number | string, prefix: string) {
  if (typeof v === "number") return v;
  const m = new RegExp(`^${prefix}?(\\d+)$`, "i").exec(v.trim());
  return m ? Number(m[1]) : NaN;
}
