export const REPUTATION_METHODOLOGY_VERSION = "0.1.0";

export const REPUTATION_DIMENSIONS = [
  "reliability",
  "delivery",
  "communication",
  "disputeResolution",
] as const;

export type ReputationDimension = typeof REPUTATION_DIMENSIONS[number];
export type ReputationTrustTier = "unverified" | "verified" | "trusted" | "official";

export type ReputationEvidence = {
  id: string;
  issuerId: string;
  schemaId: string;
  issuedAt: number;
  expiresAt: number | null;
  status: string;
  trustTier: ReputationTrustTier;
  claim: unknown;
};

export type ReputationDimensionResult = {
  value: number | null;
  evidenceCount: number;
  issuerCount: number;
};

export type ReputationProjection = {
  methodologyVersion: string;
  computedAt: number;
  dimensions: Record<ReputationDimension, ReputationDimensionResult>;
  eligibleEvidenceCount: number;
  eligibleIssuerCount: number;
  limitations: string[];
};

const TIER_WEIGHT: Record<ReputationTrustTier, number> = {
  unverified: 0,
  verified: 0.5,
  trusted: 0.75,
  official: 1,
};
const HALF_LIFE_SECONDS = 180 * 24 * 60 * 60;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readDimensionValues(claim: unknown): Partial<Record<ReputationDimension, number>> {
  if (!claim || typeof claim !== "object" || Array.isArray(claim)) return {};
  const reputation = (claim as Record<string, unknown>).reputation;
  if (!reputation || typeof reputation !== "object" || Array.isArray(reputation)) return {};
  const dimensions = (reputation as Record<string, unknown>).dimensions;
  if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) return {};

  const result: Partial<Record<ReputationDimension, number>> = {};
  for (const dimension of REPUTATION_DIMENSIONS) {
    const value = (dimensions as Record<string, unknown>)[dimension];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100) {
      result[dimension] = value;
    }
  }
  return result;
}

/**
 * Produces explainable dimension projections from issuer attestations.
 * It never consumes unverified issuers, revoked/expired attestations, or raw indexer events.
 * Repeated updates from the same issuer/schema pair are collapsed to the latest record.
 */
export function calculateReputation(
  evidence: ReputationEvidence[],
  nowSeconds = Math.floor(Date.now() / 1000),
): ReputationProjection {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds <= 0) throw new Error("invalid_computation_time");

  const latest = new Map<string, ReputationEvidence>();
  for (const item of evidence) {
    if (!item || typeof item.id !== "string" || typeof item.issuerId !== "string" ||
        typeof item.schemaId !== "string" || !Number.isSafeInteger(item.issuedAt) ||
        item.issuedAt <= 0 || item.issuedAt > nowSeconds + 300 ||
        (item.expiresAt !== null && item.expiresAt <= nowSeconds) ||
        item.status !== "active" || !(item.trustTier in TIER_WEIGHT) ||
        TIER_WEIGHT[item.trustTier] <= 0) continue;

    const key = item.issuerId + ":" + item.schemaId;
    const current = latest.get(key);
    if (!current || item.issuedAt > current.issuedAt ||
        (item.issuedAt === current.issuedAt && item.id > current.id)) latest.set(key, item);
  }

  const accepted = [...latest.values()].filter(item => Object.keys(readDimensionValues(item.claim)).length > 0);
  const dimensions = {} as Record<ReputationDimension, ReputationDimensionResult>;
  for (const dimension of REPUTATION_DIMENSIONS) {
    let weightedTotal = 0;
    let totalWeight = 0;
    let evidenceCount = 0;
    const issuers = new Set<string>();

    for (const item of accepted) {
      const value = readDimensionValues(item.claim)[dimension];
      if (value === undefined) continue;
      const age = Math.max(0, nowSeconds - item.issuedAt);
      const recencyWeight = Math.pow(0.5, age / HALF_LIFE_SECONDS);
      const weight = TIER_WEIGHT[item.trustTier] * recencyWeight;
      if (weight <= 0) continue;
      weightedTotal += value * weight;
      totalWeight += weight;
      evidenceCount += 1;
      issuers.add(item.issuerId);
    }

    dimensions[dimension] = {
      value: totalWeight > 0 ? Math.round(clamp(weightedTotal / totalWeight, 0, 100) * 100) / 100 : null,
      evidenceCount,
      issuerCount: issuers.size,
    };
  }

  return {
    methodologyVersion: REPUTATION_METHODOLOGY_VERSION,
    computedAt: nowSeconds,
    dimensions,
    eligibleEvidenceCount: accepted.length,
    eligibleIssuerCount: new Set(accepted.map(item => item.issuerId)).size,
    limitations: [
      "Scores summarize issuer claims; they do not prove the underlying claims are true.",
      "Only attestations from verified, trusted, or official issuers are eligible.",
      "Repeated updates from one issuer for one schema are reduced to the latest attestation.",
      "Unverified TON indexer events are excluded.",
      "A wallet address is not proof of a unique human identity.",
    ],
  };
}
