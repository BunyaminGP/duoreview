import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const i18n = require("../app/i18n.js");
const inputLib = require("../app/input.js");
const layoutLib = require("../app/layout.js");
const taskViewLib = require("../app/taskview.js");
const {
  classifyDiffLine,
  parseDiffLines,
  buildTaskViewModel,
  createBoardListGuard,
} = taskViewLib;

test("1. taskDetail çıktısından kriterler, inceleme turları ve diff satır sınıfları üretilir", () => {
  const detail = {
    id: 5,
    title: "Bölme boyutlandırma",
    status: "REVIEW",
    owner: "gemini",
    assignee: "gemini",
    rounds: 1,
    description: "Ajan bölmeleri arasında ayırıcı ekle",
    acceptance: ["Ayırıcı çalışır", "Font 9-24 kırpılır", "Ekran görüntüsü alınır"],
    touches: ["app/layout.js", "app/renderer.js"],
    depends_on: [1],
    summary: "Ayırıcı ve font kontrolü eklendi",
    files: ["app/layout.js"],
    unclaimed: [],
    verify: { ok: true, cmd: "npm test", ms: 420 },
    diff: [
      "diff --git a/app/layout.js b/app/layout.js",
      "index 0000000..1111111 100644",
      "--- a/app/layout.js",
      "+++ b/app/layout.js",
      "@@ -1,2 +1,3 @@",
      " const MIN = 240;",
      "-const OLD = 300;",
      "+const NEW = 340;",
    ].join("\n"),
    reviews: [
      {
        reviewer: "claude",
        verdict: "request_changes",
        comment: "Alt sınırda boşluk kalıyor",
        checks: [
          { ok: false, evidence: "app/renderer.js:340" },
          { ok: true, evidence: "test/layout.test.mjs" },
          { ok: false, blocked: true, evidence: "sandbox ACL" },
        ],
        alternative: "1000fr ölçekleme kullan",
      },
    ],
  };

  const vm = buildTaskViewModel(detail);
  assert.equal(vm.id, 5);
  assert.equal(vm.who, "gemini");
  assert.equal(vm.criteria.length, 3);
  assert.deepEqual(
    vm.criteria.map((c) => c.status),
    ["fail", "ok", "blocked"]
  );
  assert.equal(vm.criteria[0].evidence, "app/renderer.js:340");
  assert.equal(vm.reviews.length, 1);
  assert.equal(vm.reviews[0].round, 1);
  assert.equal(vm.reviews[0].reviewer, "claude");
  assert.equal(vm.reviews[0].alternative, "1000fr ölçekleme kullan");

  assert.deepEqual(
    vm.diffLines.map((l) => l.kind),
    ["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add"]
  );
  assert.equal(classifyDiffLine("+eklenen"), "add");
  assert.equal(classifyDiffLine("-silinen"), "del");
  assert.equal(classifyDiffLine("+++ b/dosya"), "meta");
});

test("2. Boş diff, incelemesiz görev ve null girdi hata vermez", () => {
  assert.equal(buildTaskViewModel(null), null);
  assert.deepEqual(parseDiffLines(""), []);
  assert.deepEqual(parseDiffLines(null), []);

  const emptyTask = buildTaskViewModel({
    id: 2,
    title: "Yeni görev",
    status: "TODO",
    description: "",
    acceptance: ["İlk kriter"],
    touches: [],
    depends_on: [],
    diff: "",
    reviews: [],
  });
  assert.equal(emptyTask.id, 2);
  assert.equal(emptyTask.reviews.length, 0);
  assert.equal(emptyTask.diffLines.length, 0);
  assert.equal(emptyTask.criteria.length, 1);
  assert.equal(emptyTask.criteria[0].status, "pending");
});

test("3. Aynı board yükü iki kez geldiğinde #tasks ve #events replaceChildren ikinci seferde çağrılmaz", () => {
  const guard = createBoardListGuard();
  let tasksReplaceCount = 0;
  let eventsReplaceCount = 0;

  const fakeRenderBoard = (board, lang = "tr") => {
    if (guard.shouldRenderTasks(board.tasks, lang)) {
      tasksReplaceCount++;
    }
    if (guard.shouldRenderEvents(board.events)) {
      eventsReplaceCount++;
    }
  };

  const payload = {
    tasks: [{ id: 1, title: "Görev 1", status: "WORKING", owner: "claude", rounds: 0, depends_on: [] }],
    events: [{ id: 10, actor: "claude", text: "başladı", created_at: "2026-11-16" }],
  };

  fakeRenderBoard(payload, "tr");
  assert.equal(tasksReplaceCount, 1);
  assert.equal(eventsReplaceCount, 1);

  // Aynı yük ikinci kez geldiğinde replaceChildren çağrılmaz
  fakeRenderBoard(JSON.parse(JSON.stringify(payload)), "tr");
  assert.equal(tasksReplaceCount, 1);
  assert.equal(eventsReplaceCount, 1);

  // Görev durumu değişince yalnız tasks yenilenir
  payload.tasks[0].status = "DONE";
  fakeRenderBoard(payload, "tr");
  assert.equal(tasksReplaceCount, 2);
  assert.equal(eventsReplaceCount, 1);

  // Yeni olay gelince yalnız events yenilenir
  payload.events.push({ id: 11, actor: "claude", text: "bitti", created_at: "2026-11-16" });
  fakeRenderBoard(payload, "tr");
  assert.equal(tasksReplaceCount, 2);
  assert.equal(eventsReplaceCount, 2);

  // app/renderer.js içindeki gerçek renderBoard işlevini sahte DOM ile sına
  const elements = new Map();
  let domTasksReplace = 0;
  let domEventsReplace = 0;
  const makeEl = (id = "") => ({
    id,
    className: "",
    textContent: "",
    value: "",
    title: "",
    hidden: id === "reader" || id === "skills" || id === "advanced-panel",
    disabled: false,
    style: { setProperty() {} },
    dataset: {},
    scrollTop: 0,
    clientHeight: 100,
    scrollHeight: 100,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    append() {},
    replaceChildren() {
      if (id === "tasks") domTasksReplace++;
      if (id === "events") domEventsReplace++;
    },
    querySelector: () => makeEl(),
    getBoundingClientRect: () => ({ width: 300 }),
  });
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  getEl("teamsel").value = "claude,codex,gemini";
  getEl("captain").value = "claude";
  let onBoardCb = null;
  const win = {
    I18N: i18n,
    InputLib: inputLib,
    LayoutLib: layoutLib,
    TaskViewLib: taskViewLib,
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => ({ toString: () => "" }),
    bridge: {
      listModels: () => Promise.resolve({ claude: { models: [], current: "" }, codex: { models: [], current: "" }, gemini: { models: [], current: "" } }),
      preflight: () => Promise.resolve({}),
      onState() {},
      onData() {},
      onExit() {},
      onBoard: (cb) => { onBoardCb = cb; },
      resize() {},
      saveCfg() {},
    },
  };
  const ctx = {
    window: win,
    document: {
      documentElement: makeEl("html"),
      body: makeEl("body"),
      getElementById: getEl,
      createElement: (tag) => makeEl(tag),
      createTextNode: (txt) => ({ textContent: txt }),
      querySelector: () => makeEl("main"),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    Terminal: function () {
      return { options: {}, loadAddon() {}, open() {}, onData() {}, attachCustomKeyEventHandler() {}, hasSelection: () => false, getSelection: () => "" };
    },
    FitAddon: { FitAddon: function () { return { fit() {} }; } },
    ResizeObserver: function () { return { observe() {} }; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    setInterval() {},
    setTimeout,
    clearTimeout,
    Promise,
  };
  vm.runInNewContext(readFileSync("app/renderer.js", "utf8"), ctx);
  const boardMsg = {
    tasks: [{ id: 1, title: "Görev 1", status: "WORKING", owner: "claude", rounds: 0, depends_on: [] }],
    events: [{ id: 10, actor: "claude", text: "başladı", created_at: "2026-11-16" }],
    agents: { claude: { status: "busy", flow: "FINISH_WORK" }, codex: { status: "idle", flow: "" }, gemini: { status: "off", flow: "" } },
    usage: {},
    meta: {},
    notes: [],
    threads: [],
    claims: [],
  };
  onBoardCb(boardMsg);
  assert.equal(domTasksReplace, 1);
  assert.equal(domEventsReplace, 1);
  onBoardCb(JSON.parse(JSON.stringify(boardMsg)));
  assert.equal(domTasksReplace, 1, "aynı board yükünde #tasks replaceChildren tekrar çağrılmaz");
  assert.equal(domEventsReplace, 1, "aynı board yükünde #events replaceChildren tekrar çağrılmaz");
});
