import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';

test('database applies the initial schema migration exactly once', () => {
  const db = openDatabase(':memory:');
  try {
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert.deepEqual(migrations, [{ version: 1 }]);

    const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    assert.ok(userColumns.some(column => column.name === 'telegram_id'));

    // Re-running the migration check must not duplicate its record.
    db.close();
    const reopened = openDatabase(':memory:');
    try {
      const count = reopened.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get() as { count: number };
      assert.equal(count.count, 1);
    } finally {
      reopened.close();
    }
  } finally {
    // The in-memory database may already be closed above.
  }
});
