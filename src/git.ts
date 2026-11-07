// Görev başına diff: tüm ajanlar aynı klasörde çalıştığı için `git diff` herkesin değişikliğini karıştırır.
// Üstlenirken ve gönderirken çalışma ağacının anlık görüntüsü (git ağacı) alınır; ikisinin farkı o görevin işidir.
// Gerçek index'e ve çalışma ağacına dokunulmaz: index geçici bir kopyada güncellenir.
import { execFileSync } from "node:child_process";
import { copyFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const git = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, {
    cwd, encoding: "utf8", env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024, windowsHide: true,
  }).trim();

// Gerçek yol: git kök klasörü kanonik döndürür; kısa ad (RUNNER~1) ya da sembolik bağ kalırsa göreli yollar bozulur.
export const projectDir = () => {
  const dir = process.env.DUOREVIEW_PROJECT || process.cwd();
  try { return realpathSync.native(dir); } catch { return dir; }
};

/** Çalışma ağacının (.gitignore dışı, izlenmeyen dosyalar dahil) ağaç kimliği; git deposu değilse null. */
export function snapshot(cwd = projectDir()): string | null {
  let top: string;
  try { top = git(cwd, ["rev-parse", "--show-toplevel"]); } catch { return null; }
  const index = join(tmpdir(), `duoreview-${process.pid}-${Date.now()}.idx`);
  try {
    // Gerçek index'in kopyası dosya durum önbelleğini taşır: büyük depoda her dosya yeniden okunmaz.
    try { copyFileSync(resolve(top, git(top, ["rev-parse", "--git-path", "index"])), index); } catch {}
    git(top, ["add", "-A"], { GIT_INDEX_FILE: index });
    return git(top, ["write-tree"], { GIT_INDEX_FILE: index });
  } catch { return null; }
  finally { rmSync(index, { force: true }); }
}

/** İki anlık görüntü arasında değişen dosyalar (mutlak yol). */
export function changedFiles(base: string, head: string, cwd = projectDir()): string[] {
  try {
    const top = git(cwd, ["rev-parse", "--show-toplevel"]);
    return git(top, ["diff", "--name-only", base, head]).split("\n").filter(Boolean).map((f) => resolve(top, f));
  } catch { return []; }
}

/** paths: mutlak yollar. */
export function diffOf(base: string, head: string, paths: string[], cwd = projectDir()): string {
  if (!paths.length) return "";
  try {
    const top = git(cwd, ["rev-parse", "--show-toplevel"]);
    return git(top, ["diff", "--no-color", base, head, "--", ...paths.map((p) => relative(top, p).replace(/\\/g, "/"))]);
  } catch { return ""; }
}
