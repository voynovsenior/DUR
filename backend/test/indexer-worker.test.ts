import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexerWorkerConfig } from '../src/indexer/worker';

test('indexer worker defaults to bounded polling and batch sizes', () => {
  assert.deepEqual(readIndexerWorkerConfig({}), {
    pollIntervalMs: 15_000,
    batchDelayMs: 1_000,
    maxBlocks: 10,
  });
});

test('indexer worker accepts explicit safe configuration', () => {
  assert.deepEqual(readIndexerWorkerConfig({
    INDEXER_POLL_INTERVAL_MS: '30000',
    INDEXER_BATCH_DELAY_MS: '2000',
    INDEXER_MAX_BLOCKS: '50',
  }), {
    pollIntervalMs: 30_000,
    batchDelayMs: 2_000,
    maxBlocks: 50,
  });
});

test('indexer worker rejects unsafe polling configuration', () => {
  assert.throws(() => readIndexerWorkerConfig({ INDEXER_POLL_INTERVAL_MS: '1000' }), /invalid_indexer_poll_interval/);
  assert.throws(() => readIndexerWorkerConfig({ INDEXER_BATCH_DELAY_MS: '10' }), /invalid_indexer_batch_delay/);
  assert.throws(() => readIndexerWorkerConfig({ INDEXER_MAX_BLOCKS: '1000' }), /invalid_max_blocks/);
});
