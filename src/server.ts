#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { openDb, other, AGENTS, MAX_REVIEW_ROUNDS, MAX_OPEN_THREADS, type Agent } from "./db.js";
import { t as tr } from "./i18n.js";
import {
  all, one, run, tx, logEvent, captainOf, reviewMode, reviewPhaseOpen, quota,
  claimable, nextAction, compact, briefing, kickoffOf, planned, total, setMeta, kickoffNote, postsOf, myTurn,
  openThread, addPost, type Task, type Thread,
} from "./flow.js";

const me = process.env.AGENT_ID as Agent | undefined;
if (!me || !AGENTS.includes(me)) {
  console.error(tr("needAgentId"));
  process.exit(1);
}
if (!process.env.DUOREVIEW_DIR) {
  console.error(tr("needDataDir"));
  process.exit(1);
}
const db = openDb(process.env.DUOREVIEW_DIR);
const partner = other(me);
const delivered = new Set<number | string>(); // bu oturumda gönderilen görev tarifleri, notlar, mesajlar (süreç = ajan oturumu)
let briefed = false; // kurallar oturumun ilk next_action cevabıyla bir kez gider

// Cevaplar tek satır JSON: girinti ve boş alan token harcar.
const reply = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
});
const fail = (msg: string) => ({ ...reply(`${tr("errPrefix")}: ${msg}`), isError: true });
const log = (text: string) => logEvent(db, me, text);

function claim(t: Task) {
  run(db, "UPDATE tasks SET status='WORKING', owner=?, updated_at=datetime('now') WHERE id=?", me, t.id);
  log(tr("evStarted", { id: t.id, title: t.title }));
  delivered.add(t.id);
  return { id: t.id, title: t.title, spec: t.description, touches: JSON.parse(t.touches) };
}
/** Sıradaki adım. CLAIM ise görevi burada üstlenir; flow.nextAction saf kalır (hakem de onu çağırır). */
const next = (): Record<string, any> => tx(db, () => {
  const a = nextAction(db, me);
  if (a.action !== "CLAIM") return compact(db, a, delivered, me);
  return { action: "FINISH_WORK", ...claim(one<Task>(db, "SELECT * FROM tasks WHERE id=?", a.task.id)!) };
});
/** Başarılı mutasyonun cevabı sıradaki adımı da taşır: ajan ayrıca next_action çağırmaz. */
const done = (data: Record<string, any> = {}) => reply({ ...data, next: next() });
/** tx içinden dönen sonuç: hata ise olduğu gibi, değilse commit sonrası next eklenerek. */
const chain = (r: ReturnType<typeof fail> | Record<string, any>) => ("isError" in r ? r as ReturnType<typeof fail> : done(r));

// Sürümün tek kaynağı package.json (dist/ bir üst klasörde).
const version = (() => {
  try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string; }
  catch { return "0.0.0"; }
})();
const server = new McpServer({ name: "duoreview", version });

// Ajan başına sayaç (meta tablosu): araç çağrısı sayısı, giden ve gelen karakter. Token değildir.
const bump = (key: string, n: number) => run(db,
  "INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+excluded.value", `${key}:${me}`, String(n));
const tool = ((...args: any[]) => {
  const handler = args.pop();
  return (server.tool as any)(...args, async (input: unknown, extra: unknown) => {
    const r = await handler(input, extra);
    bump("calls", 1);
    bump("chars_in", JSON.stringify(input ?? {}).length);
    bump("chars_out", r.content[0].text.length);
    return r;
  });
}) as typeof server.tool;

tool("next_action", tr("dNextAction"), {},
  async () => {
    const a = next();
    if (briefed) return reply(a);
    briefed = true;
    return reply({ ...a, rules: briefing(db, me) });
  });

tool(
  "post_tasks",
  tr("dPostTasks"),
  {
    tasks: z.array(z.object({
      title: z.string(),
      description: z.string().default(""),
      touches: z.array(z.string()).default([]),
      assignee: z.enum(["claude", "codex"]).optional(),
      depends_on: z.array(z.number()).default([]),
    })),
  },
  async ({ tasks }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptain", { captain: captainOf(db) }));
    const joint = kickoffOf(db) === "joint";
    const first = total(db) === 0 && !planned(db);
    if (joint && first && nextAction(db, me).action !== "PLAN") return fail(tr("kickoffFirst"));
    const missing = [...new Set(tasks.flatMap((t) => t.depends_on))].filter((id) => !one(db, "SELECT id FROM tasks WHERE id=?", id));
    if (missing.length) return fail(tr("badDeps", { ids: missing.join(", ") }));
    const { ids, per } = tx(db, () => {
      const ids = tasks.map((t) => Number(run(db, "INSERT INTO tasks(title, description, touches, assignee, depends_on) VALUES (?,?,?,?,?)",
        t.title, t.description, JSON.stringify(t.touches), t.assignee ?? null, JSON.stringify(t.depends_on)).lastInsertRowid));
      setMeta(db, "planned", "1");
      const per = Object.fromEntries(AGENTS.map((a) => [a, all<Task>(db, "SELECT id FROM tasks WHERE assignee=?", a).length]));
      // Ortak kipte ilk plan ortağın onayından geçer: iş bölümü tek kişinin kararı olmasın.
      if (joint && first && tasks.length) {
        const lines = tasks.map((t, i) => `#${ids[i]} ${t.title} → ${t.assignee ?? "?"}${t.touches.length ? ` [${t.touches.join(", ")}]` : ""}${t.depends_on.length ? ` ← ${t.depends_on.map((d) => "#" + d).join(" ")}` : ""}`);
        openThread(db, { kind: "plan", topic: tr("topicPlan"), by: me, blocking: true, text: [...lines, tr("planDetail")].join("\n") });
      }
      return { ids, per };
    });
    log(tasks.length ? tr("evTasksAdded", { n: tasks.length }) : tr("evNoTasks"));
    const uneven = Math.abs(per.claude - per.codex) > 1;
    return done({ ids, per, quota: quota(db), warn: uneven ? tr("unbalanced", { split: `claude ${per.claude}, codex ${per.codex}` }) : undefined });
  },
);

tool("drop_task", tr("dDropTask"), { id: z.number() }, async ({ id }) => {
  if (captainOf(db) !== me) return fail(tr("onlyCaptainShort"));
  if (one(db, "SELECT 1 FROM tasks t, json_each(t.depends_on) d WHERE d.value=?", id)) return fail(tr("isDependency", { id }));
  if (!run(db, "DELETE FROM tasks WHERE id=? AND status='TODO'", id).changes) return fail(tr("notTodoOrMissing"));
  log(tr("evDropped", { id }));
  return reply("ok");
});

tool("assign_task", tr("dAssignTask"),
  { id: z.number(), assignee: z.enum(["claude", "codex"]) },
  async ({ id, assignee }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptainShort"));
    const r = run(db, "UPDATE tasks SET assignee=?, updated_at=datetime('now') WHERE id=? AND status='TODO'", assignee, id);
    if (!r.changes) return fail(tr("notTodoOrMissing"));
    log(tr("evAssigned", { id, who: assignee }));
    return reply("ok");
  },
);

tool("status", tr("dStatus"),
  { detail: z.boolean().optional(), id: z.number().optional() },
  async ({ detail, id }) => {
    if (id !== undefined) {
      const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
      if (!t) return fail(tr("noTask"));
      const last = one<{ reviewer: string; verdict: string; comment: string }>(db,
        "SELECT reviewer,verdict,comment FROM reviews WHERE task_id=? ORDER BY id DESC", id);
      return reply({ id, title: t.title, status: t.status, who: t.owner ?? t.assignee ?? undefined, spec: t.description,
        touches: JSON.parse(t.touches), depends_on: JSON.parse(t.depends_on), summary: t.summary ?? undefined, last });
    }
    const rows = all<Task>(db, "SELECT id,title,status,assignee,owner,rounds,summary FROM tasks ORDER BY id");
    const lines = rows.map((t) => {
      let l = `${t.id}|${t.status}|${t.owner ?? t.assignee ?? "-"}|${t.rounds || ""}|${t.title.slice(0, 50)}`;
      if (detail) {
        l += `|${(t.summary ?? "").replace(/\s+/g, " ").slice(0, 140)}`;
        const r = one<{ reviewer: string; verdict: string; comment: string }>(db,
          "SELECT reviewer,verdict,comment FROM reviews WHERE task_id=? ORDER BY id DESC", t.id);
        if (r) l += `|${tr("lastLabel")}:${r.reviewer}:${r.verdict}:${r.comment.replace(/\s+/g, " ").slice(0, 160)}`;
      }
      return l;
    });
    return reply(`${me}/kaptan:${captainOf(db)}/${reviewMode(db)}\n${tr("colHeader")}\n${lines.join("\n")}`);
  });

tool("claim_task", tr("dClaimTask"),
  { id: z.number() },
  async ({ id }) => tx(db, () => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
    if (!t) return fail(tr("noTask"));
    const why = claimable(db, me, t);
    if (why) return fail(why);
    return reply(claim(t));
  }),
);

tool("submit_task", tr("dSubmitTask"),
  { id: z.number(), summary: z.string(), files: z.array(z.string()).default([]) },
  async ({ id, summary, files }) => {
    const r = run(db,
      "UPDATE tasks SET status='REVIEW', summary=?, files=?, updated_at=datetime('now') WHERE id=? AND owner=? AND status IN ('WORKING','REWORK')",
      summary, JSON.stringify(files), id, me);
    if (!r.changes) return fail(tr("notYours"));
    log(tr("evSubmitted", { id }));
    return done();
  },
);

tool("review_task",
  tr("dReviewTask"),
  {
    id: z.number(),
    verdict: z.enum(["approve", "approve_with_notes", "request_changes"]),
    severity: z.enum(["blocker", "major", "minor"]).optional(),
    comment: z.string(),
  },
  async ({ id, verdict, severity, comment }) => chain(tx(db, () => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.status !== "REVIEW") return fail(tr("notInReview"));
    if (t.owner === me) return fail(tr("ownWork"));
    if (!reviewPhaseOpen(db)) return fail(tr("reviewClosed"));
    if (verdict === "request_changes") {
      if (!comment.trim()) return fail(tr("needReason"));
      if (severity !== "blocker" && severity !== "major") {
        return fail(tr("needSeverity"));
      }
    }
    run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment) VALUES (?,?,?,?)", id, me, verdict, comment);
    if (verdict === "approve" || verdict === "approve_with_notes") {
      run(db, "UPDATE tasks SET status='DONE', updated_at=datetime('now') WHERE id=?", id);
      log(verdict === "approve" ? tr("evApproved", { id }) : tr("evApprovedNotes", { id }));
      return {};
    }
    const rounds = t.rounds + 1;
    const status = rounds >= MAX_REVIEW_ROUNDS ? "DISPUTE" : "REWORK";
    run(db, "UPDATE tasks SET status=?, rounds=?, updated_at=datetime('now') WHERE id=?", status, rounds, id);
    log(tr("evChanges", { id, round: rounds, max: MAX_REVIEW_ROUNDS, dispute: status === "DISPUTE" ? tr("evDisputeSuffix") : "" }));
    return { result: status === "DISPUTE" ? tr("disputeReply") : `REWORK ${rounds}/${MAX_REVIEW_ROUNDS}` };
  })),
);

tool("send_prompt",
  tr("dSendPrompt"),
  { text: z.string().min(1).max(2000) },
  async ({ text }) => {
    run(db, "INSERT INTO messages(sender, recipient, kind, text) VALUES (?,?, 'prompt', ?)", me, partner, text);
    log(tr("evPrompt", { partner, text: text.slice(0, 80) }));
    return reply("ok");
  },
);

tool("read_inbox", tr("dReadInbox"), {}, async () => {
  const msgs = all<{ sender: string; text: string }>(db,
    "SELECT sender,text FROM messages WHERE recipient=? AND read=0 ORDER BY id", me);
  if (msgs.length) run(db, "UPDATE messages SET read=1 WHERE recipient=?", me);
  return reply(msgs);
});

tool("post_note", tr("dPostNote"),
  { text: z.string().min(1).max(12000), title: z.string().max(120).default("") },
  async ({ text, title }) => chain(tx(db, () => {
    const kickoff = kickoffOf(db) === "joint" && total(db) === 0 && !planned(db) && !kickoffNote(db, me);
    run(db, "INSERT INTO notes(author, kind, title, text) VALUES (?,?,?,?)", me, kickoff ? "kickoff" : "note", title, text);
    log(kickoff ? tr("evKickoffNote") : tr("evNote", { title: title || text.slice(0, 60) }));
    if (kickoff && kickoffNote(db, partner)) {
      const id = openThread(db, { kind: "kickoff", topic: tr("topicKickoff"), by: captainOf(db), blocking: true });
      logEvent(db, "app", tr("evKickoffOpen", { id }));
    }
    return {};
  })),
);

tool("discuss", tr("dDiscuss"),
  { thread: z.number(), stance: z.enum(["agree", "object", "propose"]), text: z.string().min(1).max(6000) },
  async ({ thread, stance, text }) => chain(tx(db, () => {
    const th = one<Thread>(db, "SELECT * FROM threads WHERE id=? AND status='OPEN'", thread);
    if (!th) return fail(tr("noThread"));
    if (!myTurn(db, th, me)) return fail(tr("notYourTurn"));
    const r = addPost(db, th, me, stance, text);
    log(tr("evPost", { id: th.id, stance }));
    if (r.outcome) logEvent(db, "app", tr(r.outcome === "agreed" ? "evThreadAgreed" : "evThreadSplit", { id: th.id }));
    return r.outcome ? { result: `CLOSED:${r.outcome}` } : { left: r.left };
  })),
);

tool("open_thread", tr("dOpenThread"),
  { topic: z.string().min(1).max(160), text: z.string().min(1).max(6000), task: z.number().optional() },
  async ({ topic, text, task }) => tx(db, () => {
    const mine = all<Thread>(db, "SELECT id FROM threads WHERE status='OPEN' AND kind='free' AND opened_by=?", me).length;
    if (mine >= MAX_OPEN_THREADS) return fail(tr("tooManyThreads", { n: mine }));
    const id = openThread(db, { kind: "free", topic, by: me, taskId: task, text });
    log(tr("evThreadOpened", { id, topic }));
    return reply({ thread: id });
  }),
);

tool("read_thread", tr("dReadThread"), { id: z.number().optional() }, async ({ id }) => {
  if (id === undefined) {
    return reply(all<Thread>(db, "SELECT * FROM threads ORDER BY id")
      .map((th) => `${th.id}|${th.kind}|${th.outcome ?? th.status}|${th.topic}`).join("\n"));
  }
  const th = one<Thread>(db, "SELECT * FROM threads WHERE id=?", id);
  if (!th) return fail(tr("noThread"));
  const notes = th.kind === "kickoff"
    ? all<{ author: string; text: string }>(db, "SELECT author,text FROM notes WHERE kind='kickoff' ORDER BY id") : undefined;
  return reply({ topic: th.topic, status: th.outcome ?? th.status, notes,
    posts: postsOf(db, th.id).map((p) => ({ by: p.author, stance: p.stance, text: p.text })) });
});

await server.connect(new StdioServerTransport());
