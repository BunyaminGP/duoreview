import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Agent = "claude" | "codex" | "gemini";
export const AGENTS: Agent[] = ["claude", "codex", "gemini"];
export const MAX_REVIEW_ROUNDS = 3;
/** İki kişilik takımda bir tartışmada en çok kaç mesaj yazılır (takım büyüdükçe orantılı artar); dolunca uzlaşma yoksa "ayrışma" olarak kapanır. */
export const MAX_POSTS = { kickoff: 4, plan: 4, free: 6 } as const;
export const MAX_OPEN_THREADS = 2;
/** Çapraz incelemede bir iddia en çok kaç kez değerlendirilir: 1. tur herkes, sonraki turlar yalnız itiraz kalan iddialarda. Aradaki her tura bir savunma düşer. */
export const MAX_CROSS_ROUNDS = 2;

/** Sonradan eklenen sütunlar: eski panolar açılırken eklenir. */
const COLUMNS = [
  ["tasks", "depends_on", "TEXT NOT NULL DEFAULT '[]'"],
  ["tasks", "acceptance", "TEXT NOT NULL DEFAULT '[]'"], // kabul kriterleri; inceleyici her birini kanıtla işaretler
  ["tasks", "base", "TEXT"],                             // üstlenirken çalışma ağacının git ağacı (diff tabanı)
  ["tasks", "head", "TEXT"],                             // gönderirken çalışma ağacının git ağacı
  ["tasks", "diff", "TEXT"],
  ["tasks", "unclaimed", "TEXT"],                        // hiçbir görevin touches'ında olmayan değişen dosyalar
  ["tasks", "verify", "TEXT"],                           // son doğrulama komutu sonucu (JSON)
  ["tasks", "origin", "INTEGER"],                        // benimsenen alternatiften doğduysa o incelemenin id'si
  ["tasks", "reviewer", "TEXT"],                         // kullanıcının seçtiği inceleyici (boşsa takım sırası)
  ["reviews", "checks", "TEXT"],
  ["reviews", "alternative", "TEXT"],                    // daha sade/hızlı yol önerisi
  ["reviews", "triage", "TEXT"],                         // adopted | rejected (kaptanın kararı)
  ["reviews", "triage_note", "TEXT"],
] as const;

/** dataDir: projeden bağımsız veri klasörü (uygulama klasörü). Proje deposuna dosya yazılmaz. */
export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "bridge.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      -- TODO | WORKING | REVIEW | REWORK | DONE | DISPUTE
      status TEXT NOT NULL DEFAULT 'TODO',
      assignee TEXT,                       -- kaptanın atadığı ajan (boşsa serbest)
      owner TEXT,                          -- işi fiilen üstlenen
      touches TEXT NOT NULL DEFAULT '[]',  -- dokunulacak dosya/klasörler (çakışma denetimi)
      depends_on TEXT NOT NULL DEFAULT '[]',
      summary TEXT,
      files TEXT,
      rounds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      reviewer TEXT NOT NULL,
      verdict TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',   -- note | prompt (prompt: ortağın terminaline yazılır)
      text TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'note',   -- kickoff (ikisi de yazana dek ortaktan gizli) | note
      title TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'free',   -- kickoff | plan | free
      topic TEXT NOT NULL,
      task_id INTEGER,
      blocking INTEGER NOT NULL DEFAULT 0, -- açıkken yeni işe başlanmaz
      status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | CLOSED
      outcome TEXT,                        -- agreed | split
      opened_by TEXT NOT NULL,
      max_posts INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      stance TEXT NOT NULL,                -- propose | object | agree
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Çapraz inceleme: açılış notundaki teknik iddialar, her ajanın her iddiaya verdiği hüküm, iddia sahibinin savunması, kaptanın kararları.
    CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,                  -- güncel metin (revise ile değişir)
      original TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL,
      reviewer TEXT NOT NULL,
      round INTEGER NOT NULL,
      verdict TEXT NOT NULL,               -- agree | disagree | unsure | alternative
      text TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      reply_to INTEGER,                    -- 2. turdan itibaren yanıtlanan savunma (rebuttals.id)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (claim_id, reviewer, round)
    );
    CREATE TABLE IF NOT EXISTS rebuttals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL,
      author TEXT NOT NULL,
      round INTEGER NOT NULL,
      action TEXT NOT NULL,                -- defend | revise | withdraw
      text TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      reply_to TEXT NOT NULL DEFAULT '[]', -- yanıtlanan itirazlar (assessments.id)
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (claim_id, round)
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,                  -- accepted | rejected | unresolved | missing_evidence | verification
      claim_id INTEGER,
      text TEXT NOT NULL,
      refs TEXT NOT NULL DEFAULT '[]',     -- dayanak kimlikleri: C1, A3, R2
      author TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    -- Sunucunun bir ajana gerçekten gönderdiği içerik (n:not, c:iddia, a:hüküm, r:savunma). İlk gönderim zamanı kalır.
    CREATE TABLE IF NOT EXISTS deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL,
      item TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (recipient, item)
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [table, column, def] of COLUMNS) {
      if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); db.close(); throw e; }
  return db;
}
