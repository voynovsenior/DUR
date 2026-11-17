import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';
import { ChainEventStore, type IndexerBatch } from '../src/indexer/event-store';

function setup() {
  const db = openDatabase(':memory:');
  return { db, store: new ChainEventStore(db) };
}

const batch: IndexerBatch = {
  checkpoint: { network: 'ton-testnet', seqno: 100, rootHash: 'a'.repeat(64), fileHash: 'b'.repeat(64) },
  events: [{
    network: 'ton-testnet',
    account: '0:' + '1'.repeat(64),
    lt: '123456789',
    txHash: 'c'.repeat(64),
    eventIndex: 0,
    eventType: 'contract.event',
    payload: { amount: '1000' },
    sourceContract: '0:' + '2'.repeat(64),
    sourceCodeHash: 'd'.repeat(64),
    decoderVersion: 'fixture-v1',
    verificationStatus: 'verified',
  }],
};

test('indexer store ingests events and advances checkpoint atomically', () => {
  const { db, store } = setup();
  const result = store.ingest(batch, 1_800_000_000);
  assert.equal(result.inserted, 1);
  assert.equal(store.getCheckpoint('ton-testnet')?.seqno, 100);
  assert.equal(store.listEvents({ network: 'ton-testnet' }).length, 1);
  db.close();
});

test('indexer store is idempotent for replayed event batches', () => {
  const { db, store } = setup();
  assert.equal(store.ingest(batch).inserted, 1);
  const replay = store.ingest(batch);
  assert.equal(replay.inserted, 0);
  assert.equal(replay.duplicates, 1);
  db.close();
});

test('indexer store rejects checkpoint regression and conflicting checkpoint hashes', () => {
  const { db, store } = setup();
  store.ingest(batch);
  assert.throws(() => store.ingest({
    ...batch,
    checkpoint: { ...batch.checkpoint, seqno: 99 },
  }), /checkpoint_regression/);
  assert.throws(() => store.ingest({
    ...batch,
    checkpoint: { ...batch.checkpoint, rootHash: 'e'.repeat(64) },
  }), /checkpoint_conflict/);
  db.close();
});

test('indexer store rejects malformed and cross-network events without advancing checkpoint', () => {
  const { db, store } = setup();
  assert.throws(() => store.ingest({
    ...batch,
    events: [{ ...batch.events[0], txHash: 'bad' }],
  }), /invalid_event_tx_hash/);
  assert.equal(store.getCheckpoint('ton-testnet'), null);
  assert.throws(() => store.ingest({
    ...batch,
    events: [{ ...batch.events[0], network: 'ton-mainnet' }],
  }), /event_network_mismatch/);
  db.close();
});

test('indexer store can quarantine a previously ingested event with an audit reason', () => {
  const { db, store } = setup();
  store.ingest(batch);
  const event = store.listEvents({ network: 'ton-testnet' })[0];
  assert.equal(store.quarantine(String(event.id), 'Unknown contract code hash'), true);
  assert.equal(store.listEvents({ network: 'ton-testnet' })[0].verificationStatus, 'quarantined');
  db.close();
});

test('indexer store rejects non-canonical addresses and out-of-range logical times', () => {
  const { db, store } = setup();
  assert.throws(() => store.ingest({
    ...batch,
    events: [{ ...batch.events[0], account: 'not-an-address' }],
  }), /invalid_event_account/);
  assert.throws(() => store.ingest({
    ...batch,
    events: [{ ...batch.events[0], lt: '18446744073709551616' }],
  }), /invalid_event_lt/);
  db.close();
});
