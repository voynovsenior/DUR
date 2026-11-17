import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttestationRecord } from '../src/attestations/model';

const base = {
  schemaId: 'dur.delivery.completed',
  schemaVersion: 1,
  issuerId: 'issuer:marketplace-01',
  subjectId: 'wallet:0:abc123',
  claim: { completed: true, rating: 5, details: { region: 'testnet', order: 42 } },
  evidenceRefs: ['ton:transaction:abc'],
  issuedAt: 1_800_000_000,
};

test('attestation claim digest is deterministic across object key order', () => {
  const first = createAttestationRecord(base);
  const second = createAttestationRecord({
    ...base,
    claim: { details: { order: 42, region: 'testnet' }, rating: 5, completed: true },
  });
  assert.equal(first.claimDigest, second.claimDigest);
  assert.match(first.claimDigest, /^[a-f0-9]{64}$/);
});

test('attestation rejects expiry at or before issue time', () => {
  assert.throws(() => createAttestationRecord({ ...base, expiresAt: base.issuedAt }), /invalid_expires_at/);
});

test('attestation rejects non-finite numbers in claims', () => {
  assert.throws(() => createAttestationRecord({ ...base, claim: { score: Number.NaN } }), /claim_invalid_number/);
});

test('attestation rejects invalid identifiers and oversized evidence lists', () => {
  assert.throws(() => createAttestationRecord({ ...base, issuerId: 'bad issuer' }), /invalid_issuer_id/);
  assert.throws(() => createAttestationRecord({ ...base, evidenceRefs: Array(21).fill('ref') }), /invalid_evidence_refs/);
});
