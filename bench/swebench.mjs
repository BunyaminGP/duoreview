// SWE-bench koşucusu: aynı örnekleri tek ajanla ve takımla çözdürür, yamaları SWE-bench biçiminde yazar,
// resmi değerlendirmeyi Docker'da çalıştırır ve karşılaştırma tablosu üretir.
//   node bench/swebench.mjs fetch  --dataset verified --limit 20   (ya da --per-repo 1 --seed 1: her depodan bir örnek)
//   node bench/swebench.mjs run    --mode gold  (resmi düzeltmeler; eval --name gold ile bu makinede geçenler bulunur)
//   node bench/swebench.mjs run    --mode team|claude|codex|gemini --yes [--valid] [--limit 5] [--ids a,b]
//   node bench/swebench.mjs eval   --name <koşu adı> [--workers 2]
//   node bench/swebench.mjs report
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { runSolo, runTeam, killAll } from "./headless.mjs";

const WORK = resolve(import.meta.dirname, "work");
const DATASETS = { verified: "princeton-nlp/SWE-bench_Verified", lite: "princeton-nlp/SWE-bench_Lite" };
const AGENT_IDS = ["claude", "codex", "gemini"];

const { positionals, values: o } = parseArgs({
  allowPositionals: true,
  options: {
    dataset: { type: "string", default: "verified" },
    limit: { type: "string" }, offset: { type: "string", default: "0" }, ids: { type: "string" },
    "per-repo": { type: "string" }, seed: { type: "string", default: "1" },
    mode: { type: "string" }, name: { type: "string" },
    team: { type: "string", default: "claude,codex" }, captain: { type: "string" },
    kickoff: { type: "string", default: "solo" }, review: { type: "string", default: "immediate" },
    verify: { type: "string", default: "" },
    timeout: { type: "string", default: "60" }, workers: { type: "string", default: "2" },
    "model-claude": { type: "string" }, "model-codex": { type: "string" }, "model-gemini": { type: "string" },
    "effort-claude": { type: "string" }, "effort-codex": { type: "string" }, "effort-gemini": { type: "string" },
    yes: { type: "boolean", default: false }, valid: { type: "boolean", default: false },
    "codex-sandbox": { type: "string", default: "workspace-write" },
  },
});
const dataFile = join(WORK, "data", `${o.dataset}.jsonl`);
const readJsonl = (f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 });
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function fetchData() {
  const name = DATASETS[o.dataset];
  if (!name) throw new Error(`--dataset: ${Object.keys(DATASETS).join(" | ")}`);
  const want = o.ids?.split(",");
  const perRepo = o["per-repo"] ? Number(o["per-repo"]) : 0;
  const limit = want || perRepo ? Infinity : Number(o.limit ?? 20);
  const rows = [];
  for (let offset = want ? 0 : Number(o.offset); rows.length < limit; offset += 100) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(name)}&config=default&split=test&offset=${offset}&length=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const page = (await res.json()).rows.map((r) => r.row);
    if (!page.length) break;
    rows.push(...page.filter((r) => !want || want.includes(r.instance_id)));
  }
  // --per-repo N: her depodan N örnek; seçim seed'e bağlı karma ile, herkes aynı listeyi yeniden üretir
  const pick = (rs) => {
    if (!perRepo) return rs.slice(0, limit);
    const key = (r) => createHash("sha1").update(`${o.seed}:${r.instance_id}`).digest("hex");
    const byRepo = Map.groupBy(rs, (r) => r.repo);
    return [...byRepo.values()].flatMap((g) => g.sort((a, b) => key(a).localeCompare(key(b))).slice(0, perRepo));
  };
  const chosen = pick(rows);
  mkdirSync(join(WORK, "data"), { recursive: true });
  writeFileSync(dataFile, chosen.map((r) => JSON.stringify(r)).join("\n") + "\n");
  log(`${chosen.length} instances → ${dataFile}`);
}

/**
 * Depoyu örneğin taban commit'inde, geçmişi olmadan hazırlar: ajan `git log` ile düzeltme commit'ini göremesin.
 * Tam klon bir kez önbelleğe alınır; çalışma kopyası oradan yalnız taban commit'i çeker.
 */
function prepareRepo(inst, dir) {
  const cache = join(WORK, "cache", inst.repo.replace("/", "__") + ".git");
  if (!existsSync(cache)) {
    log(`clone ${inst.repo}`);
    mkdirSync(join(WORK, "cache"), { recursive: true });
    // Geçici adla klonlanıp sonra taşınır: aynı anda çalışan başka bir koşu yarım klonu hazır sanmasın.
    const tmp = `${cache}.tmp-${process.pid}`;
    git(WORK, "clone", "-q", "--bare", `https://github.com/${inst.repo}.git`, tmp);
    git(tmp, "config", "uploadpack.allowAnySHA1InWant", "true");
    try { renameSync(tmp, cache); } catch { rmSync(tmp, { recursive: true, force: true }); } // öteki koşu önce bitirdiyse onunki kalır
  }
  try { git(cache, "cat-file", "-e", `${inst.base_commit}^{commit}`); }
  catch { git(cache, "fetch", "-q", `https://github.com/${inst.repo}.git`, "+refs/heads/*:refs/heads/*"); }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q");
  // Ajan Windows'ta CRLF yazsa da yama LF olur (index'e alırken çevrilir); uzun yollar açık.
  for (const [k, v] of [["core.autocrlf", "input"], ["core.longpaths", "true"], ["user.email", "bench@duoreview"], ["user.name", "bench"]]) git(dir, "config", k, v);
  git(dir, "fetch", "-q", "--depth", "1", "file:///" + cache.replace(/\\/g, "/").replace(/^\//, ""), inst.base_commit);
  git(dir, "checkout", "-q", "FETCH_HEAD");
}

const brief = (inst) => [
  "Resolve the GitHub issue below in the repository in the current directory (checked out at the commit where the issue was reported).",
  "Make the smallest source change that fixes it. You may write and run tests or scripts to check the fix, but the result is judged by hidden tests:",
  "do not delete or weaken existing tests, and remove temporary scripts you created. Do not commit.",
  "", "<issue>", inst.problem_statement, "</issue>",
].join("\n");

/** Ajanların bıraktığı değişiklik, SWE-bench'in beklediği biçimde (taban commit'e göre git diff). */
function patchOf(dir) {
  git(dir, "add", "-A");
  return git(dir, "diff", "--cached", "--no-color", "--no-ext-diff", "HEAD", "--", ".", ":(exclude)**/__pycache__/**", ":(exclude)*.pyc", ":(exclude).cc-quota");
}

async function runBench() {
  const mode = o.mode;
  if (!mode || ![...AGENT_IDS, "team", "gold"].includes(mode)) throw new Error("--mode team | claude | codex | gemini | gold");
  if (!o.yes && mode !== "gold") {
    throw new Error("Claude and agy run without permission prompts (--dangerously-skip-permissions); Codex runs in its own sandbox (--codex-sandbox, default workspace-write) " +
      "inside throwaway clones under bench/work, with your user rights. Run it on a machine or VM you accept that on, then add --yes.");
  }
  const team = o.team.split(",").filter((a) => AGENT_IDS.includes(a));
  if (mode === "team" && team.length < 2) throw new Error("--team: at least two of claude,codex,gemini");
  const name = o.name ?? (mode === "team" ? `team-${team.join("+")}` : mode);
  const runDir = join(WORK, "runs", name);
  mkdirSync(join(runDir, "stats"), { recursive: true });
  writeFileSync(join(runDir, "run.json"), JSON.stringify({ mode, team: mode === "team" ? team : [mode], dataset: o.dataset, args: o }, null, 2));
  const predFile = join(runDir, "predictions.jsonl");
  const doneIds = new Set(readJsonl(predFile).map((p) => p.instance_id));
  let instances = readJsonl(dataFile);
  if (!instances.length) throw new Error(`no data: run "node bench/swebench.mjs fetch --dataset ${o.dataset}" first`);
  if (o.ids) instances = instances.filter((i) => o.ids.split(",").includes(i.instance_id));
  if (o.valid) {
    // Yalnız resmi düzeltmesi bu makinede geçen örnekler: geçmeyende ajanın yapabileceği bir şey yoktur.
    const gold = evalReport("gold");
    if (!gold) throw new Error('--valid: run "run --mode gold" and "eval --name gold" first');
    instances = instances.filter((i) => gold.resolved_ids.includes(i.instance_id));
  }
  if (o.limit) instances = instances.slice(0, Number(o.limit));
  const models = Object.fromEntries(AGENT_IDS.map((a) => [a, o[`model-${a}`] ?? ""]));
  const efforts = Object.fromEntries(AGENT_IDS.map((a) => [a, o[`effort-${a}`] ?? ""]));
  const timeoutMs = Number(o.timeout) * 60_000;
  process.on("SIGINT", () => { killAll(); process.exit(130); });

  for (const inst of instances) {
    if (doneIds.has(inst.instance_id)) { log(`skip ${inst.instance_id} (done)`); continue; }
    const dir = join(runDir, "repos", inst.instance_id);
    const stats = { instance_id: inst.instance_id, mode, name };
    if (mode === "gold") {
      appendFileSync(predFile, JSON.stringify({ instance_id: inst.instance_id, model_name_or_path: name, model_patch: inst.patch }) + "\n");
      continue;
    }
    try { prepareRepo(inst, dir); }
    catch (e) {
      log(`${inst.instance_id}: setup failed: ${String(e.stderr || e.message).trim().slice(0, 300)}`);
      writeFileSync(join(runDir, "stats", `${inst.instance_id}.json`), JSON.stringify({ ...stats, reason: "setup_failed", error: String(e.stderr || e.message).slice(0, 2000) }, null, 2));
      continue;
    }
    log(`${inst.instance_id}: ${mode} start`);
    const started = Date.now();
    const boardDir = join(runDir, "boards", inst.instance_id);
    rmSync(boardDir, { recursive: true, force: true }); // yarıda kalmış eski koşunun panosu
    const opts = { projectDir: dir, dataDir: boardDir, models, efforts, timeoutMs, codexSandbox: o["codex-sandbox"], log: (s) => log(`  ${s}`) };
    const result = mode === "team"
      ? await runTeam({ ...opts, team, captain: o.captain ?? team[0],
        kickoff: o.kickoff, reviewMode: o.review, brief: brief(inst), verify: o.verify })
      : await runSolo({ ...opts, agent: mode, prompt: brief(inst), model: models[mode], effort: efforts[mode] });
    // Kota eklentisi Claude'u durdurduysa sonuç ajanın başarısı değildir: kaydetmeden çık, sonraki koşu buradan sürer
    const quota = join(dir, ".cc-quota");
    if (existsSync(quota)) {
      const stop = join(quota, "STOP.json");
      const resets = existsSync(stop) ? ` (resets ${JSON.parse(readFileSync(stop, "utf8")).resets_at})` : "";
      log(`${inst.instance_id}: Claude quota reached${resets}; not recorded, rerun the same command after the reset`);
      return;
    }
    const patch = patchOf(dir);
    appendFileSync(predFile, JSON.stringify({ instance_id: inst.instance_id, model_name_or_path: name, model_patch: patch }) + "\n");
    writeFileSync(join(runDir, "stats", `${inst.instance_id}.json`), JSON.stringify({
      ...stats, ...result, ms: Date.now() - started, patchLines: patch ? patch.split("\n").length : 0,
    }, null, 2));
    log(`${inst.instance_id}: ${result.reason}, ${Math.round((Date.now() - started) / 60000)} min, patch ${patch.length} chars`);
  }
  log(`predictions → ${predFile}\n  next: node bench/swebench.mjs eval --name ${name} --dataset ${o.dataset}`);
}

/** Bir koşunun resmi değerlendirme raporu (yoksa null). */
function evalReport(name) {
  const dir = join(WORK, "runs", name);
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).find((x) => x.endsWith(".json") && x !== "run.json" && "resolved_ids" in JSON.parse(readFileSync(join(dir, x), "utf8")));
  if (f) return JSON.parse(readFileSync(join(dir, f), "utf8"));
  // Özet yazılamadıysa (harness sonda ağa çıkıp düşebiliyor) örnek başına report.json'lardan topla
  const logs = join(dir, "logs", "run_evaluation", name.replace(/[^\w.-]/g, "_"));
  if (!existsSync(logs)) return null;
  const reports = readdirSync(logs).flatMap((m) => readdirSync(join(logs, m)).map((i) => join(logs, m, i, "report.json")))
    .filter(existsSync).map((p) => Object.entries(JSON.parse(readFileSync(p, "utf8")))[0]);
  return reports.length ? { completed_ids: reports.map(([id]) => id), resolved_ids: reports.filter(([, r]) => r.resolved).map(([id]) => id) } : null;
}

/** Resmi SWE-bench değerlendirmesi, Python kurulumu gerektirmeden bir konteynerde (Docker soketi içeri bağlanır; /run'a bağlanmaz: Debian'da /var/run oraya işaret eder). */
function evaluate() {
  if (!o.name) throw new Error("--name <run name> (a folder under bench/work/runs)");
  const runDir = join(WORK, "runs", o.name);
  if (!existsSync(join(runDir, "predictions.jsonl"))) throw new Error(`${runDir}/predictions.jsonl not found`);
  // swebench bir kez imaja kurulur, veri seti kalıcı bir birimde önbelleğe alınır: her değerlendirme ağa çıkıp düşmesin
  const image = "duoreview-swebench:4.1.0";
  if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) {
    log(`build ${image}`);
    const b = spawnSync("docker", ["build", "-t", image, "-"], { input: "FROM python:3.11\nRUN pip install --retries 10 --timeout 60 swebench==4.1.0\n", stdio: ["pipe", "inherit", "inherit"] });
    if (b.status !== 0) throw new Error(`docker build exited with ${b.status ?? b.error}`);
  }
  const cmd = `python -m swebench.harness.run_evaluation --dataset_name ${DATASETS[o.dataset]} ` +
    `--predictions_path predictions.jsonl --max_workers ${Number(o.workers)} --run_id ${o.name.replace(/[^\w.-]/g, "_")}`;
  const args = ["run", "--rm", "-v", "/var/run/docker.sock:/var/run/docker.sock", "-v", `${runDir}:/work`, "-v", "duoreview-hf:/root/.cache/huggingface",
    "-w", "/work", image, "sh", "-c", cmd];
  log(`docker ${args.join(" ")}`);
  const r = spawnSync("docker", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`evaluation exited with ${r.status ?? r.error}`);
}

/** Koşuların karşılaştırması: çözülen oran, süre, tur, token, inceleme ölçüleri. */
function report() {
  const runsDir = join(WORK, "runs");
  const names = o.name ? o.name.split(",") : existsSync(runsDir) ? readdirSync(runsDir) : [];
  const rows = [], resolvedBy = {};
  for (const name of names) {
    const dir = join(runsDir, name);
    const stats = existsSync(join(dir, "stats")) ? readdirSync(join(dir, "stats")).map((f) => JSON.parse(readFileSync(join(dir, "stats", f), "utf8"))) : [];
    const ev = evalReport(name);
    resolvedBy[name] = new Set(ev?.resolved_ids ?? []);
    const ran = stats.filter((s) => s.reason !== "setup_failed");
    const sum = (f) => ran.reduce((n, s) => n + (f(s) || 0), 0);
    const usage = (k) => sum((s) => Object.values(s.agents ?? {}).reduce((n, a) => n + (a.usage?.[k] ?? 0), 0));
    const board = (k) => sum((s) => s.board?.[k]);
    const isTeam = ran.some((s) => s.board);
    rows.push([
      name, ran.length, ev ? `${ev.resolved_ids.length} (${Math.round((100 * ev.resolved_ids.length) / Math.max(ran.length || ev.completed_ids?.length || 0, 1))}%)` : "not evaluated",
      ran.length ? (sum((s) => s.ms) / ran.length / 60000).toFixed(1) : "-",
      sum((s) => Object.values(s.agents ?? {}).reduce((n, a) => n + a.turns, 0)),
      Math.round((usage("input_tokens") + usage("output_tokens")) / 1000) + "k",
      usage("total_cost_usd") ? "$" + usage("total_cost_usd").toFixed(2) : "-",
      isTeam ? board("changeRequests") : "-", isTeam ? board("disputes") : "-",
      isTeam ? `${board("alternatives")} (${board("adopted")}/${board("rejected")})` : "-",
      ran.filter((s) => s.reason !== "done").map((s) => s.reason).join(", ") || "-",
      sum((s) => !s.patchLines),
    ]);
  }
  const head = ["run", "instances", "resolved", "avg min", "turns", "tokens in+out", "claude cost", "change requests", "disputes", "alternatives (adopted/rejected)", "not done", "empty patches"];
  const table = [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
  const ids = [...new Set(Object.values(resolvedBy).flatMap((s) => [...s]))].sort();
  const per = ids.length ? "\n\nResolved by run:\n\n" + [["instance", ...names], ["---", ...names.map(() => "---")],
    ...ids.map((id) => [id, ...names.map((n) => (resolvedBy[n].has(id) ? "yes" : ""))])].map((r) => `| ${r.join(" | ")} |`).join("\n") : "";
  const md = `# SWE-bench (${o.dataset})\n\n${table}${per}\n\nTokens are what the CLIs report; Codex reports no cost and Gemini may report no tokens.\n`;
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, "report.md"), md);
  console.log(md);
}

const commands = { fetch: fetchData, run: runBench, eval: evaluate, report };
const command = commands[positionals[0]];
if (!command) {
  console.error("usage: node bench/swebench.mjs fetch | run | eval | report  (see the comment at the top of this file)");
  process.exit(2);
}
try { await command(); } catch (e) { console.error(String(e.message ?? e)); process.exitCode = 1; }
