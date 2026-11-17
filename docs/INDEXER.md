# TON Indexer and Verifier — Architecture Draft

Status: initial manual Testnet ingestion adapter and durable event store are implemented. This is not yet a canonical proof-verifying indexer; TON Center API v3 responses are stored as `unverified`.

## 1. Current implementation

- `backend/src/indexer/toncenter.ts` reads `masterchainInfo`, resolves a masterchain block, and fetches its transactions through TON Center API v3.
- `backend/src/indexer/event-store.ts` stores normalized transaction records idempotently and advances a durable checkpoint in the same SQLite transaction.
- `npm run indexer:sync` performs a bounded one-shot sync. Configure `TONCENTER_API_URL`, optional `TONCENTER_API_KEY`, `INDEXER_START_SEQNO` for the first run, and `INDEXER_MAX_BLOCKS`.
- The adapter is Testnet-only. It deliberately marks every imported transaction `unverified`, because the indexed HTTP response is not itself a cryptographic proof. No reputation calculation consumes these rows.
- The current adapter records raw transaction/message metadata, not DUR escrow or attestation contract events. Contract-specific decoders and proof verification remain required.

## 2. Trust model

RPC responses and indexer inputs are untrusted until independently checked. The indexer may normalize chain facts; it must not invent business outcomes or infer subjective quality.

## 3. Target ingestion pipeline

1. Read blocks and transactions from a configured TON network endpoint.
2. Track masterchain checkpoints and the relevant shard/block context.
3. Fetch transaction data and message bodies for configured contracts and event types.
4. Verify transaction inclusion and canonicality using trusted chain data/proofs or an explicitly reviewed provider trust model.
5. Decode only known contract versions and event schemas.
6. Normalize the event into a versioned DUR evidence record.
7. Insert using a deterministic idempotency key.
8. Advance the durable checkpoint only after all events in the batch are committed.

## 4. Evidence event identity

A chain event identity should include network, account/contract address, transaction logical time, transaction hash, message direction and event index where applicable. The exact key depends on the decoded source event and must be stable across reprocessing.

Store provenance fields such as:
- network/global ID;
- masterchain and shard checkpoint;
- account and transaction identifiers;
- message hash and direction;
- contract code hash/version;
- decoder version;
- observed time and verification status.

## 5. Failure handling

- Reprocessing must be idempotent.
- Incomplete batches must not advance checkpoints.
- Unknown contract code hashes must be quarantined, not guessed.
- Decoder errors must be observable and must not silently drop events.
- Provider disagreement or missing archival data must halt or downgrade verification status.
- Corrections must append a status event rather than rewriting evidence history without trace.

## 6. Required tests

Use deterministic fixtures for supported contract versions, duplicate batches, missing messages, malformed payloads, unsupported code hashes, checkpoint restart and provider inconsistency. Compare decoded values against known on-chain fixtures.

## 7. Reputation boundary

Only events that pass the configured verification policy may become eligible reputation evidence. A transaction proves only the chain facts it actually encodes; it does not prove subjective work quality or user identity.
