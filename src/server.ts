#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { openDb, other, AGENTS, MAX_REVIEW_ROUNDS, type Agent } from "./db.js";
import { t as tr } from "./i18n.js";
import {
  all, one, run, tx, logEvent, captainOf, reviewMode, reviewPhaseOpen, quota,
  claimable, nextAction, compact, type Task,
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
const delivered = new Set<number>(); // bu oturumda tarifi gönderilen görevler (süreç = ajan oturumu)

// Cevaplar tek satır JSON: girinti ve boş alan token harcar.
const reply = (data: unknown) => ({
  content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data) }],
});
const fail = (msg: string) => ({ ...reply(`${tr("errPrefix")}: ${msg}`), isError: true });
const log = (text: string) => logEvent(db, me, text);

// Sürümün tek kaynağı package.json (dist/ bir üst klasörde).
const version = (() => {
  try { return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string; }
  catch { return "0.0.0"; }
})();
const server = new McpServer({ name: "duoreview", version });

server.tool("next_action", tr("dNextAction"), {},
  async () => reply(compact(db, nextAction(db, me), delivered)));

server.tool(
  "post_tasks",
  tr("dPostTasks"),
  {
    tasks: z.array(z.object({
      title: z.string(),
      description: z.string().default(""),
      touches: z.array(z.string()).default([]),
      assignee: z.enum(["claude", "codex"]).optional(),
    })).min(1),
  },
  async ({ tasks }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptain", { captain: captainOf(db) }));
    tx(db, () => tasks.forEach((t) =>
      run(db, "INSERT INTO tasks(title, description, touches, assignee) VALUES (?,?,?,?)",
        t.title, t.description, JSON.stringify(t.touches), t.assignee ?? null)));
    log(tr("evTasksAdded", { n: tasks.length }));
    const per = Object.fromEntries(AGENTS.map((a) => [a, all<Task>(db, "SELECT id FROM tasks WHERE assignee=?", a).length]));
    return reply({ added: tasks.length, per, quota: quota(db) });
  },
);

server.tool("assign_task", tr("dAssignTask"),
  { id: z.number(), assignee: z.enum(["claude", "codex"]) },
  async ({ id, assignee }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptainShort"));
    const r = run(db, "UPDATE tasks SET assignee=?, updated_at=datetime('now') WHERE id=? AND status='TODO'", assignee, id);
    if (!r.changes) return fail(tr("notTodoOrMissing"));
    log(tr("evAssigned", { id, who: assignee }));
    return reply("ok");
  },
);

server.tool("status", tr("dStatus"),
  { detail: z.boolean().optional() },
  async ({ detail }) => {
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

server.tool("claim_task", tr("dClaimTask"),
  { id: z.number() },
  async ({ id }) => tx(db, () => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
    if (!t) return fail(tr("noTask"));
    const why = claimable(db, me, t);
    if (why) return fail(why);
    run(db, "UPDATE tasks SET status='WORKING', owner=?, updated_at=datetime('now') WHERE id=?", me, id);
    log(tr("evStarted", { id, title: t.title }));
    delivered.add(id);
    return reply({ id, title: t.title, spec: t.description, touches: JSON.parse(t.touches) });
  }),
);

server.tool("submit_task", tr("dSubmitTask"),
  { id: z.number(), summary: z.string(), files: z.array(z.string()).default([]) },
  async ({ id, summary, files }) => {
    const r = run(db,
      "UPDATE tasks SET status='REVIEW', summary=?, files=?, updated_at=datetime('now') WHERE id=? AND owner=? AND status IN ('WORKING','REWORK')",
      summary, JSON.stringify(files), id, me);
    if (!r.changes) return fail(tr("notYours"));
    log(tr("evSubmitted", { id }));
    return reply("ok");
  },
);

server.tool("review_task",
  tr("dReviewTask"),
  {
    id: z.number(),
    verdict: z.enum(["approve", "approve_with_notes", "request_changes"]),
    severity: z.enum(["blocker", "major", "minor"]).optional(),
    comment: z.string(),
  },
  async ({ id, verdict, severity, comment }) => tx(db, () => {
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
      return reply("ok");
    }
    const rounds = t.rounds + 1;
    const status = rounds >= MAX_REVIEW_ROUNDS ? "DISPUTE" : "REWORK";
    run(db, "UPDATE tasks SET status=?, rounds=?, updated_at=datetime('now') WHERE id=?", status, rounds, id);
    log(tr("evChanges", { id, round: rounds, max: MAX_REVIEW_ROUNDS, dispute: status === "DISPUTE" ? tr("evDisputeSuffix") : "" }));
    return reply(status === "DISPUTE" ? tr("disputeReply") : `REWORK ${rounds}/${MAX_REVIEW_ROUNDS}`);
  }),
);

server.tool("send_prompt",
  tr("dSendPrompt"),
  { text: z.string().min(1).max(2000) },
  async ({ text }) => {
    run(db, "INSERT INTO messages(sender, recipient, kind, text) VALUES (?,?, 'prompt', ?)", me, partner, text);
    log(tr("evPrompt", { partner, text: text.slice(0, 80) }));
    return reply("ok");
  },
);

server.tool("read_inbox", tr("dReadInbox"), {}, async () => {
  const msgs = all<{ sender: string; text: string }>(db,
    "SELECT sender,text FROM messages WHERE recipient=? AND read=0 ORDER BY id", me);
  if (msgs.length) run(db, "UPDATE messages SET read=1 WHERE recipient=?", me);
  return reply(msgs);
});

await server.connect(new StdioServerTransport());
