// SWE-bench koşucusu: tur komutları, çıktı ayrıştırma ve takım döngüsü (sahte ajanla; model kotası harcamaz).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const tmp = mkdtempSync(join(tmpdir(), "bench-"));
for (const [env, f] of [["DUOREVIEW_CLAUDE_BIN", "claude"], ["DUOREVIEW_CODEX_BIN", "codex"], ["DUOREVIEW_GEMINI_BIN", "agy"]]) {
  writeFileSync(join(tmp, f), "x");
  process.env[env] = join(tmp, f);
}
const { turnCommand, parseOutput, runTeam } = await import("../bench/headless.mjs");

// ---- tur komutları ----
const base = { dataDir: join(tmp, "data"), projectDir: tmp, model: "m", effort: "low", mcp: true };
const c1 = turnCommand("claude", { ...base, session: "S", first: true });
assert.ok(c1.stdin && c1.args.includes("--mcp-config") && c1.args.includes("-p") && c1.args.includes("--dangerously-skip-permissions"));
assert.deepEqual(c1.args.slice(-2), ["--session-id", "S"]);
assert.deepEqual(turnCommand("claude", { ...base, session: "S", first: false }).args.slice(-2), ["--resume", "S"]);
assert.ok(!turnCommand("claude", { ...base, mcp: false, session: "S", first: true }).args.includes("--mcp-config"), "tek ajan MCP'siz");
const x1 = turnCommand("codex", { ...base, session: null, first: true });
assert.equal(x1.args[0], "exec");
assert.equal(x1.args.at(-1), "-", "istem stdin'den");
assert.ok(x1.args.includes('sandbox_mode="workspace-write"') && !x1.args.includes("--dangerously-bypass-approvals-and-sandbox"), "Codex varsayılan olarak kendi sandbox'ında");
assert.ok(turnCommand("codex", { ...base, first: true, codexSandbox: "danger-full-access" }).args.includes("--dangerously-bypass-approvals-and-sandbox"));
assert.ok(x1.args.some((a) => a.startsWith("mcp_servers.duoreview.env=") && a.includes("DUOREVIEW_PROJECT")));
const x2 = turnCommand("codex", { ...base, session: "T", first: false });
assert.deepEqual([x2.args[0], x2.args[1], ...x2.args.slice(-2)], ["exec", "resume", "T", "-"]);
const g2 = turnCommand("gemini", { ...base, session: "G", first: false });
assert.ok(!g2.stdin && g2.args.at(-1) === "-p" && g2.args.includes("--conversation"));

// ---- çıktı ayrıştırma ----
assert.deepEqual(parseOutput('{"type":"result","session_id":"abc","total_cost_usd":0.5,"usage":{"input_tokens":10,"output_tokens":2}}'),
  { session: "abc", usage: { total_cost_usd: 0.5, input_tokens: 10, output_tokens: 2 } });
const codexOut = ['{"type":"thread.started","thread_id":"t1"}', '{"type":"turn.completed","usage":{"input_tokens":5,"cached_input_tokens":1,"output_tokens":3}}',
  '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":3}}'].join("\n");
assert.deepEqual(parseOutput(codexOut), { session: "t1", usage: { input_tokens: 10, cached_input_tokens: 1, output_tokens: 6 } });
assert.deepEqual(parseOutput("not json"), { session: null, usage: {} });

// ---- takım döngüsü ----
const project = join(tmp, "proj");
execFileSync("git", ["init", "-q", project]);
for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["core.autocrlf", "false"]]) execFileSync("git", ["config", k, v], { cwd: project });
writeFileSync(join(project, "README"), "x\n");
execFileSync("git", ["add", "-A"], { cwd: project }); execFileSync("git", ["commit", "-qm", "base"], { cwd: project });

/** Kurallara uyan sahte ajan: her tur yeni bir MCP oturumudur (gerçek -p turları gibi). */
async function obedient(agent, _text, o) {
  const c = new Client({ name: agent, version: "1" });
  await c.connect(new StdioClientTransport({ command: "node", args: [resolve("dist/server.js")],
    env: { ...process.env, AGENT_ID: agent, DUOREVIEW_DIR: o.dataDir, DUOREVIEW_PROJECT: o.projectDir, DUOREVIEW_LANG: "en" } }));
  const call = async (name, args = {}) => {
    const r = await c.callTool({ name, arguments: args });
    assert.ok(!r.isError, `${agent} ${name}: ${r.content[0].text}`);
    try { return JSON.parse(r.content[0].text); } catch { return {}; }
  };
  let a = await call("next_action");
  for (let i = 0; i < 20 && !["WAIT", "ALL_DONE"].includes(a.action); i++) {
    let r;
    if (a.action === "PLAN") {
      r = await call("post_tasks", { tasks: [
        { key: "x", title: "X", touches: ["x.txt"], acceptance: ["x.txt exists"], assignee: "claude" },
        { title: "Y", touches: ["y.txt"], assignee: "codex", depends_on: ["x"] },
      ] });
    } else if (a.action === "FINISH_WORK" || a.action === "REWORK") {
      writeFileSync(join(o.projectDir, a.title.toLowerCase() + ".txt"), "done\n");
      r = await call("submit_task", { id: a.id, summary: "done", files: [a.title.toLowerCase() + ".txt"] });
    } else if (a.action === "REVIEW") {
      assert.match(a.diff, /\+done/);
      r = await call("review_task", { id: a.id, verdict: "approve", comment: "ok",
        checks: a.acceptance?.map(() => ({ ok: true, evidence: "x.txt:1" })), alternative: a.id === 1 ? "one write" : undefined });
    } else if (a.action === "TRIAGE") {
      for (const it of a.items) r = await call("triage", { review: it.review, decision: "reject", reason: "same cost" });
    } else throw new Error(`${agent}: unexpected ${a.action}`);
    a = r.next ?? await call("next_action");
  }
  await c.close();
  return { code: 0, ms: 1, session: `s-${agent}`, usage: { input_tokens: 10 } };
}

const res = await runTeam({ projectDir: project, dataDir: join(tmp, "board"), team: ["claude", "codex"], brief: "x", timeoutMs: 120_000, turn: obedient });
assert.equal(res.reason, "done");
assert.deepEqual([res.agents.claude.turns, res.agents.codex.turns], [2, 1]);
assert.equal(res.agents.claude.usage.input_tokens, 20);
assert.deepEqual([res.board.tasks, res.board.done, res.board.alternatives, res.board.rejected], [2, 2, 1, 1]);
assert.ok(res.board.counters["calls:claude"] > 0);

// Hiçbir şey yapmayan ajan: aynı adımda üç tur sonra takılmış sayılır, koşu sonsuza dek sürmez
const lazy = await runTeam({ projectDir: project, dataDir: join(tmp, "board2"), team: ["claude", "codex"], brief: "x", timeoutMs: 60_000,
  turn: async () => ({ code: 0, ms: 1, session: null, usage: {} }) });
assert.equal(lazy.reason, "stuck");
assert.equal(lazy.agents.claude.turns, 3);

rmSync(tmp, { recursive: true, force: true });
console.log("BENCH OK");
