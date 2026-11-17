import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../identity/database';
import { ChainEventStore } from './event-store';
import { TonCenterIndexer } from './toncenter';

export async function runIndexerOnce() {
  const db = openDatabase();
  try {
    const store = new ChainEventStore(db);
    const adapter = new TonCenterIndexer();
    const maxBlocks = Number(process.env.INDEXER_MAX_BLOCKS ?? 1);
    const startSeqno = process.env.INDEXER_START_SEQNO === undefined
      ? undefined
      : Number(process.env.INDEXER_START_SEQNO);
    const result = await adapter.syncAvailable(store, startSeqno, maxBlocks);
    process.stdout.write(JSON.stringify({
      network: 'ton-testnet',
      processedBlocks: result.processed,
      latestIndexedBlock: result.latest.seqno,
      results: result.results,
    }) + '\n');
    return result;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runIndexerOnce().catch(error => {
    process.stderr.write(`DUR indexer failed: ${error instanceof Error ? error.message : 'unknown_error'}\n`);
    process.exitCode = 1;
  });
}
