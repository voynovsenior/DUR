import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../identity/database';
import { ChainEventStore } from './event-store';
import { TonCenterIndexer } from './toncenter';

export type IndexerWorkerConfig = {
  pollIntervalMs: number;
  batchDelayMs: number;
  maxBlocks: number;
};

export function readIndexerWorkerConfig(env: NodeJS.ProcessEnv = process.env): IndexerWorkerConfig {
  const poll = Number(env.INDEXER_POLL_INTERVAL_MS ?? 15_000);
  const delay = Number(env.INDEXER_BATCH_DELAY_MS ?? 1_000);
  const maxBlocks = Number(env.INDEXER_MAX_BLOCKS ?? 10);
  if (!Number.isSafeInteger(poll) || poll < 5_000 || poll > 300_000) {
    throw new Error('invalid_indexer_poll_interval');
  }
  if (!Number.isSafeInteger(delay) || delay < 250 || delay > 30_000) {
    throw new Error('invalid_indexer_batch_delay');
  }
  if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100) {
    throw new Error('invalid_max_blocks');
  }
  return { pollIntervalMs: poll, batchDelayMs: delay, maxBlocks };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function runIndexerWorker() {
  const config = readIndexerWorkerConfig();
  const db = openDatabase();
  const store = new ChainEventStore(db);
  const adapter = new TonCenterIndexer();
  const configuredStart = process.env.INDEXER_START_SEQNO?.trim();
  const startSeqno = configuredStart ? Number(configuredStart) : undefined;
  let stopping = false;

  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  try {
    while (!stopping) {
      try {
        const result = await adapter.syncAvailable(store, startSeqno, config.maxBlocks);
        if (result.processed > 0) {
          process.stdout.write(JSON.stringify({
            network: 'ton-testnet',
            processedBlocks: result.processed,
            latestAvailableBlock: result.latest.seqno,
            results: result.results,
          }) + '\n');
          await sleep(config.batchDelayMs);
        } else {
          await sleep(config.pollIntervalMs);
        }
      } catch (error) {
        process.stderr.write(`DUR indexer worker retry: ${error instanceof Error ? error.message : 'unknown_error'}\n`);
        await sleep(Math.min(config.pollIntervalMs * 2, 300_000));
      }
    }
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIndexerWorker().catch(error => {
    process.stderr.write(`DUR indexer worker stopped: ${error instanceof Error ? error.message : 'unknown_error'}\n`);
    process.exitCode = 1;
  });
}
