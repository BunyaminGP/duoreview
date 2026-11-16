const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const readline = require("node:readline");

const uuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const canonical = (p) => {
  try { p = fs.realpathSync(p); } catch { p = path.resolve(p); }
  return process.platform === "win32" ? p.toLowerCase() : p;
};

// Yalnız next_action çağrısına ait araç cevabındaki etiket sahiplik kanıtıdır.
function taggedReply(output, tag) {
  try {
    const reply = typeof output === "string" ? JSON.parse(output) : output;
    return Array.isArray(reply?.content) && reply.content.some((part) => {
      if (part.type !== "text") return false;
      try { return JSON.parse(part.text).session_tag === tag; } catch { return false; }
    });
  } catch { return false; }
}

async function findCodexSession({ tag, startedAt }, projectDir, root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")) {
  if (!uuid(tag) || !Number.isFinite(startedAt)) return null;
  const candidates = [];
  async function walk(dir, depth) {
    for (const e of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) await walk(file, depth + 1);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) {
        const stat = await fs.promises.stat(file);
        if (stat.mtimeMs >= startedAt) candidates.push({ file, size: stat.size });
      }
      if (candidates.length > 128) throw new Error("Too many session candidates");
    }
  }
  try {
    await walk(root, 0);
    const matches = new Set();
    for (const { file, size } of candidates) {
      // Eksik tarama sahiplik kanıtı sayılmaz; büyük oturumda güvenli biçimde yeni oturum açılır.
      if (size > 32 * 1024 * 1024) return null;
      const input = fs.createReadStream(file, { encoding: "utf8", end: Math.max(0, size - 1) });
      const lines = readline.createInterface({ input, crlfDelay: Infinity });
      let id = null, matched = false;
      const calls = new Set();
      try {
        for await (const line of lines) {
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          const p = row.payload;
          if (row.type === "session_meta" && uuid(p?.id) && typeof p.cwd === "string" && canonical(p.cwd) === canonical(projectDir)) id = p.id;
          if (row.type === "event_msg" && p?.type === "item_completed" && p.thread_id === id) {
            const item = p.item;
            if (item?.type === "McpToolCall" && item.server === "duoreview" && item.tool === "next_action" && item.status === "completed" && taggedReply(item.result, tag)) matched = true;
          }
          if (row.type !== "response_item") continue;
          if (p?.type === "function_call" && p.name === "mcp__duoreview__next_action") calls.add(p.call_id);
          if (p?.type === "function_call_output" && calls.has(p.call_id) && taggedReply(p.output, tag)) matched = true;
        }
      } finally { lines.close(); input.destroy(); }
      if (id && matched) matches.add(id);
    }
    return matches.size === 1 ? [...matches][0] : null;
  } catch { return null; }
}

function createSessionStore(dir) {
  const file = path.join(dir, "sessions.json");
  let records = {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const agent of ["claude", "codex"]) {
      const r = saved?.[agent];
      if (uuid(r?.id)) records[agent] = { id: r.id };
      else if (agent === "codex" && uuid(r?.tag) && Number.isFinite(r.startedAt)) records[agent] = { tag: r.tag, startedAt: r.startedAt };
    }
  } catch {}
  const save = (next) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + ".tmp", JSON.stringify(next));
    fs.renameSync(file + ".tmp", file);
    records = next;
  };
  return {
    resumable: () => ({ claude: !!records.claude?.id, codex: !!records.codex?.id, gemini: false }),
    prepare(agent, fresh = false) {
      const id = fresh ? null : records[agent]?.id;
      return { resume: !!id, sessionId: id || (agent === "claude" ? crypto.randomUUID() : undefined),
        sessionTag: agent === "codex" ? crypto.randomUUID() : undefined, startedAt: Date.now() };
    },
    started(agent, opts) {
      if (agent === "gemini") return;
      save({ ...records, [agent]: opts.sessionId ? { id: opts.sessionId } : { tag: opts.sessionTag, startedAt: opts.startedAt } });
    },
    forget(agent) { const next = { ...records }; delete next[agent]; save(next); },
    async discover(projectDir, root) {
      const pending = records.codex;
      if (!pending?.tag) return false;
      const id = await findCodexSession(pending, projectDir, root);
      if (!id || records.codex !== pending) return false;
      save({ ...records, codex: { id } });
      return true;
    },
  };
}

module.exports = { createSessionStore, findCodexSession };
