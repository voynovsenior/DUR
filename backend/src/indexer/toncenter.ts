import type { ChainEventStore, NormalizedChainEvent, TonBlockCheckpoint } from './event-store';

type MasterchainBlock = {
  seqno: number;
  root_hash: string;
  file_hash: string;
};

type MasterchainInfo = { last: MasterchainBlock };

type TonCenterTransaction = {
  account?: string;
  lt?: string;
  hash?: string;
  mc_block_seqno?: number;
  now?: number;
  orig_status?: string;
  end_status?: string;
  total_fees?: string;
  description?: { aborted?: boolean };
  in_msg?: {
    hash?: string;
    source?: string;
    destination?: string;
    value?: string;
    opcode?: number;
    message_content?: { body?: string; hash?: string };
  } | null;
  out_msgs?: Array<{
    hash?: string;
    source?: string;
    destination?: string;
    value?: string;
    opcode?: number;
    message_content?: { body?: string; hash?: string };
  }>;
  account_state_after?: { code_hash?: string };
};

type TransactionsResponse = { transactions?: TonCenterTransaction[] };

export type TonCenterIndexerOptions = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  network?: string;
  pageSize?: number;
};

function normalizeHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^[a-fA-F0-9]{64}$/.test(value)) return value.toLowerCase();
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bytes = Buffer.from(normalized, 'base64');
    if (bytes.length === 32) return bytes.toString('hex');
  } catch {
    return undefined;
  }
  return undefined;
}

function requiredHash(value: string | undefined, field: string) {
  const result = normalizeHash(value);
  if (!result) throw new Error(`invalid_provider_${field}`);
  return result;
}

function blockCheckpoint(block: MasterchainBlock, network: string): TonBlockCheckpoint {
  if (!Number.isSafeInteger(block.seqno) || block.seqno < 0) throw new Error('invalid_provider_seqno');
  return {
    network,
    seqno: block.seqno,
    rootHash: requiredHash(block.root_hash, 'root_hash'),
    fileHash: requiredHash(block.file_hash, 'file_hash'),
  };
}

export class TonCenterIndexer {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly network: string;
  private readonly pageSize: number;

  constructor(options: TonCenterIndexerOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.TONCENTER_API_URL ?? 'https://testnet.toncenter.com/api/v3').replace(/\/+$/, '');
    if (!this.baseUrl.startsWith('https://')) throw new Error('indexer_https_required');
    this.apiKey = options.apiKey ?? process.env.TONCENTER_API_KEY ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.network = options.network ?? 'ton-testnet';
    if (this.network !== 'ton-testnet') throw new Error('unsupported_indexer_network');
    this.pageSize = Math.max(1, Math.min(1000, Math.trunc(options.pageSize ?? 500)));
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        accept: 'application/json',
        ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`toncenter_http_${response.status}`);
    return await response.json() as T;
  }

  async getLatestCheckpoint(): Promise<TonBlockCheckpoint> {
    const info = await this.get<MasterchainInfo>('/masterchainInfo');
    if (!info?.last) throw new Error('invalid_masterchain_info');
    return blockCheckpoint(info.last, this.network);
  }

  async ingestMasterchainBlock(store: ChainEventStore, seqno: number) {
    if (!Number.isSafeInteger(seqno) || seqno < 0) throw new Error('invalid_masterchain_seqno');

    const info = await this.get<MasterchainInfo>('/masterchainInfo');
    if (!info?.last || seqno > info.last.seqno) throw new Error('masterchain_block_not_indexed');
    const [checkpoint] = await Promise.all([
      this.getBlockCheckpoint(seqno),
    ]);

    const transactions: TonCenterTransaction[] = [];
    let offset = 0;
    while (true) {
      const page = await this.get<TransactionsResponse>(
        `/transactionsByMasterchainBlock?seqno=${seqno}&limit=${this.pageSize}&offset=${offset}&sort=asc`,
      );
      const items = page.transactions;
      if (!Array.isArray(items)) throw new Error('invalid_transactions_response');
      transactions.push(...items);
      if (items.length < this.pageSize) break;
      offset += items.length;
      if (offset > 100_000) throw new Error('masterchain_block_transaction_limit');
    }

    const events: NormalizedChainEvent[] = transactions.map(tx => {
      if (!tx.account || !tx.lt || !tx.hash) throw new Error('malformed_provider_transaction');
      const outMessages = Array.isArray(tx.out_msgs) ? tx.out_msgs : [];
      return {
        network: this.network,
        account: tx.account,
        lt: tx.lt,
        txHash: requiredHash(tx.hash, 'transaction_hash'),
        eventIndex: 0,
        eventType: 'ton.transaction',
        payload: {
          masterchainSeqno: seqno,
          timestamp: tx.now ?? null,
          originalStatus: tx.orig_status ?? null,
          endStatus: tx.end_status ?? null,
          aborted: tx.description?.aborted ?? null,
          totalFees: tx.total_fees ?? null,
          incomingMessage: tx.in_msg ? {
            hash: tx.in_msg.hash ?? null,
            source: tx.in_msg.source ?? null,
            destination: tx.in_msg.destination ?? null,
            value: tx.in_msg.value ?? null,
            opcode: tx.in_msg.opcode ?? null,
            bodyHash: tx.in_msg.message_content?.hash ?? null,
          } : null,
          outgoingMessages: outMessages.map(message => ({
            hash: message.hash ?? null,
            source: message.source ?? null,
            destination: message.destination ?? null,
            value: message.value ?? null,
            opcode: message.opcode ?? null,
            bodyHash: message.message_content?.hash ?? null,
          })),
        },
        sourceContract: tx.account,
        sourceCodeHash: normalizeHash(tx.account_state_after?.code_hash),
        decoderVersion: 'toncenter-v3-raw-tx-v1',
        // TON Center API v3 is an indexed HTTP data source; its response is not a cryptographic proof.
        verificationStatus: 'unverified',
      };
    });

    return store.ingest({ checkpoint, events });
  }

  private async getBlockCheckpoint(seqno: number): Promise<TonBlockCheckpoint> {
    const block = await this.get<{ blocks?: Array<{
      seqno: number;
      root_hash: string;
      file_hash: string;
    }> }>(`/blocks?workchain=-1&shard=8000000000000000&seqno=${seqno}&limit=1`);
    const item = block.blocks?.[0];
    if (!item || item.seqno !== seqno) throw new Error('masterchain_block_not_found');
    return blockCheckpoint(item, this.network);
  }

  async syncAvailable(store: ChainEventStore, startSeqno?: number, maxBlocks = 1) {
    if (!Number.isSafeInteger(maxBlocks) || maxBlocks < 1 || maxBlocks > 100) {
      throw new Error('invalid_max_blocks');
    }
    const latest = await this.getLatestCheckpoint();
    const current = store.getCheckpoint(this.network);
    const envStart = process.env.INDEXER_START_SEQNO?.trim();
    const configuredStart = startSeqno ?? (envStart ? Number(envStart) : undefined);
    const next = current ? current.seqno + 1 : configuredStart;
    if (!Number.isSafeInteger(next) || next < 0) throw new Error('indexer_start_seqno_required');
    const results = [];
    for (let seqno = next; seqno <= latest.seqno && results.length < maxBlocks; seqno++) {
      results.push(await this.ingestMasterchainBlock(store, seqno));
    }
    return { latest, processed: results.length, results };
  }
}
