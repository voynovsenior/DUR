import test from 'node:test';
import assert from 'node:assert/strict';
import { TonCenterIndexer } from '../src/indexer/toncenter';

const rootHash = Buffer.alloc(32, 1).toString('base64');
const fileHash = Buffer.alloc(32, 2).toString('base64');
const txHash = Buffer.alloc(32, 3).toString('base64');
const codeHash = Buffer.alloc(32, 4).toString('base64');

function fakeFetch(url: string) {
  if (url.endsWith('/masterchainInfo')) {
    return new Response(JSON.stringify({ last: { seqno: 120, root_hash: rootHash, file_hash: fileHash } }));
  }
  if (url.includes('/blocks?')) {
    const seqno = Number(new URL(url).searchParams.get('seqno'));
    return new Response(JSON.stringify({ blocks: [{ seqno, root_hash: rootHash, file_hash: fileHash }] }));
  }
  if (url.includes('/transactionsByMasterchainBlock?')) {
    return new Response(JSON.stringify({
      transactions: [{
        account: '0:' + 'a'.repeat(64),
        lt: '12345',
        hash: txHash,
        mc_block_seqno: 120,
        now: 1_800_000_000,
        orig_status: 'active',
        end_status: 'active',
        total_fees: '100',
        account_state_after: { code_hash: codeHash },
        in_msg: { source: '0:' + 'b'.repeat(64), destination: '0:' + 'a'.repeat(64), value: '500' },
        out_msgs: [],
      }],
    }));
  }
  throw new Error('unexpected_url');
}

test('TON Center adapter reads Testnet masterchain transactions as unverified evidence', async () => {
  const requests: string[] = [];
  const adapter = new TonCenterIndexer({
    fetchImpl: async input => {
      const url = String(input);
      requests.push(url);
      return fakeFetch(url);
    },
  });
  const checkpoint = await adapter.getLatestCheckpoint();
  assert.equal(checkpoint.seqno, 120);
  assert.match(checkpoint.rootHash, /^[a-f0-9]{64}$/);
  assert.equal(requests.length, 1);
});

test('TON Center adapter ingests normalized transaction records and preserves unverified status', async () => {
  const { openDatabase } = await import('../src/identity/database');
  const { ChainEventStore } = await import('../src/indexer/event-store');
  const db = openDatabase(':memory:');
  const store = new ChainEventStore(db);
  const adapter = new TonCenterIndexer({
    fetchImpl: async input => fakeFetch(String(input)),
  });
  const result = await adapter.ingestMasterchainBlock(store, 120);
  assert.equal(result.inserted, 1);
  const [event] = store.listEvents({ network: 'ton-testnet' });
  assert.equal(event.eventType, 'ton.transaction');
  assert.equal(event.verificationStatus, 'unverified');
  assert.equal((event.payload as { masterchainSeqno: number }).masterchainSeqno, 120);
  db.close();
});

test('TON Center adapter rejects insecure endpoints and non-Testnet network settings', () => {
  assert.throws(() => new TonCenterIndexer({ baseUrl: 'http://localhost/api/v3' }), /indexer_https_required/);
  assert.throws(() => new TonCenterIndexer({ network: 'ton-mainnet' }), /unsupported_indexer_network/);
});
