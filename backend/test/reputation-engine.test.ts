import test from "node:test";
import assert from "node:assert/strict";
import { calculateReputation } from "../src/reputation/engine";

const now = 2_000_000_000;
const claim = (reliability: number) => ({
  reputation: { dimensions: { reliability, delivery: 80, communication: 70, disputeResolution: 60 } },
});
const item = (overrides: Record<string, unknown> = {}) => ({
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
