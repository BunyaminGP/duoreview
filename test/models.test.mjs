// Model listesi (Codex önbelleği, yedek liste, agy models çıktısı) ve tartışmaların Markdown dökümü.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const req = createRequire(import.meta.url);
const { codexModels, CLAUDE_MODELS, parseAgyModels } = req("../app/models.js");
const { talkMarkdown } = req("../app/talkmd.js");
const V = req("../app/validate.js");

const home = mkdtempSync(join(tmpdir(), "models-"));
mkdirSync(join(home, ".codex"));

// Önbellek yokken: config.toml'daki model ve eski oturumlarda görülenler
assert.deepEqual(codexModels(home, ["gpt-a"]), { models: [{ id: "gpt-a", label: "gpt-a", efforts: [] }], current: "" });
writeFileSync(join(home, ".codex", "config.toml"), 'model = "gpt-b"\nmodel_reasoning_effort = "medium"\n');
assert.deepEqual(codexModels(home, ["gpt-a"]).models.map((m) => m.id), ["gpt-b", "gpt-a"]);

// Önbellek varken: gizli modeller çıkmaz, sıra önceliğe göre, efor seçenekleri modele göre
const lv = (...e) => e.map((effort) => ({ effort }));
writeFileSync(join(home, ".codex", "models_cache.json"), JSON.stringify({ models: [
  { slug: "gpt-y", display_name: "GPT-Y", visibility: "list", priority: 2, supported_reasoning_levels: lv("low", "high") },
  { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide", priority: 0 },
  { slug: "gpt-x", display_name: "GPT-X", visibility: "list", priority: 1, supported_reasoning_levels: lv("low", "ultra") },
] }));
const c = codexModels(home);
assert.equal(c.current, "gpt-b");
assert.deepEqual(c.models, [
  { id: "gpt-x", label: "GPT-X", efforts: ["low", "ultra"] },
  { id: "gpt-y", label: "GPT-Y", efforts: ["low", "high"] },
]);
writeFileSync(join(home, ".codex", "models_cache.json"), "{bozuk");
assert.deepEqual(codexModels(home).models.map((m) => m.id), ["gpt-b"], "bozuk önbellek yedek listeye düşer");
rmSync(home, { recursive: true, force: true });

// Listedeki her model adı ve efor, ana süreçteki doğrulamadan geçer
for (const m of CLAUDE_MODELS) {
  const cfg = V.sanitizeCfg({ models: { claude: m.id }, efforts: { claude: m.efforts.at(-1) } });
  assert.equal(cfg.models.claude, m.id); assert.equal(cfg.efforts.claude, m.efforts.at(-1));
}
assert.equal(V.sanitizeCfg({ efforts: { codex: "ultra" } }).efforts.codex, "ultra");

const md = talkMarkdown({
  notes: [{ author: "claude", kind: "kickoff", title: "", text: " bulgu A\n", created_at: "2026-10-11 10:00:00" }],
  threads: [{ id: 1, topic: "Plan", status: "CLOSED", outcome: "split", posts: [
    { author: "codex", stance: "object", text: "katılmıyorum", created_at: "2026-10-11 10:05:00" }] }],
}, { title: "Başlık", labels: { kickoff: "açılış incelemesi", split: "ayrışma", object: "itiraz" } });
assert.equal(md, [
  "# Başlık", "",
  "## claude: açılış incelemesi", "_2026-10-11 10:00:00_", "", "bulgu A", "",
  "## #1 Plan", "_ayrışma_", "",
  "**codex** (itiraz, 2026-10-11 10:05:00)", "", "katılmıyorum", "",
].join("\n"));

// agy models: başlık satırı ve geçersiz ad atlanır, Windows satır sonu temizlenir
assert.deepEqual(parseAgyModels("Fetching available models...\r\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\r\nbad id\tx\r\n").map((m) => [m.id, m.label]),
  [["gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"]]);

console.log("MODELS OK");
