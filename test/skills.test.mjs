// Projeye özel skill'ler: ekleme iki köke kopyalar, liste birleştirir, kaldırma ikisinden de siler.
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const S = createRequire(import.meta.url)("../app/skills.js");

const tmp = mkdtempSync(join(tmpdir(), "skills-"));
const project = join(tmp, "site"), lib = join(tmp, "lib");
const skill = (dir, fm, extra = {}) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${fm}\n---\n\nGövde\n`);
  for (const [f, body] of Object.entries(extra)) { mkdirSync(join(dir, f, ".."), { recursive: true }); writeFileSync(join(dir, f), body); }
};
try {
  mkdirSync(project);
  assert.deepEqual(S.list(project), []);

  // Tek skill klasörü: frontmatter adı klasör adından önce gelir, alt dosyalar da kopyalanır
  skill(join(lib, "seo-klasor"), "name: seo\ndescription: \"Meta etiketlerini denetle\"", { "scripts/check.js": "1" });
  let r = S.add(project, join(lib, "seo-klasor"));
  assert.deepEqual(r, { added: ["seo"], errors: [] });
  for (const root of [".claude", ".agents"]) assert.equal(readFileSync(join(project, root, "skills", "seo", "scripts", "check.js"), "utf8"), "1");
  assert.deepEqual(S.list(project), [{ name: "seo", description: "Meta etiketlerini denetle", claude: true, agents: true }]);

  // Skill'leri barındıran klasör: hepsi eklenir; adı geçersiz olan atlanır; çok satırlı açıklama okunur
  skill(join(lib, "paket", "a11y"), "name: a11y\ndescription: >\n  Erişilebilirlik\n  denetimi");
  skill(join(lib, "paket", "kotu"), "name: ../kacis");
  mkdirSync(join(lib, "paket", "bos"));
  r = S.add(project, join(lib, "paket"));
  assert.deepEqual(r.added, ["a11y"]);
  assert.deepEqual(r.errors, [{ name: "../kacis", error: "badName" }]);
  assert.equal(existsSync(join(project, ".claude", "kacis")), false);
  assert.equal(S.list(project).find((s) => s.name === "a11y").description, "Erişilebilirlik denetimi");

  assert.deepEqual(S.add(project, join(lib, "paket", "bos")).errors, [{ name: "bos", error: "noSkill" }]);

  // Yeniden ekleme eskisini değiştirir (silinmiş dosya kalmaz)
  rmSync(join(lib, "seo-klasor", "scripts"), { recursive: true });
  S.add(project, join(lib, "seo-klasor"));
  assert.equal(existsSync(join(project, ".agents", "skills", "seo", "scripts")), false);

  // Yalnız .claude/skills içinde duran skill eklenince kendi üstüne kopyalanmaz, .agents'a da gider
  skill(join(project, ".claude", "skills", "yerel"), "description: elle konmuş");
  assert.deepEqual(S.list(project).find((s) => s.name === "yerel"), { name: "yerel", description: "elle konmuş", claude: true, agents: false });
  assert.deepEqual(S.add(project, join(project, ".claude", "skills", "yerel")).added, ["yerel"]);
  assert.equal(S.list(project).find((s) => s.name === "yerel").agents, true);
  assert.ok(existsSync(join(project, ".claude", "skills", "yerel", "SKILL.md")));

  // Kaldırma iki kökten siler; klasör dışına çıkan ad reddedilir
  assert.equal(S.remove(project, "seo"), true);
  assert.equal(S.list(project).some((s) => s.name === "seo"), false);
  for (const bad of ["..", "../site", "a/b", "", null, 5]) assert.equal(S.remove(project, bad), false, String(bad));
  assert.ok(existsSync(project));

  assert.deepEqual(S.readMeta(join(lib, "yok")), {});
  console.log("SKILLS OK");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
