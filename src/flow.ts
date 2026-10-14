// Takım akışı kuralları. Hem MCP sunucusu hem uygulamadaki hakem bunu kullanır.
import type { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { AGENTS, MAX_POSTS, type Agent } from "./db.js";
import { t as tr } from "./i18n.js";

export type Task = {
  id: number; title: string; description: string; status: string;
  assignee: Agent | null; owner: Agent | null; touches: string; summary: string | null;
  files: string | null; rounds: number; updated_at: string; depends_on: string;
};
export type ReviewMode = "after_all" | "immediate";
export type Kickoff = "solo" | "joint";
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
/** Görevin inceleyicisi: takım sırasında sahibinden sonraki ajan (iki kişide ortak, üç kişide döngü). */
export const reviewerOf = (db: DatabaseSync, t: Task): Agent => {
  const team = teamOf(db);
  return team[(team.indexOf(t.owner as Agent) + 1) % team.length];
};
export const reviewMode = (db: DatabaseSync) => getMeta(db, "review_mode", "after_all") as ReviewMode;

/** joint: plan öncesi iki ajan ayrı ayrı inceler, sonra tartışır. solo: yalnız kaptan planlar. */
export const kickoffOf = (db: DatabaseSync) => getMeta(db, "kickoff", "solo") as Kickoff;
/** Kaptan planı yazdı mı (hiç görev çıkmayan analiz/araştırma işlerinde de 1 olur). */
export const planned = (db: DatabaseSync) => getMeta(db, "planned", "0") === "1";

export const total = (db: DatabaseSync) => one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks")!.n;
export const quota = (db: DatabaseSync) => Math.ceil(total(db) / teamOf(db).length);
/** Bana atanmış ya da benim üstlendiğim görev sayısı. */
export const mineCount = (db: DatabaseSync, a: Agent) =>
  one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE owner=? OR assignee=?", a, a)!.n;

const norm = (p: string) => {
  const absolute = resolve(p.replace(/\\/g, "/")).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
};
const parse = (s: string): string[] => { try { return JSON.parse(s).map(norm); } catch { return []; } };
const overlaps = (a: string[], b: string[]) =>
  a.some((x) => b.some((y) => x === y || x.startsWith(y + "/") || y.startsWith(x + "/")));

/** Bu görevle aynı dosyalara dokunan, ortakta yarım kalmış bir görev varsa onu döndürür. */
export function conflictingTask(db: DatabaseSync, task: Task, me: Agent): Task | undefined {
  const mine = parse(task.touches);
  if (!mine.length) return undefined;
  return all<Task>(db, "SELECT * FROM tasks WHERE status IN ('WORKING','REWORK') AND owner IS NOT NULL AND owner<>? AND id<>?", me, task.id)
    .find((t) => overlaps(mine, parse(t.touches)));
}

export const pendingDependencies = (db: DatabaseSync, task: Task): number[] =>
  (JSON.parse(task.depends_on) as number[]).filter((id) =>
    one<{ status: string }>(db, "SELECT status FROM tasks WHERE id=?", id)?.status !== "DONE");

/** Bağımlı işler öncüllerin incelemesini beklerken inceleme kapısını açık tutar. */
export const reviewPhaseOpen = (db: DatabaseSync) =>
  reviewMode(db) === "immediate" ||
  (one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE status='WORKING'")!.n === 0 &&
    !all<Task>(db, "SELECT * FROM tasks WHERE status='TODO'").some((t) => !pendingDependencies(db, t).length));

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
    if (kickoffOf(db) === "joint") {
      if (!kickoffNote(db, me)) return { action: "ANALYZE" };
      const missing = others(db, me).filter((a) => !kickoffNote(db, a));
      if (missing.length) return { action: "WAIT", reason: tr("partnerAnalyzing", { partner: missing.join(", ") }) };
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
    const disputes = all<Task>(db, "SELECT id,title FROM tasks WHERE status='DISPUTE'");
    return { action: "ALL_DONE", disputes };
  }
  const blocked = todo.find((t) => t.assignee === me);
  return { action: "WAIT", waitingOn: open,
    reason: blocked ? claimable(db, me, blocked) : tr("waitingPartner", { partner: others(db, me).join(", ") }) };
}

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
  const spec = (id: number) => {
    if (delivered.has(id)) return undefined;
    delivered.add(id);
    return one<{ description: string }>(db, "SELECT description FROM tasks WHERE id=?", id)?.description || undefined;
  };
  switch (a.action) {
    case "WAIT": return { action: "WAIT", why: a.reason };
    case "CLAIM": return { action: "CLAIM", id: t!.id, title: t!.title };
    case "FINISH_WORK": return { action: "FINISH_WORK", id: t!.id, title: t!.title, spec: spec(t!.id) };
    case "REWORK": return { action: "REWORK", id: t!.id, title: t!.title, fix: a.reviewerComment, spec: spec(t!.id) };
    case "REVIEW": {
      const full = one<Task>(db, "SELECT * FROM tasks WHERE id=?", t!.id)!;
      let files: string[] = []; try { files = JSON.parse(full.files ?? "[]"); } catch {}
      return { action: "REVIEW", id: full.id, title: full.title, by: full.owner, summary: full.summary, files, spec: spec(full.id) };
    }
    case "ALL_DONE": return { action: "ALL_DONE", disputes: (a.disputes ?? []).map((d: any) => d.id) };
    case "ANALYZE": return { action: "ANALYZE" };
    case "DISCUSS": {
      const th = a.thread as Thread;
      return { action: "DISCUSS", thread: th.id, kind: th.kind, topic: th.topic, task: th.task_id ?? undefined,
        ...talk(th), left: th.max_posts - postsOf(db, th.id).length };
    }
    case "PLAN": {
      const th = one<Thread>(db, "SELECT * FROM threads WHERE kind='kickoff' ORDER BY id DESC");
      return { action: "PLAN", outcome: th?.outcome ?? undefined, ...talk(th) };
    }
    default: return { action: a.action };
  }
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
    tr(kickoffOf(db) === "joint" ? "loopJoint" : "loopSolo"),
    tr(reviewMode(db) === "immediate" ? "reviewNow" : "reviewLater"),
    tr("style"),
  ].filter(Boolean).join(" ");
}

/** Arayüz ve dışa aktarma için: tüm notlar ve tartışmalar. */
export function discussion(db: DatabaseSync) {
  return {
    notes: all<Note & { created_at: string }>(db, "SELECT * FROM notes ORDER BY id"),
    threads: all<Thread & { updated_at: string }>(db, "SELECT * FROM threads ORDER BY id")
      .map((th) => ({ ...th, posts: all<Post & { created_at: string }>(db, "SELECT * FROM posts WHERE thread_id=? ORDER BY id", th.id) })),
  };
}
