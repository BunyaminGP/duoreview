// Ajanları terminal (PTY) olmadan çalıştırır: her tur CLI'ın tek seferlik kipiyle bir çağrıdır ve oturum sürdürülür
// (claude -p --resume, codex exec resume, agy -p --conversation). Hakemin işini burada döngü yapar: sırası gelen ajana
// tur açar, tüm ajanlar ALL_DONE olunca, kimsenin yapacak işi kalmayınca ya da süre dolunca durur.
// Onay sorusu soracak kimse olmadığı için ajanlar izin denetimi kapalı çalışır: yalnız atılabilir bir klonda kullan.
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const agents = require("../app/agents.js");
const I18N = require("../app/i18n.js");
const { protocol } = require("../app/protocol.js");
const dist = (f) => pathToFileURL(join(import.meta.dirname, "..", "dist", f)).href;

I18N.setLang("en");
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_)/.test(k)));

/** JSONL ise satırlardaki nesneler, değilse (çok satırlı tek JSON) bütün metin. */
function objects(text) {
  const lines = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith("{")) continue;
    try { lines.push(JSON.parse(l)); } catch {}
  }
  if (lines.length) return lines;
  try { const j = JSON.parse(text); return j && typeof j === "object" ? [j] : []; } catch { return []; }
}
function walk(v, fn) {
  if (!v || typeof v !== "object") return;
  for (const [k, x] of Object.entries(v)) { fn(k, x); walk(x, fn); }
}
const ID_KEYS = new Set(["session_id", "sessionId", "thread_id", "threadId", "conversation_id", "conversationId"]);
const USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "cached_input_tokens", "total_cost_usd"];
/** Oturum kimliği ve kullanım (token, maliyet): CLI'ların JSON çıktısında hangi alanda gelirse. */
export function parseOutput(text) {
  let session = null;
  const usage = {};
  for (const o of objects(text)) {
    walk(o, (k, x) => {
      if (!session && ID_KEYS.has(k) && typeof x === "string" && x) session = x;
      if (USAGE_KEYS.includes(k) && typeof x === "number") usage[k] = (usage[k] ?? 0) + x;
    });
  }
  return { session, usage };
}

/** Bir turun komutu. prompt stdin'den gider (agy hariç): sorun metnindeki kabuk karakterleri argümana girmesin. */
// codexSandbox: Codex'in kendi sandbox'ı (varsayılan workspace-write: yalnız çalışma klasörüne yazar); "danger-full-access" kapatır.
export function turnCommand(agent, { session, first, dataDir, projectDir, model, effort, mcp, codexSandbox = "workspace-write" }) {
  const opts = { model, effort, projectDir };
  if (agent === "claude") {
    const base = mcp ? agents.buildSpec("claude", dataDir, opts) : { file: agents.resolveClaude(), args: [
      ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : [])] };
    return { file: base.file, stdin: true, args: [...base.args, "-p", "--output-format", "json", "--dangerously-skip-permissions",
      ...(first ? ["--session-id", session] : ["--resume", session])] };
  }
  if (agent === "codex") {
    const codex = agents.resolveCodex();
    const rest = mcp ? agents.buildSpec("codex", dataDir, opts).args.slice(codex.args.length)
      : [...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`] : [])];
    const sandbox = codexSandbox === "danger-full-access" ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["-c", `sandbox_mode=${JSON.stringify(codexSandbox)}`, "-c", 'approval_policy="never"'];
    const flags = ["--json", "--skip-git-repo-check", ...sandbox, ...rest];
    return { file: codex.file, stdin: true,
      args: [...codex.args, "exec", ...(first || !session ? [...flags, "-"] : ["resume", ...flags, session, "-"])] };
  }
  const gem = agents.buildSpec("gemini", dataDir, opts);
  const resume = first ? [] : session ? ["--conversation", session] : ["--continue"];
  return { file: gem.file, stdin: false, args: [...gem.args, "--output-format", "json", "--dangerously-skip-permissions", ...resume, "-p"] };
}

const kill = (p) => {
  if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" }); } catch {} }
  else p.kill("SIGKILL");
};
const running = new Set();
export const killAll = () => { for (const p of running) kill(p); };

/** Tek tur: CLI'ı çalıştırır, bitince oturum kimliğini ve kullanımı döndürür. */
export function runTurn(agent, prompt, o) {
  const cmd = turnCommand(agent, o);
  const started = Date.now();
  return new Promise((resolve) => {
    const p = spawn(cmd.file, cmd.stdin ? cmd.args : [...cmd.args, prompt], { cwd: o.projectDir, env: cleanEnv(), windowsHide: true });
    running.add(p);
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    const timer = setTimeout(() => kill(p), o.timeoutMs);
    p.on("error", (e) => { err += String(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      running.delete(p);
      const parsed = parseOutput(out);
      resolve({ code, ms: Date.now() - started, session: parsed.session, usage: parsed.usage, tail: (out.slice(-2000) + err).slice(-4000) });
    });
    if (cmd.stdin) p.stdin.end(prompt); else p.stdin.end();
  });
}

const addUsage = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_SAME_TURNS = 3; // aynı adım için bu kadar tur açılıp ilerleme olmadıysa ajan takılmış sayılır

/** Tek ajan, MCP'siz, tek tur: karşılaştırma tabanı. */
export async function runSolo({ agent, projectDir, dataDir, prompt, model, effort, timeoutMs, codexSandbox, log = () => {} }) {
  const session = agent === "claude" ? randomUUID() : null;
  log(`${agent}: solo turn`);
  const r = await runTurn(agent, prompt, { session, first: true, dataDir, projectDir, model, effort, mcp: false, timeoutMs, codexSandbox });
  return { reason: r.code === 0 ? "done" : `exit ${r.code}`, ms: r.ms, agents: { [agent]: { turns: 1, usage: r.usage, lastExit: r.code, tail: r.code ? r.tail : undefined } } };
}

/** Takım: pano (SQLite) dataDir'de, ajanlar projectDir'de çalışır. turn: testte sahte ajan verilir. */
export async function runTeam({
  projectDir, dataDir, team, captain = team[0], kickoff = "solo", reviewMode = "immediate", brief, verify = "",
  models = {}, efforts = {}, timeoutMs, turnTimeoutMs = 30 * 60_000, codexSandbox, log = () => {}, turn = runTurn,
}) {
  const { openDb } = await import(dist("db.js"));
  const flow = await import(dist("flow.js"));
  (await import(dist("i18n.js"))).setLang("en");
  const db = openDb(dataDir);
  for (const [k, v] of Object.entries({ team: team.join(","), captain, review_mode: reviewMode, kickoff, brief, verify, planned: "0" })) flow.setMeta(db, k, v);

  const deadline = Date.now() + timeoutMs;
  const st = Object.fromEntries(team.map((a) => [a, {
    session: a === "claude" ? randomUUID() : null, first: true, busy: false, stuck: false, sig: "", same: 0,
    turns: 0, usage: {}, lastExit: null, tail: undefined,
  }]));
  const unread = (a) => db.prepare("SELECT id, sender, text FROM messages WHERE recipient=? AND kind='prompt' AND read=0 ORDER BY id LIMIT 1").get(a);
  if (team.includes("gemini")) agents.registerGemini(dataDir, undefined, { projectDir });
  let reason = "";
  try {
    while (!reason) {
      if (Date.now() > deadline) { reason = "timeout"; break; }
      for (const a of team) {
        const s = st[a];
        if (s.busy || s.stuck) continue;
        const msg = unread(a);
        let text;
        if (msg) {
          db.prepare("UPDATE messages SET read=1 WHERE id=?").run(msg.id);
          text = I18N.t("promptFrom", { sender: msg.sender, text: msg.text });
        } else {
          const na = flow.nextAction(db, a);
          if (na.action === "WAIT" || na.action === "ALL_DONE") continue;
          const sig = flow.signature(na);
          if (sig === s.sig && ++s.same >= MAX_SAME_TURNS) { s.stuck = true; log(`${a}: stuck on ${sig}`); continue; }
          if (sig !== s.sig) { s.sig = sig; s.same = 0; }
          text = I18N.t("nudge", { what: na.task ? `${na.action} #${na.task.id}` : na.action });
        }
        if (s.first) text = protocol(a, team) + " " + text;
        s.first = false; s.busy = true; s.turns++;
        log(`${a}: turn ${s.turns} (${text.slice(0, 80)})`);
        turn(a, text, { session: s.session, first: s.turns === 1, dataDir, projectDir, model: models[a], effort: efforts[a], mcp: true, codexSandbox,
          timeoutMs: Math.min(turnTimeoutMs, Math.max(deadline - Date.now(), 1000)) })
          .then((r) => {
            s.session = s.session ?? r.session;
            addUsage(s.usage, r.usage);
            s.lastExit = r.code;
            s.tail = r.code ? r.tail : undefined;
            log(`${a}: turn ${s.turns} ended (exit ${r.code}, ${Math.round(r.ms / 1000)}s)`);
          })
          .finally(() => { s.busy = false; });
      }
      if (!team.some((a) => st[a].busy)) {
        const acts = team.map((a) => flow.nextAction(db, a).action);
        if (acts.every((x) => x === "ALL_DONE")) { reason = "done"; break; }
        const work = team.some((a, i) => !st[a].stuck && (unread(a) || !["WAIT", "ALL_DONE"].includes(acts[i])));
        if (!work) { reason = team.some((a) => st[a].stuck) ? "stuck" : "deadlock"; break; }
      }
      await sleep(1500);
    }
  } finally {
    killAll();
    while (team.some((a) => st[a].busy)) await sleep(200);
    if (team.includes("gemini")) agents.unregisterGemini();
  }
  const board = boardStats(db, flow);
  db.close();
  return { reason, agents: Object.fromEntries(team.map((a) => [a, { turns: st[a].turns, usage: st[a].usage, stuck: st[a].stuck, lastExit: st[a].lastExit, tail: st[a].tail }])), board };
}

/** Panodan karşılaştırma ölçüleri: inceleme turları, ihtilaflar, alternatiflerin akıbeti, araç çağrıları. */
export function boardStats(db, flow) {
  const n = (sql, ...p) => db.prepare(sql).get(...p).n;
  const meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta WHERE key LIKE 'calls:%' OR key LIKE 'chars_%'").all().map((r) => [r.key, Number(r.value)]));
  return {
    tasks: n("SELECT COUNT(*) n FROM tasks"),
    done: n("SELECT COUNT(*) n FROM tasks WHERE status='DONE'"),
    disputes: n("SELECT COUNT(*) n FROM tasks WHERE status='DISPUTE'"),
    reviews: n("SELECT COUNT(*) n FROM reviews WHERE reviewer<>'user'"),
    changeRequests: n("SELECT COUNT(*) n FROM reviews WHERE verdict='request_changes'"),
    alternatives: n("SELECT COUNT(*) n FROM reviews WHERE alternative IS NOT NULL"),
    adopted: n("SELECT COUNT(*) n FROM reviews WHERE triage='adopted'"),
    rejected: n("SELECT COUNT(*) n FROM reviews WHERE triage='rejected'"),
    verifyFailures: n("SELECT COUNT(*) n FROM events WHERE text LIKE '%verify command%'"),
    threads: flow.discussion(db).threads.map((t) => ({ kind: t.kind, outcome: t.outcome, posts: t.posts.length })),
    counters: meta,
  };
}
