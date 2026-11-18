import { createHash, randomUUID } from 'node:crypto';
import type { DurDatabase } from '../identity/database';

export type TonBlockCheckpoint = {
  network: string;
  seqno: number;
  rootHash: string;
  fileHash: string;
};

export type NormalizedChainEvent = {
  network: string;
  account: string;
  lt: string;
  txHash: string;
  eventIndex: number;
  eventType: string;
  payload: Record<string, unknown>;
  sourceContract: string;
  sourceCodeHash?: string;
  decoderVersion: string;
  verificationStatus: 'verified' | 'unverified' | 'quarantined';
};

export type IndexerBatch = {
  checkpoint: TonBlockCheckpoint;
  events: NormalizedChainEvent[];
};

function stableEventId(event: NormalizedChainEvent) {
  const identity = [
    event.network,
    event.account,
    event.lt,
    event.txHash,
    String(event.eventIndex),
  ].join(':');
  return createHash('sha256').update(identity).digest('hex');
}

function validateCheckpoint(checkpoint: TonBlockCheckpoint) {
  if (!checkpoint.network || checkpoint.network.length > 64) throw new Error('invalid_network');
  if (!Number.isSafeInteger(checkpoint.seqno) || checkpoint.seqno < 0) throw new Error('invalid_checkpoint_seqno');
  if (!/^[a-fA-F0-9]{64}$/.test(checkpoint.rootHash) || !/^[a-fA-F0-9]{64}$/.test(checkpoint.fileHash)) {
    throw new Error('invalid_checkpoint_hash');
  }
}

function validateEvent(event: NormalizedChainEvent) {
  const tonAddress = /^(?:-1|0):[a-fA-F0-9]{64}$/;
  if (!event.network || !tonAddress.test(event.account)) throw new Error('invalid_event_account');
  if (!/^[0-9]{1,20}$/.test(event.lt) || BigInt(event.lt) > 18_446_744_073_709_551_615n) throw new Error('invalid_event_lt');
  if (!/^[a-fA-F0-9]{64}$/.test(event.txHash)) throw new Error('invalid_event_tx_hash');
  if (!Number.isSafeInteger(event.eventIndex) || event.eventIndex < 0) throw new Error('invalid_event_index');
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(event.eventType)) throw new Error('invalid_event_type');
  if (!tonAddress.test(event.sourceContract)) throw new Error('invalid_source_contract');
  if (!event.decoderVersion || event.decoderVersion.length > 64) throw new Error('invalid_decoder_version');
  if (!['verified', 'unverified', 'quarantined'].includes(event.verificationStatus)) {
    throw new Error('invalid_verification_status');
  }
  if (event.sourceCodeHash && !/^[a-fA-F0-9]{64}$/.test(event.sourceCodeHash)) {
    throw new Error('invalid_source_code_hash');
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    throw new Error('invalid_event_payload');
  }
  const encoded = JSON.stringify(event.payload);
  if (encoded.length > 12_000) throw new Error('event_payload_too_large');
}

export class ChainEventStore {
  constructor(private readonly db: DurDatabase) {}

  getCheckpoint(network: string): TonBlockCheckpoint | null {
    const row = this.db.prepare(`
      SELECT network, seqno, root_hash AS rootHash, file_hash AS fileHash
      FROM indexer_checkpoints WHERE network = ?
    `).get(network) as TonBlockCheckpoint | undefined;
    return row ?? null;
  }

  ingest(batch: IndexerBatch, nowSeconds = Math.floor(Date.now() / 1000)) {
    validateCheckpoint(batch.checkpoint);
    if (!Array.isArray(batch.events) || batch.events.length > 10_000) throw new Error('invalid_event_batch');
    for (const event of batch.events) {
      validateEvent(event);
      if (event.network !== batch.checkpoint.network) throw new Error('event_network_mismatch');
    }

    const transaction = this.db.transaction(() => {
      const previous = this.getCheckpoint(batch.checkpoint.network);
      if (previous && batch.checkpoint.seqno < previous.seqno) throw new Error('checkpoint_regression');
      if (previous && batch.checkpoint.seqno === previous.seqno &&
          (previous.rootHash !== batch.checkpoint.rootHash || previous.fileHash !== batch.checkpoint.fileHash)) {
        throw new Error('checkpoint_conflict');
      }

      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO chain_events (
          id, network, account, lt, tx_hash, event_index, event_type, payload_json,
          source_contract, source_code_hash, decoder_version, verification_status, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      let inserted = 0;
      for (const event of batch.events) {
        const result = insert.run(
          stableEventId(event), event.network, event.account, event.lt, event.txHash,
          event.eventIndex, event.eventType, JSON.stringify(event.payload), event.sourceContract,
          event.sourceCodeHash ?? null, event.decoderVersion, event.verificationStatus, nowSeconds,
        );
        inserted += result.changes;
      }

      this.db.prepare(`
        INSERT INTO indexer_checkpoints (network, seqno, root_hash, file_hash, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(network) DO UPDATE SET
          seqno = excluded.seqno,
          root_hash = excluded.root_hash,
          file_hash = excluded.file_hash,
          updated_at = excluded.updated_at
        WHERE excluded.seqno >= indexer_checkpoints.seqno
      `).run(batch.checkpoint.network, batch.checkpoint.seqno, batch.checkpoint.rootHash,
        batch.checkpoint.fileHash, nowSeconds);
      return { inserted, duplicates: batch.events.length - inserted, checkpoint: batch.checkpoint };
    });

    return transaction();
  }

  listEvents(input: { network: string; limit?: number; verificationStatus?: NormalizedChainEvent['verificationStatus'] }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit ?? 50)));
    const rows = this.db.prepare(`
      SELECT id, network, account, lt, tx_hash AS txHash, event_index AS eventIndex,
             event_type AS eventType, payload_json AS payloadJson, source_contract AS sourceContract,
             source_code_hash AS sourceCodeHash, decoder_version AS decoderVersion,
             verification_status AS verificationStatus, observed_at AS observedAt
      FROM chain_events
      WHERE network = ? AND (? IS NULL OR verification_status = ?)
      ORDER BY observed_at DESC, id DESC LIMIT ?
    `).all(input.network, input.verificationStatus ?? null, input.verificationStatus ?? null, limit) as Array<{
      id: string;
      network: string;
      account: string;
      lt: string;
      txHash: string;
      eventIndex: number;
      eventType: string;
      sourceContract: string;
      sourceCodeHash: string | null;
      decoderVersion: string;
      verificationStatus: NormalizedChainEvent['verificationStatus'];
      observedAt: number;
      payloadJson: string;
    }>;
    return rows.map(({ payloadJson, ...row }) => ({
      ...row,
      payload: JSON.parse(payloadJson) as Record<string, unknown>,
    }));
  }

  quarantine(id: string, reason: string, nowSeconds = Math.floor(Date.now() / 1000)) {
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 512) throw new Error('invalid_review_reason');
    const transaction = this.db.transaction(() => {
      const updated = this.db.prepare("UPDATE chain_events SET verification_status = 'quarantined' WHERE id = ?")
        .run(id);
      if (updated.changes === 0) return false;
      this.db.prepare(`
        INSERT INTO chain_event_reviews (id, chain_event_id, status, reason, created_at)
        VALUES (?, ?, 'quarantined', ?, ?)
      `).run(randomUUID(), id, normalizedReason, nowSeconds);
      return true;
    });
    return transaction();
  }
}
