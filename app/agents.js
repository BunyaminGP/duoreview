// Ajan komutlarını ve MCP bağlantısını üretir. Claude'a --mcp-config, Codex'e -c geçersiz kılmaları ile bağlanır;
// bu ikisinde kullanıcının global ayarlarına dokunulmaz. Gemini (agy) MCP sunucusunu ve araç iznini yalnız global ayardan okur:
// kayıt ajan başlarken yazılır, kapanınca geri alınır (registerGemini / unregisterGemini).
// Yürütülebilirler sırayla aranır: ortam değişkeni (…_CLAUDE_BIN / …_CODEX_BIN / …_GEMINI_BIN) → bilinen kurulum yerleri → PATH.
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { t, getLang } = require("./i18n");

const IS_WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// Claude Code güncellenince Windows'ta npm kurulumu bozulabiliyor (bin/claude.exe 500 baytlık yer tutucu kalıyor).
const isRealExe = (p) => { try { return fs.statSync(p).size > 1_000_000; } catch { return false; } };

const pathDirs = () => (process.env.PATH || "").split(path.delimiter).filter(Boolean);
/** PATH'te verilen adlardan ilkini bulur; yoksa null. */
function onPath(names) {
  for (const dir of pathDirs()) for (const n of names) {
    const p = path.join(dir, n);
    if (isFile(p)) return p;
  }
  return null;
}

/** npm'in global bin klasörü (claude.cmd / codex.cmd burada durur). Yalnız Windows. */
function npmBinDir() {
  const appData = process.env.APPDATA && path.join(process.env.APPDATA, "npm");
  if (appData && fs.existsSync(path.join(appData, "claude.cmd"))) return appData;
  const found = onPath(["claude.cmd", "codex.cmd"]);
  return found ? path.dirname(found) : appData;
}

function resolveClaude() {
  const forced = process.env.DUOREVIEW_CLAUDE_BIN;
  if (forced && isFile(forced)) return forced;
  const home = os.homedir();
  let candidates, ok = isFile;
  if (IS_WIN) {
    const pkg = path.join(npmBinDir() || "", "node_modules", "@anthropic-ai", "claude-code");
    candidates = [
      path.join(pkg, "node_modules", "@anthropic-ai", "claude-code-win32-x64", "claude.exe"),
      path.join(pkg, "bin", "claude.exe"),
      path.join(home, ".local", "bin", "claude.exe"),
      ...pathDirs().map((d) => path.join(d, "claude.exe")),
    ];
    ok = isRealExe;
  } else {
    candidates = [
      ...pathDirs().map((d) => path.join(d, "claude")),
      path.join(home, ".local", "bin", "claude"),
      path.join(home, ".claude", "local", "claude"),
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];
  }
  const found = candidates.find(ok);
  if (!found) throw new Error(t("claudeNotFound", { tried: candidates.slice(0, 3).join("\n  ") }));
  return found;
}

const findNode = () => {
  const p = onPath(IS_WIN ? ["node.exe"] : ["node"]);
  if (!p) throw new Error(t("notOnPath", { name: "node" }));
  return p;
};

/** Codex'i başlatacak { file, args } öneki. */
function resolveCodex() {
  const forced = process.env.DUOREVIEW_CODEX_BIN;
  if (forced && isFile(forced)) return { file: forced, args: [] };
  if (IS_WIN) {
    const js = path.join(npmBinDir() || "", "node_modules", "@openai", "codex", "bin", "codex.js");
    if (isFile(js)) return { file: findNode(), args: [js] };
    const exe = onPath(["codex.exe"]);
    if (exe) return { file: exe, args: [] };
    const cmd = onPath(["codex.cmd"]);
    if (cmd) return { file: process.env.ComSpec || "cmd.exe", args: ["/d", "/c", cmd] };
  } else {
    const bin = onPath(["codex"]) || [path.join(os.homedir(), ".local", "bin", "codex"), "/usr/local/bin/codex", "/opt/homebrew/bin/codex"].find(isFile);
    if (bin) return { file: bin, args: [] };
  }
  throw new Error(t("codexNotFound"));
}

/** Antigravity CLI (agy). Gemini CLI kişisel hesaplara kapandı; Gemini'ye terminalden bu ulaşıyor. */
function resolveGemini() {
  const forced = process.env.DUOREVIEW_GEMINI_BIN;
  if (forced && isFile(forced)) return forced;
  // Kurulum PATH'i kullanıcı kaydına yazar; kurulumdan önce açılmış uygulama onu görmez, varsayılan yere de bakılır.
  const found = onPath(IS_WIN ? ["agy.exe"] : ["agy"]) ||
    (IS_WIN ? [path.join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe")] : [path.join(os.homedir(), ".local", "bin", "agy")]).find(isFile);
  if (!found) throw new Error(t("geminiNotFound"));
  return found;
}

function serverEntry() {
  // Paketli sürümde asar dışına açılmış olur
  const p = path.join(__dirname, "..", "dist", "server.js");
  return fwd(p.replace("app.asar", "app.asar.unpacked"));
}

function mcpEnv(agent, dataDir) {
  return { ELECTRON_RUN_AS_NODE: "1", AGENT_ID: agent, DUOREVIEW_DIR: fwd(dataDir), DUOREVIEW_LANG: getLang() };
}

// projectDir: ajanın çalışma klasörü. dataDir: köprü verisi (projenin DIŞINDA; proje deposu kirlenmez).
// opts: { model, effort } — boş bırakılırsa ajanın kendi varsayılanı (kullanıcının mevcut ayarı) geçerlidir.
function buildSpec(agent, dataDir, opts = {}) {
  const exec = fwd(process.execPath);
  const entry = serverEntry();
  const env = mcpEnv(agent, dataDir);

  if (agent === "claude") {
    fs.mkdirSync(dataDir, { recursive: true });
    const cfg = path.join(dataDir, "claude-mcp.json");
    fs.writeFileSync(
      cfg,
      JSON.stringify({ mcpServers: { duoreview: { command: exec, args: [entry], env } } }, null, 2),
    );
    const args = ["--mcp-config", cfg, "--allowedTools", "mcp__duoreview"];
    if (opts.model) args.push("--model", opts.model);
    if (opts.effort) args.push("--effort", opts.effort);

    // Kalan kullanım için: yalnız bu oturuma özel durum çubuğu komutu (global ayara dokunmaz).
    try {
      const node = findNode();
      const writer = fwd(path.join(__dirname, "usage-writer.cjs").replace("app.asar", "app.asar.unpacked"));
      const statusFile = fwd(path.join(dataDir, "claude-status.json"));
      const settings = path.join(dataDir, "claude-settings.json");
      fs.writeFileSync(settings, JSON.stringify({
        statusLine: { type: "command", command: `"${fwd(node)}" "${writer}" "${statusFile}"` },
      }, null, 2));
      args.push("--settings", settings);
    } catch { /* node bulunamazsa kullanım göstergesi olmadan devam */ }

    return { file: resolveClaude(), args };
  }

  if (agent === "gemini") {
    const args = [];
    if (opts.model) args.push("--model", opts.model);
    if (opts.effort) args.push("--effort", opts.effort);
    return { file: resolveGemini(), args };
  }

  const toml = (v) => JSON.stringify(v); // JSON dizesi/dizisi geçerli TOML'dur
  const extra = [];
  if (opts.model) extra.push("-m", opts.model);
  if (opts.effort) extra.push("-c", `model_reasoning_effort=${toml(opts.effort)}`);
  const envToml = "{" + Object.entries(env).map(([k, v]) => `${k}=${toml(v)}`).join(",") + "}";
  const codex = resolveCodex();
  return {
    file: codex.file,
    args: [
      ...codex.args,
      "-c", `mcp_servers.duoreview.command=${toml(exec)}`,
      "-c", `mcp_servers.duoreview.args=${toml([entry])}`,
      "-c", `mcp_servers.duoreview.env=${envToml}`,
      "-c", `mcp_servers.duoreview.default_tools_approval_mode="approve"`,
      ...extra,
    ],
  };
}

// ---- Gemini: global MCP kaydı ve araç izni ---------------------------------
const AGY_ALLOW = "mcp(duoreview/*)";
const agyFile = (home, ...p) => path.join(home, ".gemini", ...p);
let registered = false; // kapanışta yalnız bu oturumun eklediği kayıt geri alınır
let previous = null; // kullanıcının önceden tanımladığı duoreview kaydı: kapanışta geri yazılır
let allowAdded = false; // izin kullanıcıda zaten varsa kapanışta silinmez

/** JSON dosyasını okuyup fn ile değiştirir. Dosya okunamıyorsa (ör. elle bozulmuş) dokunmaz; fn false dönerse yazmaz. */
function editJson(file, fn) {
  let s = {};
  if (fs.existsSync(file)) { try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch { return; } }
  if (fn(s) === false) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

function registerGemini(dataDir, home = os.homedir()) {
  editJson(agyFile(home, "config", "mcp_config.json"), (c) => { previous = c.mcpServers?.duoreview ?? null; return false; });
  const env = mcpEnv("gemini", dataDir);
  execFileSync(resolveGemini(), ["mcp", "add", ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]),
    "duoreview", fwd(process.execPath), serverEntry()], { stdio: "ignore", timeout: 20_000, windowsHide: true });
  registered = true;
  editJson(agyFile(home, "antigravity-cli", "settings.json"), (s) => {
    const allow = ((s.permissions ??= {}).allow ??= []);
    if (allow.includes(AGY_ALLOW)) return false;
    allow.push(AGY_ALLOW);
    allowAdded = true;
  });
}

function unregisterGemini(home = os.homedir()) {
  if (registered) {
    registered = false;
    if (previous) editJson(agyFile(home, "config", "mcp_config.json"), (c) => { (c.mcpServers ??= {}).duoreview = previous; });
    else try { execFileSync(resolveGemini(), ["mcp", "remove", "duoreview"], { stdio: "ignore", timeout: 20_000, windowsHide: true }); } catch {}
    previous = null;
  }
  if (!allowAdded) return;
  allowAdded = false;
  editJson(agyFile(home, "antigravity-cli", "settings.json"), (s) => {
    const allow = s.permissions?.allow;
    if (!Array.isArray(allow) || !allow.includes(AGY_ALLOW)) return false;
    s.permissions.allow = allow.filter((x) => x !== AGY_ALLOW);
    if (!s.permissions.allow.length) delete s.permissions.allow;
    if (!Object.keys(s.permissions).length) delete s.permissions;
  });
}

module.exports = { buildSpec, resolveClaude, resolveCodex, resolveGemini, registerGemini, unregisterGemini };
