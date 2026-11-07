#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { relative } from "node:path";
import { openDb, AGENTS, MAX_REVIEW_ROUNDS, MAX_OPEN_THREADS, type Agent } from "./db.js";
import { t as tr } from "./i18n.js";
import { snapshot, changedFiles, diffOf, projectDir } from "./git.js";
import {
  all, one, run, tx, logEvent, captainOf, reviewMode, reviewPhaseOpen, quota, getMeta,
  claimable, nextAction, compact, briefing, kickoffOf, planned, total, setMeta, kickoffNote, postsOf, myTurn,
  openThread, addPost, teamOf, others, reviewerOf, norm, parsePaths, overlaps, ACTIVE, type Task, type Thread, type Review,
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
  const acceptance = JSON.parse(t.acceptance) as string[];
  return { id: t.id, title: t.title, spec: t.description, touches: JSON.parse(t.touches), acceptance: acceptance.length ? acceptance : undefined };
}
/** Diff tabanı: üstlenme anındaki çalışma ağacı. Git işlemi kilidi tutmasın diye işlem (tx) bittikten sonra alınır. */
const setBase = (id: number) => {
  const base = snapshot();
  if (base) run(db, "UPDATE tasks SET base=? WHERE id=? AND base IS NULL", base, id);
};
/** Sıradaki adım. CLAIM ise görevi burada üstlenir; flow.nextAction saf kalır (hakem de onu çağırır). */
const next = (): Record<string, any> => {
  let claimed: number | undefined;
  const r = tx(db, () => {
    const a = nextAction(db, me);
    if (a.action !== "CLAIM") return compact(db, a, delivered, me);
    claimed = a.task.id as number;
    return { action: "FINISH_WORK", ...claim(one<Task>(db, "SELECT * FROM tasks WHERE id=?", claimed)!) };
  });
  if (claimed !== undefined) setBase(claimed);
  return r;
};

/** Kullanıcının tanımladığı doğrulama komutu (ör. npm test). Ajan değiştiremez: meta tablosunu yalnız uygulama yazar. */
function verify(cmd: string): Promise<{ ok: boolean; cmd: string; code: number | null; ms: number; out: string }> {
  const started = Date.now();
  const timeout = Number(getMeta(db, "verify_timeout", "900")) * 1000;
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(cmd, { cwd: projectDir(), shell: true, windowsHide: true, timeout });
    const take = (d: Buffer) => { out = (out + d.toString()).slice(-3000); };
    p.stdout.on("data", take);
    p.stderr.on("data", take);
    p.on("error", (e) => { out += String(e); });
    p.on("close", (code) => resolve({ ok: code === 0, cmd, code, ms: Date.now() - started, out }));
  });
}
const display = (abs: string) => relative(projectDir(), abs).replace(/\\/g, "/");
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
      key: z.string().max(40).optional(),
      title: z.string(),
      description: z.string().default(""),
      touches: z.array(z.string()).default([]),
      acceptance: z.array(z.string()).default([]),
      assignee: z.enum(AGENTS as [Agent, ...Agent[]]).optional(),
      depends_on: z.array(z.union([z.number(), z.string()])).default([]),
    })),
  },
  async ({ tasks }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptain", { captain: captainOf(db) }));
    const joint = kickoffOf(db) === "joint";
    const first = total(db) === 0 && !planned(db);
    if (joint && first && nextAction(db, me).action !== "PLAN") return fail(tr("kickoffFirst"));
    const team = teamOf(db);
    const outside = [...new Set(tasks.map((t) => t.assignee).filter((a) => a && !team.includes(a)))];
    if (outside.length) return fail(tr("notInTeamAssignee", { who: outside.join(", "), team: team.join(", ") }));
    // Aynı plandaki görevlere key ile bağlanılır (id'leri henüz yok); sayı mevcut bir görevin id'sidir.
    const keys = tasks.map((t) => t.key);
    const dup = keys.find((k, i) => k && keys.indexOf(k) !== i);
    if (dup) return fail(tr("dupKey", { key: dup }));
    const deps = tasks.map((t, i) => t.depends_on.map((d) => {
      const j = typeof d === "string" ? keys.indexOf(d) : -1;
      if (j >= 0) return j < i ? { local: j } : { bad: d };
      const id = Number(d);
      return Number.isInteger(id) ? { id } : { bad: d };
    }));
    const bad = deps.flat().filter((d) => "bad" in d).map((d) => (d as { bad: string | number }).bad);
    if (bad.length) return fail(tr("badDepKey", { keys: bad.join(", ") }));
    const missing = [...new Set(deps.flat().flatMap((d) => ("id" in d ? [d.id!] : [])))].filter((id) => !one(db, "SELECT id FROM tasks WHERE id=?", id));
    if (missing.length) return fail(tr("badDeps", { ids: missing.join(", ") }));
    const { ids, per } = tx(db, () => {
      const ids: number[] = [];
      tasks.forEach((t, i) => {
        const dependsOn = deps[i].map((d) => ("local" in d ? ids[d.local!] : d.id!));
        ids.push(Number(run(db, "INSERT INTO tasks(title, description, touches, acceptance, assignee, depends_on) VALUES (?,?,?,?,?,?)",
          t.title, t.description, JSON.stringify(t.touches), JSON.stringify(t.acceptance), t.assignee ?? null, JSON.stringify(dependsOn)).lastInsertRowid));
      });
      setMeta(db, "planned", "1");
      const per = Object.fromEntries(team.map((a) => [a, all<Task>(db, "SELECT id FROM tasks WHERE assignee=?", a).length]));
      // Ortak kipte ilk plan ortağın onayından geçer: iş bölümü tek kişinin kararı olmasın.
      if (joint && first && tasks.length) {
        const lines = tasks.map((t, i) => {
          const after = deps[i].map((d) => "#" + ("local" in d ? ids[d.local!] : d.id));
          return `#${ids[i]} ${t.title} → ${t.assignee ?? "?"}${t.touches.length ? ` [${t.touches.join(", ")}]` : ""}${after.length ? ` ← ${after.join(" ")}` : ""}`;
        });
        openThread(db, { kind: "plan", topic: tr("topicPlan"), by: me, blocking: true, text: [...lines, tr("planDetail")].join("\n") });
      }
      return { ids, per };
    });
    log(tasks.length ? tr("evTasksAdded", { n: tasks.length }) : tr("evNoTasks"));
    const counts = Object.values(per);
    const uneven = Math.max(...counts) - Math.min(...counts) > 1;
    const untouched = ids.filter((_, i) => !tasks[i].touches.length);
    const warn = [
      uneven && tr("unbalanced", { split: team.map((a) => `${a} ${per[a]}`).join(", ") }),
      untouched.length && tr("noTouches", { ids: untouched.map((id) => "#" + id).join(" ") }),
    ].filter(Boolean).join(" ");
    return done({ ids, per, quota: quota(db), warn: warn || undefined });
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
  { id: z.number(), assignee: z.enum(AGENTS as [Agent, ...Agent[]]) },
  async ({ id, assignee }) => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptainShort"));
    if (!teamOf(db).includes(assignee)) return fail(tr("notInTeamAssignee", { who: assignee, team: teamOf(db).join(", ") }));
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
      const acceptance = JSON.parse(t.acceptance) as string[];
      return reply({ id, title: t.title, status: t.status, who: t.owner ?? t.assignee ?? undefined, spec: t.description,
        touches: JSON.parse(t.touches), acceptance: acceptance.length ? acceptance : undefined, depends_on: JSON.parse(t.depends_on),
        summary: t.summary ?? undefined, verify: t.verify ? JSON.parse(t.verify) : undefined, last });
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
    return reply(`${me}/${tr("captainLabel")}:${captainOf(db)}/${reviewMode(db)}\n${tr("colHeader")}\n${lines.join("\n")}`);
  });

tool("claim_task", tr("dClaimTask"),
  { id: z.number() },
  async ({ id }) => {
    const r = tx(db, () => {
      const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
      if (!t) return fail(tr("noTask"));
      const why = claimable(db, me, t);
      if (why) return fail(why);
      return reply(claim(t));
    });
    if (!("isError" in r)) setBase(id);
    return r;
  },
);

tool("submit_task", tr("dSubmitTask"),
  { id: z.number(), summary: z.string(), files: z.array(z.string()).default([]) },
  async ({ id, summary, files }) => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=? AND owner=? AND status IN ('WORKING','REWORK')", id, me);
    if (!t) return fail(tr("notYours"));
    const cmd = getMeta(db, "verify", "").trim();
    const check = cmd ? await verify(cmd) : undefined;
    if (check && !check.ok) {
      run(db, "UPDATE tasks SET verify=? WHERE id=?", JSON.stringify(check), id);
      log(tr("evVerifyFailed", { id, code: String(check.code) }));
      return fail(tr("verifyFailed", { cmd, code: String(check.code), out: check.out }));
    }
    // Görevin kendi diff'i: ortakların bitmemiş görevlerine ait dosyalar çıkarılır; touches/files dışında kalan değişiklik "sahipsiz" işaretlenir.
    const head = t.base ? snapshot() : null;
    let diff: string | null = null, unclaimed: string[] = [];
    if (t.base && head) {
      const theirs = all<Task>(db, `SELECT touches FROM tasks WHERE status IN ${ACTIVE} AND id<>?`, id).map((x) => parsePaths(x.touches));
      const own = changedFiles(t.base, head).filter((f) => !theirs.some((p) => overlaps([norm(f)], p)));
      const declared = [...parsePaths(t.touches), ...files.map(norm)];
      unclaimed = own.filter((f) => !overlaps([norm(f)], declared)).map(display);
      diff = diffOf(t.base, head, own);
    }
    const r = run(db,
      `UPDATE tasks SET status='REVIEW', summary=?, files=?, head=?, diff=?, unclaimed=?, verify=?, updated_at=datetime('now')
       WHERE id=? AND owner=? AND status IN ('WORKING','REWORK')`,
      summary, JSON.stringify(files), head, diff, JSON.stringify(unclaimed),
      check ? JSON.stringify({ ok: true, cmd, ms: check.ms }) : null, id, me);
    if (!r.changes) return fail(tr("notYours"));
    log(tr("evSubmitted", { id }));
    return done({ unclaimed: unclaimed.length ? unclaimed : undefined });
  },
);

tool("review_task",
  tr("dReviewTask"),
  {
    id: z.number(),
    verdict: z.enum(["approve", "approve_with_notes", "request_changes"]),
    severity: z.enum(["blocker", "major", "minor"]).optional(),
    comment: z.string(),
    checks: z.array(z.object({ ok: z.boolean(), evidence: z.string(), blocked: z.boolean().optional() })).optional(),
    alternative: z.string().max(4000).optional(),
  },
  async ({ id, verdict, severity, comment, checks, alternative }) => chain(tx(db, () => {
    const t = one<Task>(db, "SELECT * FROM tasks WHERE id=?", id);
    if (!t || t.status !== "REVIEW") return fail(tr("notInReview"));
    if (t.owner === me) return fail(tr("ownWork"));
    if (reviewerOf(db, t) !== me) return fail(tr("notYourReview", { who: reviewerOf(db, t) }));
    if (!reviewPhaseOpen(db)) return fail(tr("reviewClosed"));
    // Kabul kriterleri sırayla, kanıtıyla işaretlenir; karşılanmayan kriterle onay verilmez.
    // blocked: ortam yüzünden denetlenemedi (ör. projenin testleri bu Python'da çalışmıyor); kanıtı denenen komut ve hatasıdır, onayı engellemez.
    const acceptance = JSON.parse(t.acceptance) as string[];
    if (acceptance.length) {
      if (checks?.length !== acceptance.length) return fail(tr("needChecks", { n: acceptance.length }));
      const empty = checks.findIndex((c) => !c.evidence.trim());
      if (empty >= 0) return fail(tr("needEvidence", { n: empty + 1 }));
      const unmet = checks.findIndex((c) => !c.ok && !c.blocked);
      if (unmet >= 0 && verdict !== "request_changes") return fail(tr("unmetCriterion", { n: unmet + 1 }));
    }
    if (verdict === "request_changes") {
      if (!comment.trim()) return fail(tr("needReason"));
      if (severity !== "blocker" && severity !== "major") {
        return fail(tr("needSeverity"));
      }
    }
    run(db, "INSERT INTO reviews(task_id, reviewer, verdict, comment, checks, alternative) VALUES (?,?,?,?,?,?)",
      id, me, verdict, comment, checks ? JSON.stringify(checks) : null, alternative?.trim() || null);
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
  { text: z.string().min(1).max(2000), to: z.enum(AGENTS as [Agent, ...Agent[]]).optional() },
  async ({ text, to }) => {
    if (to && (to === me || !teamOf(db).includes(to))) return fail(tr("badRecipient", { team: others(db, me).join(", ") }));
    const recipients = to ? [to] : others(db, me);
    for (const r of recipients) run(db, "INSERT INTO messages(sender, recipient, kind, text) VALUES (?,?, 'prompt', ?)", me, r, text);
    log(tr("evPrompt", { partner: recipients.join(", "), text: text.slice(0, 80) }));
    return reply("ok");
  },
);

tool("triage", tr("dTriage"),
  {
    review: z.number(),
    decision: z.enum(["adopt", "reject"]),
    reason: z.string().min(1).max(2000),
    assignee: z.enum(AGENTS as [Agent, ...Agent[]]).optional(),
  },
  async ({ review, decision, reason, assignee }) => chain(tx(db, () => {
    if (captainOf(db) !== me) return fail(tr("onlyCaptainShort"));
    const r = one<Review & { title: string; owner: Agent; touches: string; acceptance: string }>(db,
      `SELECT r.*, t.title, t.owner, t.touches, t.acceptance FROM reviews r JOIN tasks t ON t.id=r.task_id
       WHERE r.id=? AND r.alternative IS NOT NULL AND r.triage IS NULL`, review);
    if (!r) return fail(tr("noAlternative"));
    const team = teamOf(db);
    if (assignee && !team.includes(assignee)) return fail(tr("notInTeamAssignee", { who: assignee, team: team.join(", ") }));
    run(db, "UPDATE reviews SET triage=?, triage_note=? WHERE id=?", decision === "adopt" ? "adopted" : "rejected", reason, review);
    if (decision === "reject") {
      log(tr("evAltRejected", { id: r.task_id, reason: reason.slice(0, 80) }));
      return {};
    }
    // Öneriyi en iyi bilen öneren inceleyicidir; yeni görevi o yapar, inceleme sırası yine sahibinden sonrakidir.
    const who = assignee ?? (team.includes(r.reviewer as Agent) ? r.reviewer : null);
    const id = Number(run(db,
      "INSERT INTO tasks(title, description, touches, acceptance, assignee, origin) VALUES (?,?,?,?,?,?)",
      tr("altTitle", { id: r.task_id, title: r.title }), `${r.alternative}\n\n${reason}`, r.touches, r.acceptance, who, review).lastInsertRowid);
    log(tr("evAltAdopted", { id: r.task_id, task: id }));
    return { task: id };
  })),
);

tool("read_inbox", tr("dReadInbox"), {}, async () => tx(db, () => {
  const msgs = all<{ id: number; sender: string; text: string }>(db,
    "SELECT id,sender,text FROM messages WHERE recipient=? AND read=0 ORDER BY id", me);
  for (const m of msgs) run(db, "UPDATE messages SET read=1 WHERE id=?", m.id);
  return reply(msgs.map(({ sender, text }) => ({ sender, text })));
}));

tool("post_note", tr("dPostNote"),
  { text: z.string().min(1).max(12000), title: z.string().max(120).default("") },
  async ({ text, title }) => chain(tx(db, () => {
    const kickoff = kickoffOf(db) === "joint" && total(db) === 0 && !planned(db) && !kickoffNote(db, me);
    run(db, "INSERT INTO notes(author, kind, title, text) VALUES (?,?,?,?)", me, kickoff ? "kickoff" : "note", title, text);
    log(kickoff ? tr("evKickoffNote") : tr("evNote", { title: title || text.slice(0, 60) }));
    if (kickoff && others(db, me).every((a) => kickoffNote(db, a))) {
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
