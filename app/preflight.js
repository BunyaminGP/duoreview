const { execFile } = require("node:child_process");
const { resolveClaude, resolveCodex, resolveGemini } = require("./agents");

async function preflight({ resolve = { claude: resolveClaude, codex: resolveCodex, gemini: resolveGemini }, exec = execFile } = {}) {
  return Object.fromEntries(await Promise.all(Object.entries(resolve).map(async ([agent, find]) => {
    let file;
    try {
      const spec = find();
      file = typeof spec === "string" ? spec : spec.file;
      const args = typeof spec === "string" ? [] : spec.args;
      return [agent, await new Promise((done) => {
        exec(file, [...args, "--version"], { windowsHide: true, timeout: 5000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
          const version = String(stdout || stderr || "").trim().slice(0, 300);
          done({ ok: !error && !!version, path: file, version: error ? "" : version,
            error: error ? error.message : version ? "" : "No version output" });
        });
      })];
    } catch (e) { return [agent, { ok: false, path: file || "", version: "", error: e.message }]; }
  })));
}

module.exports = { preflight };
