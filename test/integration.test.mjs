import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDb } from "../dist/db.js";
import { setMeta } from "../dist/flow.js";
import * as flowModule from "../dist/flow.js";

const require = createRequire(import.meta.url);
const { createLifecycle, createInputGate, createPasteTracker } = require("../app/lifecycle.js");
const { createInjector } = require("../app/inject.js");
const { createReferee } = require("../app/referee.js");
const { createComposerController, getLifecycleButtonState, formatLifecycleStatus } = require("../app/input.js");
const agents = ["claude", "codex", "gemini"];
const dir = mkdtempSync(join(tmpdir(), "duoreview-integration-"));
const db = openDb(dir);
setMeta(db, "team", agents.join(","));
setMeta(db, "planned", "1");
let client;
try {
  let time = 10000;
  const timers = [];
  const later = (fn, ms) => { const timer = { fn, at: time + ms }; timers.push(timer); return timer; };
  const clear = (timer) => { const i = timers.indexOf(timer); if (i >= 0) timers.splice(i, 1); };
  const advance = (ms) => {
    const end = time + ms;
    while (true) {
      timers.sort((a, b) => a.at - b.at);
      if (!timers.length || timers[0].at > end) break;
      const timer = timers.shift(); time = timer.at; timer.fn();
    }
    time = end;
  };
  const outputAt = {};
  const terms = [];
  const trackers = Object.fromEntries(agents.map((a) => [a, createPasteTracker()]));
  let life, ref;
  const inject = createInjector({
    generation: (a) => life.generation(a),
    write: (a, text) => { const term = life.current(a); if (!term) return false; term.write(text); return true; },
    lastOutputAt: (a) => outputAt[a] ?? 0,
    awaitingApproval: (a) => ref.awaitingApproval(a), now: () => time, later,
  });
  ref = await createReferee({ distDir: resolve("dist"), getDb: () => db, write: inject, now: () => time });
  life = createLifecycle({
    agents, now: () => time, later, clear, alive: () => false, killTree: () => {},
    spawn: (agent) => {
      const term = { agent, pid: terms.length + 100, writes: [], write(text) { this.writes.push(text); },
        kill() {}, onData(fn) { this.emit = fn; }, onExit(fn) { this.exit = fn; } };
      terms.push(term); return term;
    },
    onData: (a, text) => { outputAt[a] = time; trackers[a].feed(text); ref.noteOutput(a, text); },
    onExit: (a) => { inject.cancel(a); ref.stop(a); },
  });
  const start = (a) => { assert.equal(life.start(a, {}).ok, true); ref.start(a); trackers[a].reset(); };
  const gate = createInputGate({
    isAgent: (a) => agents.includes(a), current: (a) => life.current(a), inject,
    awaitingApproval: (a) => ref.awaitingApproval(a), noteInput: (a) => ref.noteInput(a),
    bracketed: (a) => trackers[a].on, setHold: (a, held) => ref.hold(a, held),
  });
  start("codex"); start("gemini");
  const old = life.current("codex");
  const other = life.current("gemini");
  const cancelled = inject("codex", "old generation");
  const unaffected = inject("gemini", "other agent");
  inject.cancel("codex"); life.stop("codex"); old.exit({ exitCode: 0 }); start("codex");
  const fresh = life.current("codex");
  old.emit("\x1b[?2004h"); old.exit({ exitCode: 1 });
  advance(15000);
  assert.equal(await cancelled, false);
  assert.equal(await unaffected, true);
  assert.deepEqual(old.writes, ["old generation"]);
  assert.deepEqual(fresh.writes, []);
  assert.deepEqual(other.writes, ["other agent", "\r"]);
  assert.equal(life.current("codex"), fresh);
  assert.equal(trackers.codex.on, false, "old output cannot change new paste mode");

  fresh.emit("\x1b[?20"); fresh.emit("04h");
  const composer = createComposerController({ agent: "codex", sendFn: (a, text) => gate.send(a, text) });
  const message = "İş 🧪\r\n\tçok satır\n".repeat(2500);
  composer.setDraft(message);
  const sent = composer.send();
  ref.queueInitial("codex", "must wait for composer");
  advance(6000); ref.tick();
  assert.deepEqual(fresh.writes, ["\x1b[200~" + message.replace(/\r\n|\n/g, "\r") + "\x1b[201~", "\r"]);
  assert.equal((await sent).sent, true);
  assert.equal(composer.getDraft(), "");

  fresh.emit("Do you want to allow this? (y/n)");
  composer.setDraft("keep my draft");
  const before = fresh.writes.length;
  assert.equal((await composer.send()).sent, false);
  assert.equal(composer.getDraft(), "keep my draft");
  assert.equal(fresh.writes.length, before);
  gate.write("codex", "n");
  const interrupted = inject("codex", "automatic");
  gate.write("codex", "\x1b[200~manual paste\x1b[201~");
  advance(15000);
  assert.equal(await interrupted, false);
  assert.equal(fresh.writes.at(-1), "\x1b[200~manual paste\x1b[201~");

  // The real MCP reader consumes the original message after PTY restart and notification.
  const original = "Özgün mesaj 🧪\r\n\tDo you want to?\n";
  db.prepare("INSERT INTO messages(sender,recipient,kind,text) VALUES ('claude','codex','prompt',?)").run(original);
  life.stop("codex"); fresh.exit({ exitCode: 0 }); start("codex");
  advance(6000); ref.tick(); advance(6000); await Promise.resolve();
  assert.match(life.current("codex").writes[0], /read_inbox/);
  assert.equal(db.prepare("SELECT read FROM messages").get().read, 0);
  client = new Client({ name: "integration-codex", version: "1" });
  await client.connect(new StdioClientTransport({ command: "node", args: [resolve("dist/server.js")],
    env: { ...process.env, AGENT_ID: "codex", DUOREVIEW_DIR: dir, DUOREVIEW_SESSION_TAG: "eb18c34d-8f54-4bfd-9767-51c5355cec50" } }));
  const firstAction = JSON.parse((await client.callTool({ name: "next_action", arguments: {} })).content[0].text);
  assert.equal(firstAction.session_tag, "eb18c34d-8f54-4bfd-9767-51c5355cec50");
  assert.equal(JSON.parse((await client.callTool({ name: "next_action", arguments: {} })).content[0].text).session_tag, undefined);
  const inbox = await client.callTool({ name: "read_inbox", arguments: {} });
  assert.deepEqual(JSON.parse(inbox.content[0].text), [{ sender: "claude", text: original }]);
  assert.equal(db.prepare("SELECT read FROM messages").get().read, 1);
  assert.equal(life.current("gemini"), other);

  // Execute the actual preload and main registrations with Electron replaced by a local IPC bus.
  const handlers = new Map(), listeners = new Map();
  let bridge, clipboardText = original;
  const ipc = { handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => listeners.set(c, fn) };
  const electron = {
    ipcMain: ipc, app: { whenReady: () => ({ then() {} }), on() {}, getPath: () => dir },
    clipboard: { readText: () => clipboardText, writeText: (t) => { clipboardText = t; } },
  };
  const appRequire = createRequire(resolve("app/main.js"));
  const spawned = [], initial = [], specs = [];
  const pty = { spawn() {
    const term = { pid: 900000 + spawned.length, onData() {}, onExit(fn) { this.exit = fn; }, kill() {}, write() {} };
    spawned.push(term); return term;
  } };
  const sandbox = {
    require: (id) => id === "electron" ? electron : id === "node-pty" ? pty : id === "./agents" ? {
      ...appRequire(id), buildSpec: (agent, data, opts) => { specs.push({ agent, opts }); return { file: "fake", args: [] }; },
    } : appRequire(id),
    __dirname: resolve("app"), process: { ...process, env: { ...process.env, DUOREVIEW_FAKE: "" }, on() {} }, console, setTimeout, clearTimeout, setInterval,
    testDb: db, testFlow: flowModule, testDir: dir,
    testRef: { start() {}, stop() {}, queueInitial: (a, p) => initial.push({ a, p }) },
  };
  vm.runInNewContext(readFileSync("app/main.js", "utf8") + `
    db = testDb; flow = testFlow; projectDir = testDir; referee = testRef;
    sessions = createSessionStore(dataDirFor(projectDir));
    globalThis.sessionTest = { stateSnapshot, reload: () => { sessions = createSessionStore(dataDirFor(projectDir)); } };
  `, sandbox);
  vm.runInNewContext(readFileSync("app/preload.js", "utf8"), { require: () => ({
    contextBridge: { exposeInMainWorld: (_name, api) => { bridge = api; } },
    ipcRenderer: {
      invoke: (c, ...args) => { assert.ok(handlers.has(c), c); return Promise.resolve(handlers.get(c)({}, ...args)); },
      send: (c, ...args) => { assert.ok(listeners.has(c), c); listeners.get(c)({}, ...args); }, on() {},
    },
  }) });
  assert.equal(await bridge.readClipboard(), original);
  bridge.writeClipboard(message); assert.equal(await bridge.readClipboard(), message);
  assert.equal((await bridge.send("codex", "stopped")).ok, false);
  assert.equal((await bridge.send("unknown", "wrong agent")).ok, false);
  bridge.hold("unknown", true);
  bridge.saveUi({ side: 450, font: { codex: 18 }, max: "codex", advanced: true });
  const savedUi = sandbox.sessionTest.stateSnapshot().ui;
  assert.equal(savedUi.side, 450); assert.equal(savedUi.font.codex, 18);
  assert.equal(savedUi.max, "codex"); assert.equal(savedUi.advanced, true);
  assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).ui.side, 450);
  const detailId = Number(db.prepare("INSERT INTO tasks(title,description,acceptance,touches) VALUES (?,?,?,?)").run(
    "Detail test", "Description", '["criterion"]', '["file.js"]').lastInsertRowid);
  const detail = await bridge.taskDetail(detailId);
  assert.equal(detail.description, "Description"); assert.deepEqual(detail.acceptance, ["criterion"]);
  assert.equal(await bridge.taskDetail(-1), null); assert.equal(await bridge.taskDetail("1"), null);
  db.prepare("DELETE FROM tasks WHERE id=?").run(detailId);
  setMeta(db, "brief", "");
  await listeners.get("pty:start")({}, { agent: "claude", cols: 80, rows: 24 });
  assert.equal(initial.at(-1).a, "claude", "persisted team + brief queues protocol without teamStarted");
  assert.match(initial.at(-1).p, /next_action/);
  setMeta(db, "brief", "resume protocol after application restart");
  const firstSession = specs.at(-1).opts.sessionId;
  spawned.at(-1).exit({ exitCode: 0 });
  sandbox.sessionTest.reload();
  assert.equal(sandbox.sessionTest.stateSnapshot().resumable.claude, true);
  await listeners.get("pty:start")({}, { agent: "claude" });
  assert.equal(specs.at(-1).opts.sessionId, firstSession);
  assert.equal(specs.at(-1).opts.resume, true);
  spawned.at(-1).exit({ exitCode: 0 });
  await listeners.get("pty:start")({}, { agent: "claude", fresh: true });
  assert.notEqual(specs.at(-1).opts.sessionId, firstSession);
  assert.equal(specs.at(-1).opts.resume, false);
  const freshId = specs.at(-1).opts.sessionId;
  spawned.at(-1).exit({ exitCode: 0 });
  await listeners.get("team:start")({}, { cfg: { team: ["claude", "codex"], brief: "resume protocol after application restart", subagents: "scoped" } });
  assert.equal(flowModule.getMeta(db, "subagents", ""), "scoped");
  assert.equal(specs.findLast((s) => s.agent === "claude").opts.sessionId, freshId);
  assert.equal(specs.findLast((s) => s.agent === "claude").opts.resume, true);
  const count = spawned.length;
  spawned.at(-2).exit({ exitCode: 1 });
  assert.equal(spawned.length, count + 1, "failed resume retries once with fresh session");
  assert.equal(specs.at(-1).opts.resume, false);
  spawned.at(-1).exit({ exitCode: 1 });
  assert.equal(spawned.length, count + 1, "fresh failure cannot loop");
  assert.equal(getLifecycleButtonState(life.life("codex")).canSend, true);
  life.stop("codex");
  assert.equal(getLifecycleButtonState(life.life("codex")).canStart, false);
  life.current("gemini").exit({ exitCode: 9 });
  assert.match(formatLifecycleStatus(life.life("gemini"), JSON.stringify(life.why("gemini"))), /lifeExit.*9/);
  console.log("INTEGRATION OK (fake PTY, real modules, preload/main IPC, real MCP)");
} finally {
  await client?.close(); db.close(); rmSync(dir, { recursive: true, force: true });
}
