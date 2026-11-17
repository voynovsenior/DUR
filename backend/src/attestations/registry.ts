import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DurDatabase } from '../identity/database';
import { createAttestationRecord, type AttestationDraft, type AttestationRecord, type JsonValue } from './model';

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export type IssuerPublicRecord = {
  id: string;
  displayName: string;
  issuerType: string;
  policyVersion: number;
  trustTier: string;
  status: string;
};

export class AttestationRegistry {
  constructor(private readonly db: DurDatabase) {}

  createIssuer(input: { displayName: string; issuerType: string }, nowSeconds = Math.floor(Date.now() / 1000)) {
    const displayName = input.displayName?.trim();
    const issuerType = input.issuerType?.trim();
    if (!displayName || displayName.length > 120) throw new Error('invalid_issuer_name');
    if (!issuerType || !/^[a-z][a-z0-9_-]{1,39}$/.test(issuerType)) throw new Error('invalid_issuer_type');

    const id = randomUUID();
    const apiKey = `dur_issuer_${randomBytes(32).toString('base64url')}`;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO issuers (id, display_name, issuer_type, policy_version, trust_tier, status, created_at, updated_at)
        VALUES (?, ?, ?, 1, 'unverified', 'active', ?, ?)
      `).run(id, displayName, issuerType, nowSeconds, nowSeconds);
      this.db.prepare('INSERT INTO issuer_api_keys (key_hash, issuer_id, created_at) VALUES (?, ?, ?)')
        .run(digest(apiKey), id, nowSeconds);
    });
    transaction();

    return {
      issuer: { id, displayName, issuerType, policyVersion: 1, trustTier: 'unverified', status: 'active' },
      apiKey,
    };
  }

  setIssuerStatus(issuerId: string, status: 'active' | 'suspended' | 'revoked', nowSeconds = Math.floor(Date.now() / 1000)) {
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare('SELECT status FROM issuers WHERE id = ?')
        .get(issuerId) as { status: string } | undefined;
      if (!current || current.status === 'revoked') return false;
      if (status === current.status) return true;
      this.db.prepare('UPDATE issuers SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, nowSeconds, issuerId);
      return true;
    });
    return transaction();
  }

  authenticateIssuer(apiKey: string | undefined): IssuerPublicRecord | null {
    if (!apiKey || apiKey.length > 256) return null;
    const row = this.db.prepare(`
      SELECT i.id, i.display_name AS displayName, i.issuer_type AS issuerType,
             i.policy_version AS policyVersion, i.trust_tier AS trustTier, i.status
      FROM issuer_api_keys k
      JOIN issuers i ON i.id = k.issuer_id
      WHERE k.key_hash = ? AND k.revoked_at IS NULL AND i.status = 'active'
    `).get(digest(apiKey)) as IssuerPublicRecord | undefined;
    return row ?? null;
  }

  revokeIssuerKey(apiKey: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const result = this.db.prepare('UPDATE issuer_api_keys SET revoked_at = ? WHERE key_hash = ? AND revoked_at IS NULL')
      .run(nowSeconds, digest(apiKey));
    return result.changes > 0;
  }

  issue(issuerId: string, input: Omit<AttestationDraft, 'issuerId' | 'issuedAt'>, nowSeconds = Math.floor(Date.now() / 1000)) {
    const record: AttestationRecord = createAttestationRecord({
      ...input,
      issuerId,
      issuedAt: nowSeconds,
    });
    const id = randomUUID();

    const transaction = this.db.transaction(() => {
      const issuer = this.db.prepare('SELECT status FROM issuers WHERE id = ?').get(issuerId) as { status: string } | undefined;
      if (!issuer || issuer.status !== 'active') throw new Error('issuer_not_active');

      this.db.prepare(`
        INSERT INTO attestations (
          id, schema_id, schema_version, issuer_id, subject_id, claim_json,
          claim_digest, evidence_refs_json, issued_at, expires_at, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        id,
        record.schemaId,
        record.schemaVersion,
        issuerId,
        record.subjectId,
        JSON.stringify(record.claim),
        record.claimDigest,
        JSON.stringify(record.evidenceRefs),
        record.issuedAt,
        record.expiresAt ?? null,
        nowSeconds,
      );
      this.db.prepare(`
        INSERT INTO attestation_events (id, attestation_id, actor_issuer_id, event_type, occurred_at)
        VALUES (?, ?, ?, 'issued', ?)
      `).run(randomUUID(), id, issuerId, nowSeconds);
    });
    transaction();

    return { id, ...record };
  }

  revoke(issuerId: string, attestationId: string, reason: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const normalizedReason = reason?.trim();
    if (!normalizedReason || normalizedReason.length > 512) throw new Error('invalid_revocation_reason');

    const transaction = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT issuer_id AS issuerId, status, expires_at AS expiresAt
        FROM attestations WHERE id = ?
      `).get(attestationId) as { issuerId: string; status: string; expiresAt: number | null } | undefined;
      if (!row || row.issuerId !== issuerId || row.status !== 'active') return false;

      if (row.expiresAt !== null && row.expiresAt <= nowSeconds) {
        this.db.prepare("UPDATE attestations SET status = 'expired' WHERE id = ?").run(attestationId);
        this.db.prepare(`
          INSERT INTO attestation_events (id, attestation_id, actor_issuer_id, event_type, occurred_at, reason)
          VALUES (?, ?, ?, 'expired', ?, 'Attestation expired before revocation')
        `).run(randomUUID(), attestationId, issuerId, nowSeconds);
        return false;
      }

      this.db.prepare(`
        UPDATE attestations
        SET status = 'revoked', revoked_at = ?, revocation_reason = ?
        WHERE id = ? AND status = 'active'
      `).run(nowSeconds, normalizedReason, attestationId);
      this.db.prepare(`
        INSERT INTO attestation_events (id, attestation_id, actor_issuer_id, event_type, occurred_at, reason)
        VALUES (?, ?, ?, 'revoked', ?, ?)
      `).run(randomUUID(), attestationId, issuerId, nowSeconds, normalizedReason);
      return true;
    });
    return transaction();
  }

  get(attestationId: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const row = this.db.prepare(`
      SELECT id, schema_id AS schemaId, schema_version AS schemaVersion, issuer_id AS issuerId,
             subject_id AS subjectId, claim_json AS claimJson, claim_digest AS claimDigest,
             evidence_refs_json AS evidenceRefsJson, issued_at AS issuedAt, expires_at AS expiresAt,
             status, revoked_at AS revokedAt, revocation_reason AS revocationReason
      FROM attestations WHERE id = ?
    `).get(attestationId) as {
      id: string; schemaId: string; schemaVersion: number; issuerId: string; subjectId: string;
      claimJson: string; claimDigest: string; evidenceRefsJson: string; issuedAt: number;
      expiresAt: number | null; status: string; revokedAt: number | null; revocationReason: string | null;
    } | undefined;
    if (!row) return null;

    if (row.status === 'active' && row.expiresAt !== null && row.expiresAt <= nowSeconds) {
      const transition = this.db.transaction(() => {
        const updated = this.db.prepare(
          "UPDATE attestations SET status = 'expired' WHERE id = ? AND status = 'active'",
        ).run(attestationId);
        if (updated.changes > 0) {
          this.db.prepare(`
            INSERT INTO attestation_events (id, attestation_id, actor_issuer_id, event_type, occurred_at, reason)
            VALUES (?, ?, NULL, 'expired', ?, 'Attestation expiry reached')
          `).run(randomUUID(), attestationId, nowSeconds);
        }
        const current = this.db.prepare('SELECT status FROM attestations WHERE id = ?').get(attestationId) as { status: string };
        return current.status;
      });
      row.status = transition();
    }

    return {
      id: row.id,
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
      issuerId: row.issuerId,
      subjectId: row.subjectId,
      claim: JSON.parse(row.claimJson) as { [key: string]: JsonValue },
      claimDigest: row.claimDigest,
      evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      status: row.status,
      revokedAt: row.revokedAt,
      revocationReason: row.revocationReason,
    };
  }

  listEvents(attestationId: string) {
    return this.db.prepare(`
      SELECT event_type AS eventType, actor_issuer_id AS actorIssuerId, occurred_at AS occurredAt, reason
      FROM attestation_events WHERE attestation_id = ? ORDER BY occurred_at ASC, id ASC
    `).all(attestationId);
  }
}
