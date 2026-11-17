import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';

test('database applies the initial schema migration', () => {
  const db = openDatabase(':memory:');
  try {
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert.deepEqual(migrations, [{ version: 1 }]);

    const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    assert.ok(userColumns.some(column => column.name === 'telegram_id'));

    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    assert.ok(sessionColumns.some(column => column.name === 'token_hash'));
  } finally {
    db.close();
  }
});
