import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DurDatabase = InstanceType<typeof Database>;

export function openDatabase(filename = process.env.DUR_DATABASE_PATH ?? './data/dur.sqlite'): DurDatabase {
  if (filename !== ':memory:' && !filename.startsWith('file:')) {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const initialMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!initialMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          telegram_id TEXT NOT NULL UNIQUE,
          telegram_username TEXT,
          first_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }

  return db;
}
