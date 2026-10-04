const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const pty = require("node-pty");
const { buildSpec } = require("./agents");
const { protocol } = require("./protocol");
const { describeSpawnError } = require("./errtext");
const { createReferee, AGENTS } = require("./referee");
const usageLib = require("./usage");
const I18N = require("./i18n");
const V = require("./validate");
const { t } = I18N;

const distDir = path.join(__dirname, "..", "dist").replace("app.asar", "app.asar.unpacked");
const DEFAULT_CFG = {
  captain: "claude",
  reviewMode: "after_all",
  profile: "dengeli",
  models: { claude: "sonnet", codex: "" },     // "" = ajanın kendi varsayılanı
  efforts: { claude: "medium", codex: "medium" },
};
const FAKE = !!process.env.DUOREVIEW_FAKE; // gerçek ajan yerine cmd.exe (hakem denemeleri için)

const terms = {}; // agent -> pty
const pendingInitial = {}; // agent -> henüz teslim edilmemiş protokol metni
let win, projectDir, db, dbmod, flow, srvI18n, referee;

// ---- dil -------------------------------------------------------------------
// Önce kullanıcının seçimi, yoksa işletim sistemi dili (Türkçe değilse İngilizce).
function applyLang(code) {
  I18N.setLang(code);
  srvI18n?.setLang(I18N.getLang()); // akış/olay metinleri (uygulama sürecindeki flow.js)
}

// ---- ayarlar -------------------------------------------------------------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch { return {}; } };
const saveSettings = (s) => fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
const cfgFor = (dir) => {
  const saved = loadSettings().byProject?.[dir] ?? {};
  // Kullanıcı talimatı hiç değiştirmediyse varsayılan metin geçerli dilde gösterilir
  const stock = Object.values(I18N.STR).some((s) => s.defaultBrief === saved.brief);
  return {
    ...DEFAULT_CFG, ...saved,
    brief: !saved.brief || stock ? t("defaultBrief") : saved.brief,
    models: { ...DEFAULT_CFG.models, ...saved.models },
    efforts: { ...DEFAULT_CFG.efforts, ...saved.efforts },
  };
};

function patchSettings(fn) {
  const s = loadSettings();
  fn(s);
  saveSettings(s);
}

// Köprü verisi projenin dışında tutulur: proje deposu (git add -A vb.) kirlenmez.
function dataDirFor(dir) {
  dir = path.normalize(dir); // C:/x ve C:\x aynı klasör sayılsın
  const slug = path.basename(dir).replace(/[^\w.-]+/g, "_") || "proje";
  const hash = crypto.createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 8);
  return path.join(app.getPath("userData"), "projects", `${slug}-${hash}`);
}

function openProjectDb() {
  try { db?.close(); } catch {}
  db = dbmod.openDb(dataDirFor(projectDir));
}

const cleanEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_)/.test(k)));

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const running = () => Object.keys(terms);

function stateSnapshot() {
  const s = loadSettings();
  return { projectDir, recents: s.recents ?? [], cfg: cfgFor(projectDir), running: running(), fake: FAKE, lang: I18N.getLang() };
}

function setProject(dir) {
  projectDir = dir;
  patchSettings((s) => { s.projectDir = dir; s.recents = [dir, ...(s.recents ?? []).filter((d) => d !== dir)].slice(0, 8); });
  openProjectDb();
  send("state", stateSnapshot());
  send("board", board());
}

// ---- ajanlar -------------------------------------------------------------
function startAgent(agent, cols = 100, rows = 30) {
  if (terms[agent]) return;
  let term;
  try {
    const cfg = cfgFor(projectDir);
    const spec = FAKE ? { file: process.platform === "win32" ? "cmd.exe" : process.env.SHELL || "/bin/sh", args: [] }
      : buildSpec(agent, dataDirFor(projectDir), { model: cfg.models[agent], effort: cfg.efforts[agent] });
    term = pty.spawn(spec.file, spec.args, {
      name: "xterm-256color", cols, rows, cwd: projectDir, env: cleanEnv(),
    });
  } catch (e) {
    const { summary, terminalText } = describeSpawnError(agent, e);
    send("pty:data", { agent, data: terminalText });
    flow.logEvent(db, "app", summary);
    referee.stop(agent);
    return;
  }
  terms[agent] = term;
  referee.start(agent);
  // Takım başlatılırken bu ajan açılamadıysa, sonradan "Başlat" ile açıldığında protokol yine gider.
  if (pendingInitial[agent]) { referee.queueInitial(agent, pendingInitial[agent]); delete pendingInitial[agent]; }
  term.onData((data) => { referee.noteOutput(agent, data); send("pty:data", { agent, data }); });
  term.onExit(({ exitCode }) => {
    delete terms[agent];
    referee.stop(agent);
    send("pty:exit", { agent, exitCode });
    send("state", stateSnapshot());
  });
  send("state", stateSnapshot());
}

// TUI'ler yapıştırmayı farklı işlediği için metin ve Enter ayrı gönderilir.
function inject(agent, text) {
  const term = terms[agent];
  if (!term) return;
  term.write(text);
  setTimeout(() => terms[agent]?.write("\r"), 400);
}

// ---- pano ----------------------------------------------------------------
function board() {
  const tasks = db.prepare("SELECT id,title,status,assignee,owner,rounds FROM tasks ORDER BY id").all();
  const events = db.prepare("SELECT id,actor,text,created_at FROM events ORDER BY id DESC LIMIT 80").all().reverse();
  const meta = Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((r) => [r.key, r.value]));
  return { tasks, events, meta, agents: referee.statuses(), usage };
}

// ---- kalan kullanım --------------------------------------------------------
let usage = { claude: null, codex: null };
function refreshUsage() {
  try {
    usage = {
      codex: usageLib.readCodexUsage(),
      claude: usageLib.readClaudeUsage(path.join(dataDirFor(projectDir), "claude-status.json")),
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
  setInterval(() => {
    try { referee.tick(); send("board", board()); } catch (e) { console.error("tick", e); }
  }, 2000);
}

// ---- pencere -------------------------------------------------------------
function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 920, backgroundColor: "#0f1115", title: "DuoReview",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("did-finish-load", () => { send("state", stateSnapshot()); send("board", board()); });
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
  for (const t of ["tasks", "reviews", "messages", "events", "meta"]) db.exec(`DELETE FROM ${t}`);
  db.exec("DELETE FROM sqlite_sequence");
  send("board", board());
  return true;
});
ipcMain.handle("task:resolve", (_e, { id, decision, note } = {}) => {
  if (!Number.isInteger(id) || !V.DECISIONS.includes(decision)) return false;
  const ok = flow.resolveDispute(db, id, decision, String(note || "").slice(0, 2000));
  send("board", board());
  return ok;
});
ipcMain.handle("lang:set", (_e, code) => {
  patchSettings((s) => { s.lang = I18N.norm(code); });
  applyLang(code);
  send("state", stateSnapshot());
  send("board", board());
});
ipcMain.handle("models:list", () => ({
  claude: ["sonnet", "opus", "haiku", "fable", "claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
  codex: usageLib.listCodexModels(),
}));
ipcMain.on("cfg:save", (_e, cfg) => patchSettings((s) => { s.byProject = { ...s.byProject, [projectDir]: V.sanitizeCfg(cfg) }; }));
ipcMain.on("pty:start", (_e, { agent, cols, rows } = {}) => { if (V.isAgent(agent)) startAgent(agent, V.dim(cols, 100), V.dim(rows, 30)); });
ipcMain.on("pty:write", (_e, { agent, data } = {}) => {
  if (!V.isAgent(agent) || typeof data !== "string" || data.length > 100_000) return;
  referee.noteInput(agent); terms[agent]?.write(data);
});
ipcMain.on("pty:resize", (_e, { agent, cols, rows } = {}) => {
  if (V.isAgent(agent) && V.dim(cols, 0) && V.dim(rows, 0)) terms[agent]?.resize(cols, rows);
});
ipcMain.on("pty:kill", (_e, { agent } = {}) => { if (V.isAgent(agent)) terms[agent]?.kill(); });

process.on("uncaughtException", (e) => console.error("uncaught", e));

ipcMain.on("team:start", (_e, payload = {}) => {
  const cfg = V.sanitizeCfg(payload.cfg);
  const sizes = payload.sizes && typeof payload.sizes === "object" ? payload.sizes : {};
  patchSettings((s) => { s.byProject = { ...s.byProject, [projectDir]: cfg }; });
  flow.setMeta(db, "captain", cfg.captain);
  flow.setMeta(db, "review_mode", cfg.reviewMode);
  flow.logEvent(db, "app", t("evTeamStarted", { captain: cfg.captain, mode: t(cfg.reviewMode === "immediate" ? "evModeImmediate" : "evModeAfterAll") }));
  const resume = db.prepare("SELECT COUNT(*) n FROM tasks").get().n > 0;
  if (resume) flow.logEvent(db, "app", t("evResume"));
  for (const a of AGENTS) {
    pendingInitial[a] = protocol(a, { ...cfg, projectDir, resume });
    startAgent(a, V.dim(sizes[a]?.cols, 100), V.dim(sizes[a]?.rows, 30));
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
  Object.values(terms).forEach((t) => t.kill());
  try { db?.close(); } catch {}
  app.quit();
});
