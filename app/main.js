const { app, BrowserWindow, ipcMain, dialog, screen, clipboard, Notification } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const pty = require("node-pty");
const { buildSpec, resolveGemini, registerGemini, unregisterGemini, recoverGemini } = require("./agents");
const { protocol } = require("./protocol");
const { describeSpawnError } = require("./errtext");
const { createReferee } = require("./referee");
const usageLib = require("./usage");
const { createBoardSender } = require("./boardsig");
const { createNotifier } = require("./notify");
const { preflight } = require("./preflight");
const { createSessionStore } = require("./sessions");
const { createInjector } = require("./inject");
const { execFile } = require("node:child_process");
const { createLifecycle, createPasteTracker, createInputGate, MAX_MESSAGE } = require("./lifecycle");
const { CLAUDE_MODELS, codexModels, geminiModels } = require("./models");
const { talkMarkdown } = require("./talkmd");
const skills = require("./skills");
const I18N = require("./i18n");
const V = require("./validate");
const { t } = I18N;

const distDir = path.join(__dirname, "..", "dist").replace("app.asar", "app.asar.unpacked");
const DEFAULT_CFG = {
  captain: "claude",
  reviewMode: "after_all",
  kickoff: "joint",
  profile: "dengeli",
  verify: "",
  subagents: "research",
  models: { claude: "sonnet", codex: "", gemini: "" },     // "" = ajanın kendi varsayılanı
  efforts: { claude: "medium", codex: "medium", gemini: "medium" },
};
const geminiPath = () => { try { return resolveGemini(); } catch { return null; } };
// Takım kaydedilmemişse agy kuruluysa üçlü, değilse eski ikili
const defaultTeam = () => (geminiPath() ? ["claude", "codex", "gemini"] : ["claude", "codex"]);
const geminiStateFile = () => path.join(app.getPath("userData"), "gemini-registration.json");
const FAKE = !!process.env.DUOREVIEW_FAKE; // gerçek ajan yerine cmd.exe (hakem denemeleri için)

const pendingInitial = {}; // agent -> henüz teslim edilmemiş protokol metni
const lastData = {}; // agent -> terminalden gelen son çıktının zamanı
let sessions;
let discovering = null;
let win, projectDir, db, dbmod, flow, srvI18n, referee;

// ---- dil -------------------------------------------------------------------
// Önce kullanıcının seçimi, yoksa işletim sistemi dili (Türkçe değilse İngilizce).
function applyLang(code) {
  I18N.setLang(code);
  srvI18n?.setLang(I18N.getLang()); // akış/olay metinleri (uygulama sürecindeki flow.js)
}

// ---- ayarlar -------------------------------------------------------------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let settings;
const loadSettings = () => {
  if (settings === undefined) {
    try { settings = JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { settings = {}; }
  }
  return settings;
};
const saveSettings = (s) => {
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
  settings = s;
};
const cfgFor = (dir) => {
  const saved = loadSettings().byProject?.[dir] ?? {};
  // Kullanıcı talimatı hiç değiştirmediyse varsayılan metin geçerli dilde gösterilir
  const stock = Object.values(I18N.STR).some((s) => s.defaultBrief === saved.brief);
  return {
    ...DEFAULT_CFG, team: defaultTeam(), ...saved,
    brief: !saved.brief || stock ? t("defaultBrief") : saved.brief,
    models: { ...DEFAULT_CFG.models, ...saved.models },
    efforts: { ...DEFAULT_CFG.efforts, ...saved.efforts },
  };
};

function patchSettings(fn) {
  const s = { ...loadSettings() };
  fn(s);
  saveSettings(s);
}

// Köprü verisi projenin dışında tutulur: proje deposu (git add -A vb.) kirlenmez.
function dataDirFor(dir) {
  const override = process.argv.find((a, i) => process.argv[i - 1] === "--data");
  if (override) return path.resolve(override);
  dir = path.normalize(dir); // C:/x ve C:\x aynı klasör sayılsın
  const slug = path.basename(dir).replace(/[^\w.-]+/g, "_") || "proje";
  const key = process.platform === "win32" ? dir.toLowerCase() : dir; // yalnız Windows'ta büyük/küçük harf aynı klasör
  const hash = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return path.join(app.getPath("userData"), "projects", `${slug}-${hash}`);
}

function openProjectDb() {
  try { db?.close(); } catch {}
  db = dbmod.openDb(dataDirFor(projectDir));
  sessions = createSessionStore(dataDirFor(projectDir));
  discoverSession();
}

function discoverSession() {
  if (FAKE || !sessions) return Promise.resolve();
  const store = sessions;
  if (discovering?.store === store) return discovering.promise;
  const promise = store.discover(projectDir).then((changed) => {
    if (changed && sessions === store) send("state", stateSnapshot());
  }).catch((e) => console.error("sessions", e)).finally(() => {
    if (discovering?.store === store) discovering = null;
  });
  discovering = { store, promise };
  return promise;
}

const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_)/.test(k)));

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const running = () => life.active();

function whyText(agent) {
  const w = life.why(agent);
  if (!w) return "";
  return w.error ? describeSpawnError(agent, w.error).summary : t(w.key, w);
}

function stateSnapshot() {
  const s = loadSettings();
  return {
    projectDir, recents: s.recents ?? [], cfg: cfgFor(projectDir), running: running(), fake: FAKE, lang: I18N.getLang(),
    life: Object.fromEntries(V.AGENTS.map((a) => [a, life.life(a)])),
    lifeWhy: Object.fromEntries(V.AGENTS.map((a) => [a, whyText(a)])),
    resumable: sessions?.resumable() ?? { claude: false, codex: false, gemini: false },
    ui: V.sanitizeUi(s.ui),
  };
}

function setProject(dir) {
  projectDir = dir;
  for (const a of V.AGENTS) delete pendingInitial[a];
  patchSettings((s) => { s.projectDir = dir; s.recents = [dir, ...(s.recents ?? []).filter((d) => d !== dir)].slice(0, 8); });
  openProjectDb();
  send("state", stateSnapshot());
  publishBoard(true);
}

// ---- ajanlar -------------------------------------------------------------
// Yeniden başlayan süreç eski TUI'nin açık bıraktığı ekran/fare/yapıştırma kiplerini devralmasın; geçmiş ekranda kalır.
const RESET_MODES = "\x1b[?1049l\x1b[?2004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h";
const RESUME_FAIL_MS = 10_000; // sürdürülen oturum bu süre dolmadan hata ile kapanırsa bir kez yeni oturum açılır
const paste = Object.fromEntries(V.AGENTS.map((a) => [a, createPasteTracker()]));
const note = (agent, text) => send("pty:data", { agent, data: `\r\n\x1b[90m[${text}]\x1b[0m\r\n` });

const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function killTree(pid) {
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => {});
  else try { process.kill(-pid, "SIGKILL"); } catch { process.kill(pid, "SIGKILL"); }
}

const life = createLifecycle({
  agents: V.AGENTS, killTree, alive,
  spawn: (agent, { cols, rows, sessionId, resume, sessionTag }) => {
    const cfg = cfgFor(projectDir);
    const spec = FAKE ? { file: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/sh", args: [] }
      : buildSpec(agent, dataDirFor(projectDir), { model: cfg.models[agent], effort: cfg.efforts[agent], projectDir, sessionId, resume, sessionTag });
    try {
      if (agent === "gemini" && !FAKE) registerGemini(dataDirFor(projectDir), undefined, { projectDir, stateFile: geminiStateFile() });
      return pty.spawn(spec.file, spec.args, { name: "xterm-256color", cols, rows, cwd: projectDir, env: cleanEnv() });
    } catch (e) {
      if (agent === "gemini" && !FAKE) unregisterGemini();
      throw e;
    }
  },
  onData: (agent, data) => {
    lastData[agent] = Date.now();
    paste[agent].feed(data);
    referee.noteOutput(agent, data);
    send("pty:data", { agent, data });
  },
  onExit: (agent, { exitCode, userStop, startedAt, opts }) => {
    if (agent === "gemini" && !FAKE) unregisterGemini();
    referee.stop(agent);
    send("pty:exit", { agent, exitCode });
    if (agent === "codex") discoverSession();
    if (userStop) return;
    if (exitCode !== 0) flow.logEvent(db, "app", `${agent}: ${t("lifeExit", { code: exitCode })}`);
    // Sürdürülecek oturum bulunamadıysa CLI hemen kapanır: bir kez yeni oturumla açılır
    if (opts.resume && exitCode !== 0 && Date.now() - startedAt < RESUME_FAIL_MS) {
      try { sessions.forget(agent); } catch (e) { console.error("sessions", e); }
      note(agent, t("termResumeFailed"));
      queueProtocol(agent);
      startAgent(agent, opts.cols, opts.rows, true);
    }
  },
  onChange: () => send("state", stateSnapshot()),
});

// Takım çalışırken tek başına yeniden açılan ajana protokol yeniden gider
function queueProtocol(agent) {
  const team = flow.teamOf(db);
  if (flow.getMeta(db, "team", "") && flow.getMeta(db, "brief", null) !== null && team.includes(agent)) pendingInitial[agent] = protocol(agent, team);
}

// fresh açık değilse yalnız uygulamanın kaydettiği kimlik sürdürülür.
function startAgent(agent, cols = 100, rows = 30, fresh = false) {
  const opts = FAKE ? { resume: false } : sessions.prepare(agent, fresh);
  const r = life.start(agent, { cols, rows, ...opts });
  if (!r.ok) {
    if (r.error instanceof Error) {
      const { summary, terminalText } = describeSpawnError(agent, r.error);
      send("pty:data", { agent, data: terminalText });
      flow.logEvent(db, "app", summary);
      referee.stop(agent);
    } else if (r.error !== "running") note(agent, t(r.error));
    return;
  }
  if (!FAKE) try { sessions.started(agent, opts); } catch (e) { console.error("sessions", e); }
  send("state", stateSnapshot());
  paste[agent].reset();
  if (r.gen > 1) {
    send("pty:data", { agent, data: RESET_MODES });
    note(agent, t(opts.resume ? "termResume" : "termNewSession"));
  }
  referee.start(agent);
  // Takım başlatılırken bu ajan açılamadıysa, sonradan "Başlat" ile açıldığında protokol yine gider.
  if (pendingInitial[agent]) { referee.queueInitial(agent, pendingInitial[agent]); delete pendingInitial[agent]; }
}

const inject = createInjector({
  write: (agent, data) => { const term = life.current(agent); if (!term) return false; term.write(data); return true; },
  generation: (agent) => life.generation(agent),
  lastOutputAt: (agent) => lastData[agent] ?? 0,
  awaitingApproval: (agent) => referee.awaitingApproval(agent),
});

// Mesaj alanı doluyken hakem o ajana yazmaz. Kullanıcı ayrılırsa takım durmasın: son tuştan 60 sn sonra kilit kalkar.
const HOLD_IDLE_MS = 60_000;
const holds = Object.fromEntries(V.AGENTS.map((a) => [a, { user: false, sending: false, timer: null }]));
const applyHold = (agent) => referee.hold(agent, holds[agent].user || holds[agent].sending);

const gate = createInputGate({
  isAgent: V.isAgent, inject,
  current: (agent) => life.current(agent),
  awaitingApproval: (agent) => referee.awaitingApproval(agent),
  noteInput: (agent) => referee.noteInput(agent),
  bracketed: (agent) => paste[agent].on,
  setHold: (agent, held) => { holds[agent].sending = held; applyHold(agent); },
});

// ---- pano ----------------------------------------------------------------
const sendBoard = createBoardSender((payload) => send("board", payload));
const notify = createNotifier((message) => {
  if (Notification?.isSupported()) new Notification(message).show();
  win?.flashFrame(true);
});
const publishBoard = (force = false) => {
  const payload = board();
  const focused = win?.isFocused?.() ?? true;
  if (focused) win?.flashFrame?.(false);
  notify(payload, { focused, language: I18N.getLang(), projectDir });
  return sendBoard(payload, I18N.getLang(), force);
};
function board() {
  const tasks = db.prepare("SELECT id,title,status,assignee,owner,rounds,depends_on,reviewer FROM tasks ORDER BY id").all()
    .map((x) => ({ ...x, depends_on: JSON.parse(x.depends_on), reviewer: x.owner && x.status !== "DONE" ? flow.reviewerOf(db, x) : null }));
  const events = db.prepare("SELECT id,actor,text,created_at FROM events ORDER BY id DESC LIMIT 80").all().reverse();
  const meta = Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((r) => [r.key, r.value]));
  const threads = db.prepare(
    "SELECT t.id, t.kind, t.topic, t.status, t.outcome, (SELECT COUNT(*) FROM posts p WHERE p.thread_id=t.id) posts FROM threads t ORDER BY t.id").all();
  const notes = db.prepare("SELECT id, author, kind, title, length(text) size FROM notes ORDER BY id").all();
  const claims = flow.ledger(db).map((c) => ({ id: c.id, by: c.by, text: c.text, status: c.status, posts: c.assessments.length + c.rebuttals.length }));
  return { tasks, events, meta, threads, notes, claims, agents: referee.statuses(), usage };
}

// ---- kalan kullanım --------------------------------------------------------
let usage = { claude: null, codex: null, gemini: null };
function refreshUsage() {
  try {
    usage = {
      codex: usageLib.readCodexUsage(),
      claude: usageLib.readClaudeUsage(path.join(dataDirFor(projectDir), "claude-status.json")),
      gemini: { ok: false, note: t("noGeminiUsage") },
    };
  } catch (e) { console.error("usage", e); }
}
// Kota koruması: 5 saatlik pencere eşiği aştıysa hakem o ajana yazmaz (boş yere token yakmasın).
const quotaStopPct = () => loadSettings().quotaStopPct ?? 95;
function quotaBlock(agent) {
  const u = usage[agent];
  if (u?.ok && u.five && u.five.pct >= quotaStopPct()) return t("quota5h", { pct: u.five.pct });
  if (u?.ok && u.week && u.week.pct >= 99) return t("quotaWeek", { pct: u.week.pct });
  return null;
}

function tickLoop() {
  refreshUsage();
  setInterval(refreshUsage, 8000);
  setInterval(discoverSession, 8000);
  setInterval(() => {
    try { referee.tick(); publishBoard(); } catch (e) { console.error("tick", e); }
  }, 2000);
}

// ---- pencere -------------------------------------------------------------
function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize; // üç terminal yan yana: ekran elverdiğince geniş
  win = new BrowserWindow({
    width: Math.min(1920, area.width), height: Math.min(1000, area.height), backgroundColor: "#0f1115", title: "DuoReview",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("did-finish-load", () => { send("state", stateSnapshot()); publishBoard(true); });
}

ipcMain.handle("project:pick", async () => {
  if (running().length) return false;
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory"], defaultPath: projectDir });
  if (!r.canceled) setProject(r.filePaths[0]);
  return true;
});
ipcMain.handle("project:set", (_e, dir) => {
  if (running().length || !V.isDir(dir)) return false;
  setProject(dir);
  return true;
});
ipcMain.handle("board:reset", () => {
  if (running().length) return false;
  for (const a of V.AGENTS) delete pendingInitial[a];
  for (const t of ["tasks", "reviews", "messages", "events", "meta", "notes", "threads", "posts", "claims", "assessments", "rebuttals", "decisions", "deliveries"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
  publishBoard(true);
  return true;
});
ipcMain.handle("task:resolve", (_e, { id, decision, note } = {}) => {
  if (!Number.isInteger(id) || !V.DECISIONS.includes(decision)) return false;
  const ok = flow.resolveDispute(db, id, decision, String(note || "").slice(0, 2000));
  publishBoard(true);
  return ok;
});
ipcMain.handle("task:reviewer", (_e, { id, agent } = {}) => {
  if (!Number.isInteger(id) || !V.isAgent(agent)) return false;
  const ok = flow.setReviewer(db, id, agent);
  publishBoard(true);
  return ok;
});
ipcMain.handle("lang:set", (_e, code) => {
  patchSettings((s) => { s.lang = I18N.norm(code); });
  applyLang(code);
  send("state", stateSnapshot());
  publishBoard(true);
});
ipcMain.handle("models:list", async () => {
  const agy = geminiPath();
  return {
    claude: { models: CLAUDE_MODELS, current: "" },
    codex: codexModels(undefined, usageLib.listCodexModels()),
    gemini: { models: agy ? await geminiModels(agy) : [], current: "" },
  };
});
ipcMain.handle("talk:get", () => flow.discussion(db));
const talkLabels = () => Object.fromEntries(
  Object.keys(I18N.STR.tr).filter((k) => k.startsWith("k_")).map((k) => [k.slice(2), t(k)]));
ipcMain.handle("talk:export", async () => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(projectDir, "duoreview-notes.md"), filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, talkMarkdown(flow.discussion(db), { title: t("exportTitle"), labels: talkLabels() }));
  return true;
});
// Skill'ler proje klasörüne yazılır; çalışan ajan yeni skill'i yeniden başlayınca görür.
ipcMain.handle("skills:list", () => skills.list(projectDir));
ipcMain.handle("skills:add", async () => {
  const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "multiSelections"], title: t("skillsPick") });
  const res = { added: [], errors: [] };
  if (!r.canceled) {
    for (const src of r.filePaths) {
      try { const x = skills.add(projectDir, src); res.added.push(...x.added); res.errors.push(...x.errors); }
      catch (e) { res.errors.push({ name: path.basename(src), error: e.message }); }
    }
  }
  return { ...res, list: skills.list(projectDir) };
});
ipcMain.handle("skills:remove", (_e, name) => {
  try { skills.remove(projectDir, name); } catch (e) { console.error("skills", e); }
  return skills.list(projectDir);
});
ipcMain.on("cfg:save", (_e, cfg) => patchSettings((s) => { s.byProject = { ...s.byProject, [projectDir]: V.sanitizeCfg(cfg) }; }));
ipcMain.on("ui:save", (_e, ui) => {
  patchSettings((s) => { s.ui = V.sanitizeUi(ui); });
  send("state", stateSnapshot());
});
ipcMain.handle("preflight:get", () => preflight());
ipcMain.handle("task:get", (_e, id) => Number.isSafeInteger(id) && id > 0 ? flow.taskDetail(db, id) : null);
ipcMain.on("pty:start", async (_e, { agent, cols, rows, fresh } = {}) => {
  if (!V.isAgent(agent)) return;
  const dir = projectDir;
  if (agent === "codex" && fresh !== true) await discoverSession();
  if (projectDir !== dir) return;
  queueProtocol(agent);
  startAgent(agent, V.dim(cols, 100), V.dim(rows, 30), fresh === true);
});
ipcMain.on("pty:write", (_e, { agent, data } = {}) => {
  const r = gate.write(agent, data);
  if (r.error === "sendTermLong") note(agent, t(r.error, { max: MAX_MESSAGE }));
});
ipcMain.on("pty:resize", (_e, { agent, cols, rows } = {}) => {
  if (V.isAgent(agent) && V.dim(cols, 0) && V.dim(rows, 0)) life.current(agent)?.resize(cols, rows);
});
ipcMain.on("pty:kill", (_e, { agent } = {}) => {
  if (!V.isAgent(agent)) return;
  inject.cancel(agent);
  life.stop(agent);
});
// Kullanıcının mesajı terminale veri olarak gider (bracketed paste); pano ya da tuş taklidi kullanılmaz.
ipcMain.handle("agent:send", async (_e, { agent, text } = {}) => {
  const r = await gate.send(agent, text);
  return r.ok ? r : { ok: false, error: t(r.error, { max: MAX_MESSAGE }) };
});
ipcMain.on("agent:hold", (_e, { agent, held } = {}) => {
  if (!V.isAgent(agent)) return;
  const h = holds[agent];
  clearTimeout(h.timer);
  h.user = !!held;
  h.timer = h.user ? setTimeout(() => { h.user = false; applyHold(agent); }, HOLD_IDLE_MS) : null;
  applyHold(agent);
});
ipcMain.handle("clip:read", () => clipboard.readText());
ipcMain.on("clip:write", (_e, text) => { if (typeof text === "string") clipboard.writeText(text); });

process.on("uncaughtException", (e) => console.error("uncaught", e));

ipcMain.on("team:start", async (_e, payload = {}) => {
  const dir = projectDir;
  if (payload.fresh !== true) await discoverSession();
  if (projectDir !== dir) return;
  const cfg = V.sanitizeCfg(payload.cfg);
  const sizes = payload.sizes && typeof payload.sizes === "object" ? payload.sizes : {};
  // Görev çıkmamış bir turdan (yalnız inceleme) sonra yeni talimat gelirse açılış baştan yapılır; eski notlar kalır.
  const restart = flow.total(db) === 0 && flow.getMeta(db, "brief", cfg.brief) !== cfg.brief;
  if (!restart && flow.teamChangeBlocked(db, cfg.team)) {
    dialog.showMessageBox(win, { type: "warning", message: t("teamLocked", { team: flow.teamOf(db).join(" + ") }) });
    return;
  }
  patchSettings((s) => { s.byProject = { ...s.byProject, [projectDir]: cfg }; });
  flow.setMeta(db, "team", cfg.team.join(","));
  flow.setMeta(db, "captain", cfg.captain);
  flow.setMeta(db, "review_mode", cfg.reviewMode);
  flow.setMeta(db, "kickoff", cfg.kickoff);
  flow.setMeta(db, "verify", cfg.verify);
  flow.setMeta(db, "subagents", cfg.subagents);
  if (restart) {
    db.exec("UPDATE notes SET kind='note' WHERE kind='kickoff'");
    db.exec("UPDATE threads SET status='CLOSED', outcome=COALESCE(outcome,'split') WHERE status='OPEN'");
    flow.setMeta(db, "planned", "0");
    flow.setMeta(db, "consensus", "0");
  }
  flow.setMeta(db, "brief", cfg.brief);
  flow.logEvent(db, "app", t("evTeamStarted", { team: cfg.team.join(", "), captain: cfg.captain, mode: t(cfg.reviewMode === "immediate" ? "evModeImmediate" : "evModeAfterAll"), kickoff: t({ joint: "kickoffJoint", cross: "kickoffCross" }[cfg.kickoff] ?? "kickoffSolo") }));
  const resume = db.prepare("SELECT COUNT(*) n FROM tasks").get().n > 0;
  if (resume) flow.logEvent(db, "app", t("evResume"));
  for (const a of cfg.team) {
    pendingInitial[a] = protocol(a, cfg.team);
    startAgent(a, V.dim(sizes[a]?.cols, 100), V.dim(sizes[a]?.rows, 30), payload.fresh === true);
  }
});

// ---- açılış --------------------------------------------------------------
// Uygulama eski adıyla (agentbridge) kaydettiği ayar ve panoları yeni ada bir kez taşır.
function migrateOldData() {
  try {
    const cur = app.getPath("userData");
    const old = path.join(app.getPath("appData"), "agentbridge");
    if (fs.existsSync(path.join(cur, "settings.json")) || !fs.existsSync(old)) return;
    fs.mkdirSync(cur, { recursive: true });
    for (const n of ["settings.json", "projects"]) {
      if (fs.existsSync(path.join(old, n))) fs.cpSync(path.join(old, n), path.join(cur, n), { recursive: true });
    }
  } catch (e) { console.error("migrate", e); }
}

app.whenReady().then(async () => {
  migrateOldData();
  if (!FAKE) try { recoverGemini(geminiStateFile()); } catch (e) { console.error("gemini", e); }
  dbmod = await import(pathToFileURL(path.join(distDir, "db.js")).href);
  flow = await import(pathToFileURL(path.join(distDir, "flow.js")).href);
  srvI18n = await import(pathToFileURL(path.join(distDir, "i18n.js")).href);
  const arg = (name) => process.argv.find((a, i) => process.argv[i - 1] === name);
  applyLang(arg("--lang") || loadSettings().lang || app.getLocale());
  projectDir = arg("--project") || loadSettings().projectDir || process.cwd();
  openProjectDb();
  referee = await createReferee({ distDir, getDb: () => db, write: inject, blocked: quotaBlock });
  createWindow();
  tickLoop();

  const shot = arg("--screenshot");
  if (shot) {
    win.webContents.on("console-message", (_e, level, msg) => console.log("[renderer]", level, msg));
    setTimeout(() => {
      if (process.argv.includes("--team")) win.webContents.executeJavaScript('document.getElementById("team").click()');
      setTimeout(async () => {
        fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
        app.exit(0);
      }, Number(arg("--wait")) || 1500);
    }, 2500);
  }
});

app.on("window-all-closed", () => {
  if (life.active().includes("gemini") && !FAKE) unregisterGemini();
  life.killAll();
  try { db?.close(); } catch {}
  app.quit();
});
