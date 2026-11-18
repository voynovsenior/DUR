import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';
import { AttestationRegistry } from '../src/attestations/registry';
import { AttestationDisputeRegistry } from '../src/attestations/disputes';
import { calculateReputation } from '../src/reputation/engine';

const subjectId = 'wallet:-3:0:dispute-reputation-test';
const schemaId = 'dur.reputation.v1';

function setup() {
  const db = openDatabase(':memory:');
  const issuers = new AttestationRegistry(db);
  const disputes = new AttestationDisputeRegistry(db);
  const insertUser = db.prepare(`
    INSERT INTO users (id, telegram_id, telegram_username, first_name, created_at, updated_at)
    VALUES (?, ?, NULL, ?, 1, 1)
  `);
  insertUser.run('user-1', '10001', 'Dispute Reporter');
  insertUser.run('user-2', '10002', 'Second Reporter');
  const created = issuers.createIssuer({ displayName: 'Dispute Test Issuer', issuerType: 'marketplace' }, 100);
  issuers.setIssuerTrustTier(created.issuer.id, 'verified', 'Fixture issuer review completed', 'test', 150);
  const attestation = issuers.issue(created.issuer.id, {
    schemaId,
    schemaVersion: 1,
    subjectId,
    claim: { reputation: { dimensions: { reliability: 88 } } },
    evidenceRefs: [],
  }, 200);
  return { db, issuers, disputes, attestation };
}

test('open dispute immediately excludes attestation from reputation', () => {
  const { db, issuers, disputes, attestation } = setup();
  try {
    disputes.open({
      attestationId: attestation.id,
      subjectId,
      openedByUserId: 'user-1',
      reason: 'The submitted completion evidence does not match the agreement.',
    }, 250);

    const evidence = issuers.listReputationEvidence(subjectId, 300);
    assert.equal(evidence[0].status, 'disputed');
    const projection = calculateReputation(evidence, 300);
    assert.equal(projection.dimensions.reliability.value, null);
    assert.equal(projection.eligibleEvidenceCount, 0);
  } finally {
    db.close();
  }
});

test('rejected dispute restores otherwise eligible attestation to reputation', () => {
  const { db, issuers, disputes, attestation } = setup();
  try {
    const dispute = disputes.open({
      attestationId: attestation.id,
      subjectId,
      openedByUserId: 'user-1',
      reason: 'The submitted completion evidence does not match the agreement.',
    }, 250);
    disputes.resolve(dispute.id, 'rejected', 'Review found the original evidence valid and consistent.', 'admin-1', 275);

    const evidence = issuers.listReputationEvidence(subjectId, 300);
    assert.equal(evidence[0].status, 'active');
    const projection = calculateReputation(evidence, 300);
    assert.equal(projection.dimensions.reliability.value, 88);
    assert.equal(projection.eligibleEvidenceCount, 1);
  } finally {
    db.close();
  }
});

test('upheld dispute permanently suppresses the attestation from reputation', () => {
  const { db, issuers, disputes, attestation } = setup();
  try {
    const dispute = disputes.open({
      attestationId: attestation.id,
      subjectId,
      openedByUserId: 'user-1',
      reason: 'The submitted completion evidence does not match the agreement.',
    }, 250);
    disputes.resolve(dispute.id, 'upheld', 'Review confirmed that the attestation was materially inaccurate.', 'admin-1', 275);

    const evidence = issuers.listReputationEvidence(subjectId, 300);
    assert.equal(evidence[0].status, 'disputed');
    const projection = calculateReputation(evidence, 300);
    assert.equal(projection.dimensions.reliability.value, null);
    assert.equal(projection.eligibleEvidenceCount, 0);

    assert.throws(() => disputes.open({
      attestationId: attestation.id,
      subjectId,
      openedByUserId: 'user-2',
      reason: 'A second attempt to dispute the same attestation.',
    }, 310), /attestation_dispute_already_upheld/);
  } finally {
    db.close();
  }
});

test('disputed newest issuer/schema record suppresses older active evidence', () => {
  const { db, issuers, disputes, attestation } = setup();
  try {
    const newer = issuers.issue(attestation.issuerId, {
      schemaId,
      schemaVersion: 1,
      subjectId,
      claim: { reputation: { dimensions: { reliability: 12 } } },
      evidenceRefs: [],
    }, 220);
    const dispute = disputes.open({
      attestationId: newer.id,
      subjectId,
      openedByUserId: 'user-1',
      reason: 'The newer claim contains an incorrect completion result.',
    }, 250);
    assert.equal(disputes.get(dispute.id)?.status, 'open');

    const evidence = issuers.listReputationEvidence(subjectId, 300);
    const projection = calculateReputation(evidence, 300);
    assert.equal(projection.dimensions.reliability.value, null);
    assert.equal(projection.eligibleEvidenceCount, 0);
  } finally {
    db.close();
  }
});
