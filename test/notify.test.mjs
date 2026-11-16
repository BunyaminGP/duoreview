import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createNotifier } = require("../app/notify.js");
const { preflight } = require("../app/preflight.js");
const messages = [];
const notify = createNotifier((m) => messages.push(m));
const board = { agents: { codex: { status: "approval" } }, tasks: [] };
const ctx = { focused: false, language: "tr", projectDir: "one" };
for (let i = 0; i < 5; i++) notify(board, ctx);
assert.equal(messages.length, 1);
assert.match(messages[0].body, /onay/);
board.agents.codex.status = "busy"; notify(board, ctx);
board.agents.codex.status = "approval"; notify(board, { ...ctx, focused: true });
assert.equal(messages.length, 1, "focused window gets no notification");
notify(board, ctx); assert.equal(messages.length, 1, "focus loss is not a new transition");
board.tasks.push({ id: 1, title: "A", status: "DISPUTE" });
notify(board, { ...ctx, language: "en" }); notify(board, ctx);
assert.equal(messages.length, 2); assert.match(messages[1].body, /decision/);
board.tasks[0].status = "REWORK"; notify(board, ctx);
board.tasks[0].status = "DISPUTE"; notify(board, ctx);
assert.equal(messages.length, 3, "a later dispute transition notifies again");
notify({ agents: {}, tasks: [{ id: 1, title: "B", status: "DISPUTE" }] }, { ...ctx, projectDir: "two" });
assert.equal(messages.length, 4, "project-local task IDs cannot suppress another project's notification");

const calls = [], callbacks = [];
const result = preflight({ resolve: {
  claude: () => { throw new Error("CLI missing"); }, codex: () => ({ file: "node", args: ["codex.js"] }), gemini: () => "agy",
}, exec: (file, args, options, cb) => { calls.push({ file, args, options }); callbacks.push(cb); } });
assert.equal(calls.length, 2, "all version checks start without waiting for a child");
assert.deepEqual(calls[0].args, ["codex.js", "--version"]);
assert.equal(calls[0].options.timeout, 5000); assert.equal(calls[0].options.windowsHide, true);
callbacks[0](null, "codex 1\n", ""); callbacks[1](new Error("timed out"), "", "");
const checked = await result;
assert.equal(checked.claude.ok, false); assert.match(checked.claude.error, /missing/);
assert.deepEqual(checked.codex, { ok: true, path: "node", version: "codex 1", error: "" });
assert.equal(checked.gemini.ok, false); assert.match(checked.gemini.error, /timed out/);
console.log("NOTIFY/PREFLIGHT OK");
