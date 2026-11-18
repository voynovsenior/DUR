import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';

test('database applies the initial schema migration', () => {
  const db = openDatabase(':memory:');
  try {
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
    assert.deepEqual(migrations, [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }]);

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

    const eventColumns = db.prepare('PRAGMA table_info(chain_events)').all() as Array<{ name: string }>;
    assert.ok(eventColumns.some(column => column.name === 'verification_status'));

    const schemaColumns = db.prepare('PRAGMA table_info(attestation_schemas)').all() as Array<{ name: string }>;
    assert.ok(schemaColumns.some(column => column.name === 'schema_json'));

    const consentColumns = db.prepare('PRAGMA table_info(subject_consents)').all() as Array<{ name: string }>;
    assert.ok(consentColumns.some(column => column.name === 'revoked_at'));

    const trustEvents = db.prepare('PRAGMA table_info(issuer_trust_events)').all() as Array<{ name: string }>;
    assert.ok(trustEvents.some(column => column.name === 'reason'));

    const disputes = db.prepare('PRAGMA table_info(attestation_disputes)').all() as Array<{ name: string }>;
    assert.ok(disputes.some(column => column.name === 'resolution_reason'));

    const proofs = db.prepare('PRAGMA table_info(chain_event_transaction_proofs)').all() as Array<{ name: string }>;
    assert.ok(proofs.some(column => column.name === 'masterchain_root_hash'));

    const visibility = db.prepare('PRAGMA table_info(profile_visibility_consents)').all() as Array<{ name: string }>;
    assert.ok(visibility.some(column => column.name === 'revoked_at'));
  } finally {
    db.close();
  }
});
