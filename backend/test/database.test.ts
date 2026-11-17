import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';

test('database applies the initial schema migration', () => {
  const db = openDatabase(':memory:');
  try {
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert.deepEqual(migrations, [{ version: 1 }, { version: 2 }, { version: 3 }]);

    const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
    assert.ok(userColumns.some(column => column.name === 'telegram_id'));

    const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    assert.ok(sessionColumns.some(column => column.name === 'token_hash'));

    const walletColumns = db.prepare('PRAGMA table_info(wallet_links)').all() as Array<{ name: string }>;
    assert.ok(walletColumns.some(column => column.name === 'address'));

    const challengeColumns = db.prepare('PRAGMA table_info(ton_proof_challenges)').all() as Array<{ name: string }>;
    assert.ok(challengeColumns.some(column => column.name === 'attempt_hash'));

    const issuerColumns = db.prepare('PRAGMA table_info(issuers)').all() as Array<{ name: string }>;
    assert.ok(issuerColumns.some(column => column.name === 'trust_tier'));

    const attestationColumns = db.prepare('PRAGMA table_info(attestations)').all() as Array<{ name: string }>;
    assert.ok(attestationColumns.some(column => column.name === 'claim_digest'));
  } finally {
    db.close();
  }
});
