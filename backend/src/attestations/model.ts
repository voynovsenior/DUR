import { createHash } from 'node:crypto';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type AttestationDraft = {
  schemaId: string;
  schemaVersion: number;
  issuerId: string;
  subjectId: string;
  claim: { [key: string]: JsonValue };
  evidenceRefs: string[];
  issuedAt: number;
  expiresAt?: number;
};

export type AttestationRecord = AttestationDraft & {
  claimDigest: string;
  status: 'active';
};

const MAX_CLAIM_BYTES = 32_768;
const MAX_DEPTH = 16;

function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error('claim_too_deep');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value) as string;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('claim_invalid_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('claim_invalid_object');
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key], depth + 1)}`).join(',')}}`;
  }
  throw new Error('claim_invalid_value');
}

function requiredId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !/^[a-zA-Z0-9:_./-]+$/.test(value)) {
    throw new Error(`invalid_${field}`);
  }
}

/**
 * Validates an issuer claim and computes a deterministic digest.
 * The digest proves content identity, not the truth of the claim or the issuer's authority.
 */
export function createAttestationRecord(draft: AttestationDraft): AttestationRecord {
  requiredId(draft.schemaId, 'schema_id');
  requiredId(draft.issuerId, 'issuer_id');
  requiredId(draft.subjectId, 'subject_id');

  if (!Number.isSafeInteger(draft.schemaVersion) || draft.schemaVersion < 1) {
    throw new Error('invalid_schema_version');
  }
  if (!Number.isSafeInteger(draft.issuedAt) || draft.issuedAt <= 0) {
    throw new Error('invalid_issued_at');
  }
  if (draft.expiresAt !== undefined &&
      (!Number.isSafeInteger(draft.expiresAt) || draft.expiresAt <= draft.issuedAt)) {
    throw new Error('invalid_expires_at');
  }
  if (!draft.claim || typeof draft.claim !== 'object' || Array.isArray(draft.claim)) {
    throw new Error('invalid_claim');
  }
  if (!Array.isArray(draft.evidenceRefs) || draft.evidenceRefs.length > 20 ||
      draft.evidenceRefs.some(ref => typeof ref !== 'string' || ref.length < 1 || ref.length > 512)) {
    throw new Error('invalid_evidence_refs');
  }

  const canonicalClaim = canonicalJson(draft.claim);
  if (Buffer.byteLength(canonicalClaim, 'utf8') > MAX_CLAIM_BYTES) {
    throw new Error('claim_too_large');
  }
  const claimDigest = createHash('sha256').update(canonicalClaim, 'utf8').digest('hex');

  return {
    ...draft,
    claim: JSON.parse(canonicalClaim) as { [key: string]: JsonValue },
    evidenceRefs: [...draft.evidenceRefs],
    claimDigest,
    status: 'active',
  };
}
