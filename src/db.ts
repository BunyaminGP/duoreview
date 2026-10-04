import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Agent = "claude" | "codex";
export const AGENTS: Agent[] = ["claude", "codex"];
export const MAX_REVIEW_ROUNDS = 3;

export const other = (a: Agent): Agent => (a === "claude" ? "codex" : "claude");

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
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}
