// Takım akışı kuralları. Hem MCP sunucusu hem uygulamadaki hakem bunu kullanır.
import type { DatabaseSync } from "node:sqlite";
import { AGENTS, other, type Agent } from "./db.js";
import { t as tr } from "./i18n.js";

export type Task = {
  id: number; title: string; description: string; status: string;
  assignee: Agent | null; owner: Agent | null; touches: string; summary: string | null;
  files: string | null; rounds: number; updated_at: string;
};
export type ReviewMode = "after_all" | "immediate";

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
export const reviewMode = (db: DatabaseSync) => getMeta(db, "review_mode", "after_all") as ReviewMode;

export const total = (db: DatabaseSync) => one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks")!.n;
export const quota = (db: DatabaseSync) => Math.ceil(total(db) / AGENTS.length);
/** Bana atanmış ya da benim üstlendiğim görev sayısı. */
export const mineCount = (db: DatabaseSync, a: Agent) =>
  one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE owner=? OR assignee=?", a, a)!.n;

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
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

/** "after_all" kipinde inceleme, tüm işler (TODO/WORKING) bitince açılır. */
export const reviewPhaseOpen = (db: DatabaseSync) =>
  reviewMode(db) === "immediate" ||
  one<{ n: number }>(db, "SELECT COUNT(*) n FROM tasks WHERE status IN ('TODO','WORKING')")!.n === 0;

export function claimable(db: DatabaseSync, me: Agent, t: Task): string | null {
  if (t.status !== "TODO") return tr("notTodo");
  if (t.assignee && t.assignee !== me) return tr("assignedToOther", { who: t.assignee });
  if (!t.assignee && mineCount(db, me) >= quota(db)) return tr("quotaFull", { quota: quota(db) });
  const c = conflictingTask(db, t, me);
  if (c) return tr("fileClash", { id: c.id, owner: c.owner ?? "" });
  return null;
}

export function nextAction(db: DatabaseSync, me: Agent): Record<string, any> {
  const captain = captainOf(db);
  if (total(db) === 0) {
    return me === captain
      ? { action: "PLAN", hint: tr("planHint") }
      : { action: "WAIT", reason: tr("captainPlanning", { captain }) };
  }

  const rework = one<Task>(db, "SELECT * FROM tasks WHERE status='REWORK' AND owner=? ORDER BY id", me);
  if (rework) {
    const last = one<{ comment: string }>(db, "SELECT comment FROM reviews WHERE task_id=? ORDER BY id DESC", rework.id);
    return { action: "REWORK", task: rework, reviewerComment: last?.comment, hint: tr("reworkHint") };
  }
  const working = one<Task>(db, "SELECT * FROM tasks WHERE status='WORKING' AND owner=? ORDER BY id", me);
  if (working) return { action: "FINISH_WORK", task: working, hint: tr("finishHint") };

  const toReview = reviewPhaseOpen(db)
    ? one<Task>(db, "SELECT * FROM tasks WHERE status='REVIEW' AND owner<>? ORDER BY id", me)
    : undefined;
  const reviewAction = toReview && {
    action: "REVIEW", task: toReview,
    hint: tr("reviewHint"),
  };
  if (reviewAction && reviewMode(db) === "immediate") return reviewAction;

  const todo = all<Task>(db, "SELECT * FROM tasks WHERE status='TODO' ORDER BY id");
  const startable = todo.filter((t) => !claimable(db, me, t));
  const mineFirst = startable.find((t) => t.assignee === me) ?? startable.find((t) => !t.assignee);
  if (mineFirst) {
    return { action: "CLAIM", task: { id: mineFirst.id, title: mineFirst.title },
      hint: tr("claimHint", { id: mineFirst.id }) };
  }
  if (reviewAction) return reviewAction;

  const open = all<Task>(db, "SELECT id,status,owner,assignee FROM tasks WHERE status NOT IN ('DONE','DISPUTE')");
  if (!open.length) {
    const disputes = all<Task>(db, "SELECT id,title FROM tasks WHERE status='DISPUTE'");
    return { action: "ALL_DONE", disputes, hint: disputes.length
      ? tr("disputesHint") : tr("allApprovedHint") };
  }
  const blocked = todo.find((t) => t.assignee === me);
  return { action: "WAIT", waitingOn: open,
    reason: blocked ? claimable(db, me, blocked) : tr("waitingPartner", { partner: other(me) }),
    hint: tr("waitHint") };
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
export function compact(db: DatabaseSync, a: Record<string, any>, delivered: Set<number>): Record<string, any> {
  const t = a.task as (Partial<Task> & { id: number; title: string }) | undefined;
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
    default: return { action: a.action };
  }
}

/** Hakemin tekrar dürtmeyi karar vermesi için durum imzası. */
export const signature = (a: Record<string, any>) =>
  `${a.action}:${a.task?.id ?? ""}:${a.task?.status ?? ""}:${a.task?.updated_at ?? ""}`;
