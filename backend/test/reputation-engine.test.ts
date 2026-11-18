import test from "node:test";
import assert from "node:assert/strict";
import { calculateReputation, type ReputationEvidence } from "../src/reputation/engine";

const now = 2_000_000_000;
const claim = (reliability: number) => ({
  reputation: { dimensions: { reliability, delivery: 80, communication: 70, disputeResolution: 60 } },
});
const item = (overrides: Partial<ReputationEvidence> = {}): ReputationEvidence => ({
  id: "a1",
  issuerId: "issuer-a",
  schemaId: "marketplace.v1",
  issuedAt: now - 60,
  expiresAt: null,
  status: "active",
  trustTier: "verified" as const,
  claim: claim(90),
  ...overrides,
});

test("reputation includes eligible evidence and exposes per-dimension coverage", () => {
  const result = calculateReputation([item()], now);
  assert.equal(result.methodologyVersion, "0.1.0");
  assert.equal(result.dimensions.reliability.value, 90);
  assert.equal(result.dimensions.reliability.evidenceCount, 1);
  assert.equal(result.dimensions.delivery.value, 80);
  assert.equal(result.eligibleIssuerCount, 1);
});

test("unverified, revoked, and expired evidence is excluded", () => {
  const result = calculateReputation([
    item({ id: "unverified", trustTier: "unverified", claim: claim(100) }),
    item({ id: "revoked", status: "revoked", claim: claim(100) }),
    item({ id: "expired", expiresAt: now - 1, claim: claim(100) }),
  ], now);
  assert.equal(result.dimensions.reliability.value, null);
  assert.equal(result.eligibleEvidenceCount, 0);
});

test("latest attestation per issuer and schema replaces repeated submissions", () => {
  const result = calculateReputation([
    item({ id: "older", issuedAt: now - 100, claim: claim(10) }),
    item({ id: "newer", issuedAt: now - 50, claim: claim(90) }),
  ], now);
  assert.equal(result.dimensions.reliability.value, 90);
  assert.equal(result.dimensions.reliability.evidenceCount, 1);
});

test("independent issuers are combined using trust and recency weights", () => {
  const result = calculateReputation([
    item({ id: "a", issuerId: "issuer-a", claim: claim(100) }),
    item({ id: "b", issuerId: "issuer-b", trustTier: "official", claim: claim(0) }),
  ], now);
  assert.ok(result.dimensions.reliability.value !== null);
  assert.ok(result.dimensions.reliability.value < 100);
  assert.equal(result.dimensions.reliability.issuerCount, 2);
});

test("invalid or out-of-range dimension values are ignored", () => {
  const result = calculateReputation([
    item({ claim: { reputation: { dimensions: { reliability: 101 } } } }),
  ], now);
  assert.equal(result.dimensions.reliability.value, null);
});

test("future computation timestamps are rejected", () => {
  assert.throws(() => calculateReputation([], 0), /invalid_computation_time/);
});

test("recency half-life reduces the influence of older independent evidence", () => {
  const result = calculateReputation([
    item({ id: "older", issuerId: "issuer-old", issuedAt: now - 360 * 24 * 60 * 60, claim: claim(100) }),
    item({ id: "newer", issuerId: "issuer-new", issuedAt: now, claim: claim(0) }),
  ], now);
  assert.ok(result.dimensions.reliability.value !== null);
  assert.ok(Math.abs(result.dimensions.reliability.value - 20) < 0.02);
  assert.equal(result.dimensions.reliability.evidenceCount, 2);
});

test("attestations without any supported reputation dimension are not counted", () => {
  const result = calculateReputation([
    item({ claim: { completed: true } }),
  ], now);
  assert.equal(result.eligibleEvidenceCount, 0);
  assert.equal(result.eligibleIssuerCount, 0);
  assert.equal(result.dimensions.reliability.value, null);
});


test("newer revoked evidence suppresses an older active attestation from the same issuer and schema", () => {
  const result = calculateReputation([
    item({ id: "older-active", issuedAt: now - 100, claim: claim(95) }),
    item({ id: "newer-revoked", issuedAt: now - 50, status: "revoked", claim: claim(10) }),
  ], now);
  assert.equal(result.dimensions.reliability.value, null);
  assert.equal(result.eligibleEvidenceCount, 0);
});

test("newer expired evidence does not resurrect an older active attestation", () => {
  const result = calculateReputation([
    item({ id: "older-active", issuedAt: now - 100, claim: claim(95) }),
    item({ id: "newer-expired", issuedAt: now - 50, expiresAt: now - 1, claim: claim(10) }),
  ], now);
  assert.equal(result.dimensions.reliability.value, null);
  assert.equal(result.eligibleEvidenceCount, 0);
});
