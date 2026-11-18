import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export type AttestationDisputeStatus = "open" | "upheld" | "rejected";

export type AttestationDispute = {
  id: string;
  attestationId: string;
  subjectId: string;
  openedByUserId: string;
  reason: string;
  evidenceRefs: string[];
  status: AttestationDisputeStatus;
  resolutionReason: string | null;
  openedAt: number;
  resolvedAt: number | null;
};

export class AttestationDisputeRegistry {
  constructor(private readonly db: InstanceType<typeof Database>) {}

  open(input: {
    attestationId: string;
    subjectId: string;
    openedByUserId: string;
    reason: string;
    evidenceRefs?: string[];
  }, nowSeconds = Math.floor(Date.now() / 1000)): AttestationDispute {
    const reason = input.reason.trim();
    const refs = input.evidenceRefs ?? [];
    if (!reason || reason.length < 10 || reason.length > 512) throw new Error("invalid_dispute_reason");
    if (!Array.isArray(refs) || refs.length > 10 ||
        refs.some(ref => typeof ref !== "string" || !ref.trim() || ref.length > 512)) {
      throw new Error("invalid_dispute_evidence_refs");
    }

    const attestation = this.db.prepare(
      "SELECT subject_id AS subjectId, status FROM attestations WHERE id = ?",
    ).get(input.attestationId) as { subjectId: string; status: string } | undefined;
    if (!attestation) throw new Error("attestation_not_found");
    if (attestation.subjectId !== input.subjectId) throw new Error("dispute_subject_mismatch");
    if (attestation.status !== "active") throw new Error("attestation_not_active");
    const upheld = this.db.prepare(
      "SELECT 1 FROM attestation_disputes WHERE attestation_id = ? AND status = 'upheld' LIMIT 1",
    ).get(input.attestationId);
    if (upheld) throw new Error("attestation_dispute_already_upheld");

    const id = randomUUID();
    try {
      const transaction = this.db.transaction(() => {
        this.db.prepare(`
          INSERT INTO attestation_disputes
            (id, attestation_id, subject_id, opened_by_user_id, reason,
             evidence_refs_json, status, opened_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
        `).run(
          id,
          input.attestationId,
          input.subjectId,
          input.openedByUserId,
          reason,
          JSON.stringify(refs),
          nowSeconds,
        );
        this.db.prepare(`
          INSERT INTO attestation_dispute_events
            (id, dispute_id, previous_status, new_status, actor, reason, occurred_at)
          VALUES (?, ?, NULL, 'open', ?, ?, ?)
        `).run(randomUUID(), id, input.openedByUserId, reason, nowSeconds);
      });
      transaction();
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
        throw new Error("dispute_already_open");
      }
      throw error;
    }
    return this.get(id)!;
  }

  get(id: string): AttestationDispute | null {
    const row = this.db.prepare(`
      SELECT id, attestation_id AS attestationId, subject_id AS subjectId,
             opened_by_user_id AS openedByUserId, reason,
             evidence_refs_json AS evidenceRefsJson, status,
             resolution_reason AS resolutionReason, opened_at AS openedAt,
             resolved_at AS resolvedAt
      FROM attestation_disputes WHERE id = ?
    `).get(id) as (Omit<AttestationDispute, "evidenceRefs"> & { evidenceRefsJson: string }) | undefined;
    if (!row) return null;
    const { evidenceRefsJson, ...dispute } = row;
    return { ...dispute, evidenceRefs: JSON.parse(evidenceRefsJson) as string[] };
  }

  listForUser(userId: string): AttestationDispute[] {
    const rows = this.db.prepare(`
      SELECT id, attestation_id AS attestationId, subject_id AS subjectId,
             opened_by_user_id AS openedByUserId, reason,
             evidence_refs_json AS evidenceRefsJson, status,
             resolution_reason AS resolutionReason, opened_at AS openedAt,
             resolved_at AS resolvedAt
      FROM attestation_disputes
      WHERE opened_by_user_id = ?
      ORDER BY opened_at DESC, id DESC
      LIMIT 100
    `).all(userId) as Array<Omit<AttestationDispute, "evidenceRefs"> & { evidenceRefsJson: string }>;
    return rows.map(({ evidenceRefsJson, ...dispute }) => ({
      ...dispute,
      evidenceRefs: JSON.parse(evidenceRefsJson) as string[],
    }));
  }

  listAll(input: { status?: AttestationDisputeStatus; limit?: number } = {}): AttestationDispute[] {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
    const rows = this.db.prepare(`
      SELECT id, attestation_id AS attestationId, subject_id AS subjectId,
             opened_by_user_id AS openedByUserId, reason,
             evidence_refs_json AS evidenceRefsJson, status,
             resolution_reason AS resolutionReason, opened_at AS openedAt,
             resolved_at AS resolvedAt
      FROM attestation_disputes
      WHERE (? IS NULL OR status = ?)
      ORDER BY opened_at DESC, id DESC
      LIMIT ?
    `).all(input.status ?? null, input.status ?? null, limit) as Array<
      Omit<AttestationDispute, "evidenceRefs"> & { evidenceRefsJson: string }
    >;
    return rows.map(({ evidenceRefsJson, ...dispute }) => ({
      ...dispute,
      evidenceRefs: JSON.parse(evidenceRefsJson) as string[],
    }));
  }

  resolve(
    id: string,
    status: "upheld" | "rejected",
    resolutionReason: string,
    actor = "admin",
    nowSeconds = Math.floor(Date.now() / 1000),
  ): AttestationDispute | null {
    const reason = resolutionReason.trim();
    if (!reason || reason.length < 10 || reason.length > 512) {
      throw new Error("invalid_dispute_resolution_reason");
    }
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare(
        "SELECT status FROM attestation_disputes WHERE id = ?",
      ).get(id) as { status: string } | undefined;
      if (!current) return false;
      if (current.status !== "open") throw new Error("dispute_not_open");
      this.db.prepare(`
        UPDATE attestation_disputes
        SET status = ?, resolution_reason = ?, resolved_at = ?
        WHERE id = ?
      `).run(status, reason, nowSeconds, id);
      this.db.prepare(`
        INSERT INTO attestation_dispute_events
          (id, dispute_id, previous_status, new_status, actor, reason, occurred_at)
        VALUES (?, ?, 'open', ?, ?, ?, ?)
      `).run(randomUUID(), id, status, actor, reason, nowSeconds);
      return true;
    });
    return transaction() ? this.get(id) : null;
  }
}
