import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { readCodexUsage, readClaudeUsage } = require("../app/usage.js");
const dir = fs.mkdtempSync(join(tmpdir(), "duoreview-perf-"));
const originalRead = fs.readSync, originalReadFile = fs.readFileSync;
try {
  const day = join(dir, ".codex", "sessions", "2026", "11", "16");
  fs.mkdirSync(day, { recursive: true });
  const rollout = join(day, "rollout-1.jsonl"), status = join(dir, "claude.json");
  const now = Date.parse("2026-11-16T12:00:00Z"), reset = now + 60000;
  const event = (pct) => JSON.stringify({ timestamp: new Date(now).toISOString(), payload: { type: "token_count",
    rate_limits: { primary: { used_percent: pct, resets_at: reset / 1000, window_minutes: 300 } } } });
  const claude = (pct) => JSON.stringify({ rate_limits: { five_hour: { used_percentage: pct, resets_at: reset / 1000 } } });
  fs.writeFileSync(rollout, event(12)); fs.writeFileSync(status, claude(34));
  let tailReads = 0, statusReads = 0, settingsReads = 0;
  const settingsPath = join(dir, "settings.json");
  fs.readSync = (...a) => { tailReads++; return originalRead(...a); };
  fs.readFileSync = (...a) => {
    if (a[0] === status) statusReads++;
    if (a[0] === settingsPath) settingsReads++;
    return originalReadFile(...a);
  };
  assert.equal(readCodexUsage(now, dir).five.pct, 12);
  assert.equal(readClaudeUsage(status, now).five.pct, 34);
  const firstReads = [tailReads, statusReads];
  for (let i = 0; i < 10; i++) {
    readCodexUsage(now, dir); readClaudeUsage(status, now);
  }
  assert.deepEqual([tailReads, statusReads], firstReads, "unchanged files are not read again");
  for (const value of [readCodexUsage(reset + 1, dir), readClaudeUsage(status, reset + 1)]) {
    assert.equal(value.five.pct, 0); assert.equal(value.five.renewed, true);
  }
  assert.deepEqual([tailReads, statusReads], firstReads, "reset is computed from cached raw data");
  fs.writeFileSync(rollout, event(9)); fs.writeFileSync(status, claude(8));
  assert.equal(readCodexUsage(now, dir).five.pct, 9);
  assert.equal(readClaudeUsage(status, now).five.pct, 8);
  assert.ok(tailReads > firstReads[0]); assert.equal(statusReads, firstReads[1] + 1);
  const previousTime = fs.statSync(rollout).mtimeMs;
  fs.writeFileSync(rollout, event(7));
  fs.utimesSync(rollout, new Date(previousTime + 2000), new Date(previousTime + 2000));
  assert.equal(readCodexUsage(now, dir).five.pct, 7, "mtime invalidates cache even at the same size");
  fs.writeFileSync(join(day, "rollout-2.jsonl"), event(55));
  assert.equal(readCodexUsage(now, dir).five.pct, 55, "newest rollout is discovered despite cache");
  fs.unlinkSync(status);
  assert.equal(readClaudeUsage(status, now).ok, false, "deleted file does not return cached quota");

  // Actual main-process tick and reload wiring, with only Electron and startup replaced.
  fs.writeFileSync(settingsPath, JSON.stringify({ quotaStopPct: 95 }));
  const timers = [], sent = [], callbacks = {};
  const payload = { tasks: [{ id: 1, status: "WORKING" }], agents: { codex: { status: "busy" } }, usage: {} };
  class Window {
    webContents = { send: (channel, data) => sent.push({ channel, data }), on: (event, fn) => { callbacks[event] = fn; } };
    isDestroyed() { return false; }
    loadFile() {}
    setMenuBarVisibility() {}
  }
  const electron = { BrowserWindow: Window, screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1400, height: 900 } }) },
    app: { getPath: () => dir, whenReady: () => ({ then() {} }), on() {} }, ipcMain: { on() {}, handle() {} } };
  const appRequire = createRequire(resolve("app/main.js"));
  const sandbox = { require: (id) => id === "electron" ? electron : id === "node-pty" ? {} : appRequire(id),
    __dirname: resolve("app"), process: { ...process, env: { ...process.env, DUOREVIEW_FAKE: "1" }, on() {} },
    console, setTimeout, clearTimeout, setInterval: (fn, ms) => timers.push({ fn, ms }), payload, dir };
  vm.runInNewContext(fs.readFileSync("app/main.js", "utf8") + `
    projectDir = dir; board = () => payload; referee = { tick() {} }; refreshUsage = () => {};
    usage = { codex: { ok: true, five: { pct: 96 } } };
    globalThis.api = { createWindow, tickLoop, loadSettings, patchSettings, quotaBlock, applyLang };
  `, sandbox);
  const api = sandbox.api;
  api.createWindow(); api.tickLoop();
  const tick = timers.find((t) => t.ms === 2000).fn;
  const count = () => sent.filter((x) => x.channel === "board").length;
  tick(); assert.equal(count(), 1, "first tick sends initial board");
  for (let i = 0; i < 10; i++) tick();
  assert.equal(count(), 1, "ten unchanged ticks send zero additional boards");
  for (const change of [() => { payload.tasks[0].status = "DONE"; },
    () => { payload.agents.codex.status = "idle"; }, () => api.applyLang("en"),
    () => { payload.usage.codex = { pct: 95 }; }]) {
    const before = count(); change(); tick(); tick(); assert.equal(count(), before + 1);
  }
  const beforeReload = count();
  callbacks["did-finish-load"](); assert.equal(count(), beforeReload + 1, "reload always receives board");
  const reads = settingsReads;
  for (let i = 0; i < 10; i++) { api.loadSettings(); api.quotaBlock("codex"); tick(); }
  assert.equal(settingsReads, reads, "settings are not reread on snapshot/tick/quota path");
  assert.equal(reads, 1);
  api.patchSettings((s) => { s.quotaStopPct = 96; });
  assert.equal(api.loadSettings().quotaStopPct, 96);
  assert.equal(JSON.parse(originalReadFile(settingsPath, "utf8")).quotaStopPct, 96);
  console.log("PERF OK (10 idle ticks: 0 IPC; unchanged quota files: 0 rereads; reset and reload preserved)");
} finally {
  fs.readSync = originalRead; fs.readFileSync = originalReadFile;
  fs.rmSync(dir, { recursive: true, force: true });
}
