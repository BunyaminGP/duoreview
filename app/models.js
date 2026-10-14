// Model seçim listeleri. Codex: CLI'ın kendi önbelleği (~/.codex/models_cache.json), yoksa eski oturumlarda görülen adlar.
// Claude Code yerelde model listesi tutmaz; takma adlar her zaman güncel modele gider, tam adlar sürümü sabitler.
// Gemini (agy): `agy models` hesabın kullanabildiği modelleri ağdan getirir.
const fs = require("node:fs");
const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_MODELS = [
  { id: "fable", label: "Fable", alias: true },
  { id: "opus", label: "Opus", alias: true },
  { id: "sonnet", label: "Sonnet", alias: true },
  { id: "haiku", label: "Haiku", alias: true },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
].map((m) => ({ ...m, efforts: CLAUDE_EFFORTS }));

/** { models: [{ id, label, efforts }], current } — current: kullanıcının config.toml'daki varsayılanı. */
function codexModels(home = os.homedir(), seen = []) {
  const dir = path.join(home, ".codex");
  let current = "";
  try { current = fs.readFileSync(path.join(dir, "config.toml"), "utf8").match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? ""; } catch {}
  let models = [];
  try {
    models = JSON.parse(fs.readFileSync(path.join(dir, "models_cache.json"), "utf8")).models
      .filter((m) => m.visibility === "list" && typeof m.slug === "string")
      .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      .map((m) => ({ id: m.slug, label: m.display_name || m.slug, efforts: (m.supported_reasoning_levels ?? []).map((r) => r.effort).filter(Boolean) }));
  } catch { /* önbellek yok ya da biçimi değişmiş: aşağıdaki yedek listeye düş */ }
  if (!models.length) models = [...new Set([current, ...seen].filter(Boolean))].map((id) => ({ id, label: id, efforts: [] }));
  return { models, current };
}

const GEMINI_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** `agy models` çıktısı: her model bir satırda "id<TAB>ad"; başlık satırında sekme yoktur. */
const parseAgyModels = (text) => text.split(/\r?\n/).map((l) => l.split("\t"))
  .filter(([id, label]) => label && /^[\w.:/-]+$/.test(id))
  .map(([id, label]) => ({ id, label: label.trim(), efforts: GEMINI_EFFORTS }));

function geminiModels(agy) {
  return new Promise((resolve) => execFile(agy, ["models"], { timeout: 20_000, windowsHide: true },
    (err, out) => resolve(err ? [] : parseAgyModels(out))));
}

module.exports = { CLAUDE_MODELS, CLAUDE_EFFORTS, codexModels, parseAgyModels, geminiModels };
