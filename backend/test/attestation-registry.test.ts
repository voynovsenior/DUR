import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';
import { AttestationRegistry } from '../src/attestations/registry';

const draft = {
  schemaId: 'dur.delivery.completed',
  schemaVersion: 1,
  subjectId: 'wallet:-3:0:abc123',
  claim: { completed: true, orderRef: 'order-42' },
  evidenceRefs: ['ton:transaction:abc123'],
};

test('issuer keys authenticate only while active and are stored as digests', () => {
  const db = openDatabase(':memory:');
  try {
    const registry = new AttestationRegistry(db);
    const created = registry.createIssuer({ displayName: 'Test Marketplace', issuerType: 'marketplace' }, 100);
    assert.equal(registry.authenticateIssuer(created.apiKey)?.id, created.issuer.id);
    assert.equal(registry.authenticateIssuer('wrong-key'), null);

    const stored = db.prepare('SELECT key_hash FROM issuer_api_keys').get() as { key_hash: string };
    assert.notEqual(stored.key_hash, created.apiKey);
    assert.equal(registry.revokeIssuerKey(created.apiKey, 101), true);
    assert.equal(registry.authenticateIssuer(created.apiKey), null);
  } finally {
    db.close();
  }
});

test('issuer can issue and revoke its own attestation with an append-only event trail', () => {
  const db = openDatabase(':memory:');
  try {
    const registry = new AttestationRegistry(db);
    const { issuer } = registry.createIssuer({ displayName: 'Test Marketplace', issuerType: 'marketplace' }, 100);
    const issued = registry.issue(issuer.id, draft, 200);
    assert.equal(issued.status, 'active');
    assert.equal(registry.get(issued.id, 201)?.claimDigest, issued.claimDigest);
    assert.equal(registry.revoke(issuer.id, issued.id, 'Order was disputed', 300), true);
    assert.equal(registry.get(issued.id, 301)?.status, 'revoked');
    assert.equal(registry.revoke(issuer.id, issued.id, 'duplicate request', 302), false);
    assert.deepEqual(
      (registry.listEvents(issued.id) as Array<{ eventType: string }>).map(event => event.eventType),
      ['issued', 'revoked'],
    );
  } finally {
    db.close();
  }
});

test('attestation expires automatically and another issuer cannot revoke it', () => {
  const db = openDatabase(':memory:');
  try {
    const registry = new AttestationRegistry(db);
    const first = registry.createIssuer({ displayName: 'Issuer One', issuerType: 'marketplace' }, 100);
    const second = registry.createIssuer({ displayName: 'Issuer Two', issuerType: 'reviewer' }, 100);
    const issued = registry.issue(first.issuer.id, { ...draft, expiresAt: 250 }, 200);
    assert.equal(registry.revoke(second.issuer.id, issued.id, 'not my attestation', 220), false);
    assert.equal(registry.get(issued.id, 250)?.status, 'expired');
    assert.deepEqual(
      (registry.listEvents(issued.id) as Array<{ eventType: string }>).map(event => event.eventType),
      ['issued', 'expired'],
    );
  } finally {
    db.close();
  }
});

test('issuer suspension blocks API key authentication and revocation is terminal', () => {
  const db = openDatabase(':memory:');
  try {
    const registry = new AttestationRegistry(db);
    const created = registry.createIssuer({ displayName: 'Policy Test', issuerType: 'marketplace' }, 100);
    assert.equal(registry.setIssuerStatus(created.issuer.id, 'suspended', 101), true);
    assert.equal(registry.authenticateIssuer(created.apiKey), null);
    assert.equal(registry.setIssuerStatus(created.issuer.id, 'active', 102), true);
    assert.equal(registry.authenticateIssuer(created.apiKey)?.id, created.issuer.id);
    assert.equal(registry.setIssuerStatus(created.issuer.id, 'revoked', 103), true);
    assert.equal(registry.setIssuerStatus(created.issuer.id, 'active', 104), false);
    assert.equal(registry.authenticateIssuer(created.apiKey), null);
  } finally {
    db.close();
  }
});

test('issuer trust tier changes require a reason and retain an audit trail', () => {
  const db = openDatabase(':memory:');
  try {
    const registry = new AttestationRegistry(db);
    const created = registry.createIssuer({ displayName: 'Reviewed Issuer', issuerType: 'marketplace' }, 100);
    assert.equal(registry.setIssuerTrustTier(created.issuer.id, 'verified', 'Business and evidence review completed', 'admin:1', 200), true);
    assert.equal(registry.setIssuerTrustTier(created.issuer.id, 'trusted', 'Independent quality review completed', 'admin:1', 300), true);
    const row = db.prepare('SELECT trust_tier AS trustTier FROM issuers WHERE id = ?')
      .get(created.issuer.id) as { trustTier: string };
    assert.equal(row.trustTier, 'trusted');
    const events = db.prepare('SELECT previous_tier AS previousTier, new_tier AS newTier, reason FROM issuer_trust_events WHERE issuer_id = ? ORDER BY occurred_at')
      .all(created.issuer.id) as Array<{ previousTier: string; newTier: string; reason: string }>;
    assert.deepEqual(events, [
      { previousTier: 'unverified', newTier: 'verified', reason: 'Business and evidence review completed' },
      { previousTier: 'verified', newTier: 'trusted', reason: 'Independent quality review completed' },
    ]);
    assert.throws(() => registry.setIssuerTrustTier(created.issuer.id, 'official', '   '), /invalid_trust_tier_reason/);
  } finally {
    db.close();
  }
});
