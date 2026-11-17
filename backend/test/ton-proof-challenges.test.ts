import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';
import { TonProofChallengeStore } from '../src/identity/ton-proof-challenges';

test('TON proof challenge is bound to its user and attempt token', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO users (id, telegram_id, first_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('user-1', '10001', 'Test', 1, 1);
    const store = new TonProofChallengeStore(db);
    const issued = store.issue('user-1', 1_800_000_000);
    assert.equal(store.matches(issued.payload, issued.attemptToken, 'user-1', 1_800_000_001), true);
    assert.equal(store.matches(issued.payload, issued.attemptToken, 'user-2', 1_800_000_001), false);
    assert.equal(store.matches(issued.payload, 'wrong-token', 'user-1', 1_800_000_001), false);
  } finally {
    db.close();
  }
});

test('TON proof challenge expires and can be consumed only once', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO users (id, telegram_id, first_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('user-1', '10001', 'Test', 1, 1);
    const store = new TonProofChallengeStore(db);
    const issued = store.issue('user-1', 1_800_000_000);
    assert.equal(store.consume(issued.payload, issued.attemptToken, 'user-1', 1_800_000_001), true);
    assert.equal(store.consume(issued.payload, issued.attemptToken, 'user-1', 1_800_000_001), false);

    const expired = store.issue('user-1', 1_800_000_000);
    assert.equal(store.matches(expired.payload, expired.attemptToken, 'user-1', expired.expiresAt), false);
    assert.equal(store.consume(expired.payload, expired.attemptToken, 'user-1', expired.expiresAt), false);
  } finally {
    db.close();
  }
});
