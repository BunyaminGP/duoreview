// Projeye özel skill'ler. Claude Code <proje>/.claude/skills, Codex ve Antigravity CLI (agy) <proje>/.agents/skills okur;
// eklenen skill iki yere de kopyalanır, eklenti kurmak gerekmez. Electron'a bağımlı değildir; testlerde doğrudan kullanılır.
const fs = require("node:fs");
const path = require("node:path");

const ROOTS = { claude: [".claude", "skills"], agents: [".agents", "skills"] };
const NAME_RE = /^[a-z0-9][\w.-]{0,63}$/i;

const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
const same = (a, b) => norm(a) === norm(b);
const rootOf =(projectDir, key) => path.join(projectDir, ...ROOTS[key]);
const hasSkill = (dir) => { try { return fs.statSync(path.join(dir, "SKILL.md")).isFile(); } catch { return false; } };
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

// SKILL.md başındaki YAML'dan name ve description; ">" ve "|" ile süren çok satırlı değer de okunur.
function readMeta(dir) {
  let text = "";
  try { text = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"); } catch { return {}; }
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return {};
  const lines = fm[1].split(/\r?\n/);
  const meta = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let v = m[2].trim();
    if (/^[>|][-+]?$/.test(v)) {
      const more = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
      v = more.join(" ");
    }
    meta[m[1]] = v.replace(/^(["'])(.*)\1$/, "$2");
  }
  return meta;
}

function list(projectDir) {
  const found = new Map();
  for (const key of Object.keys(ROOTS)) {
    const root = rootOf(projectDir, key);
    for (const name of subdirs(root)) {
      if (!hasSkill(path.join(root, name))) continue;
      const s = found.get(name) ?? { name, description: readMeta(path.join(root, name)).description ?? "", claude: false, agents: false };
      s[key] = true;
      found.set(name, s);
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Seçilen klasör ya bir skill'dir (içinde SKILL.md) ya da skill klasörlerini barındırır.
function sources(src) {
  if (hasSkill(src)) return [src];
  return subdirs(src).map((n) => path.join(src, n)).filter(hasSkill);
}

function add(projectDir, src) {
  const added = [], errors = [];
  const found = sources(src);
  if (!found.length) return { added, errors: [{ name: path.basename(src), error: "noSkill" }] };
  for (const dir of found) {
    const name = readMeta(dir).name || path.basename(dir);
    if (!NAME_RE.test(name)) { errors.push({ name, error: "badName" }); continue; }
    for (const key of Object.keys(ROOTS)) {
      const dst = path.join(rootOf(projectDir, key), name);
      if (same(dst, dir)) continue; // zaten yerinde
      fs.rmSync(dst, { recursive: true, force: true });
      fs.cpSync(dir, dst, { recursive: true });
    }
    added.push(name);
  }
  return { added, errors };
}

function remove(projectDir, name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) return false;
  for (const key of Object.keys(ROOTS)) fs.rmSync(path.join(rootOf(projectDir, key), name), { recursive: true, force: true });
  return true;
}

module.exports = { list, add, remove, readMeta };
