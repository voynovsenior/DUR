# TON Indexer and Verifier — Architecture Draft

Status: manual and continuous Testnet ingestion, durable event storage, and a separate secure transaction proof verifier are implemented. TON Center API v3 imports remain `unverified` until the admin verification endpoint checks the transaction against a trusted Testnet masterchain/account history. Transaction verification does not yet decode or validate DUR contract event semantics.

## 1. Current implementation

- `backend/src/indexer/toncenter.ts` reads `masterchainInfo`, resolves a masterchain block, and fetches its transactions through TON Center API v3.
- `backend/src/indexer/event-store.ts` stores normalized transaction records idempotently and advances a durable checkpoint in the same SQLite transaction.
- `npm run indexer:sync` performs a bounded one-shot sync. Configure `TONCENTER_API_URL`, optional `TONCENTER_API_KEY`, `INDEXER_START_SEQNO` for the first run, and `INDEXER_MAX_BLOCKS`.
- `npm run indexer:worker` continuously polls the Testnet masterchain, resumes from the durable checkpoint after restarts, processes bounded batches, waits between batches, and backs off after provider errors. Configure `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH_DELAY_MS`, and `INDEXER_MAX_BLOCKS`. It stops cleanly on SIGINT/SIGTERM.
- The adapter is Testnet-only. It deliberately marks every imported transaction `unverified`, because the indexed HTTP response is not itself a cryptographic proof. No reputation calculation consumes these rows.
- `proof-verifier/` is a Go CLI built on `tonutils-go` with `ProofCheckPolicySecure`, a Testnet global-config trust anchor, masterchain proof-chain checks, account-state proof checks, and transaction hash-chain verification from the proved account state.
- `POST /v1/admin/indexer/events/{id}/verify-transaction` runs the verifier for a stored event. Configure `DUR_PROOF_VERIFIER_BIN` to the built binary. The endpoint stores proof provenance but deliberately leaves `verificationStatus` as `unverified`.
- The verifier is Testnet-only. It verifies that a transaction belongs to the authenticated account history; it does not prove that a decoded application-level claim is correct. The database stores a compact verification receipt (trusted masterchain root, sequence number, verifier version and timestamp), not the raw proof BOCs; verification can be independently re-run against the liteserver.

## 2. Trust model

RPC responses and indexer inputs are untrusted until independently checked. The indexer may normalize chain facts; it must not invent business outcomes or infer subjective quality.

## 3. Target ingestion pipeline

1. Read blocks and transactions from a configured TON network endpoint.
2. Track masterchain checkpoints and the relevant shard/block context.
3. Fetch transaction data and message bodies for configured contracts and event types.
4. Verify the masterchain proof chain from the trusted Testnet configuration.
5. Verify the account state and transaction hash chain against the proved account state.
6. Decode only known contract versions and event schemas; this is still pending.
7. Normalize the event into a versioned DUR evidence record.
8. Insert using a deterministic idempotency key.
9. Advance the durable checkpoint only after all events in the batch are committed.

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

## 8. Secure transaction verification

Build the verifier from `proof-verifier/` with Go 1.26:

```bash
cd proof-verifier
go mod tidy
go test ./...
go build -trimpath -o ../bin/dur-proof-verifier .
```

The admin API invokes this binary for one indexed event at a time. Input is restricted to Testnet. A successful result records the transaction hash, account, logical time, trusted masterchain sequence number/root hash, proof policy and verifier version. This is **transaction verification only**; the event remains semantically unverified until a contract-specific decoder and policy review pass.

The design follows TON's distinction between indexed HTTP APIs and proof-aware liteserver/ADNL access. See [TON SDK and transport comparison](https://docs.ton.org/applications/sdks), [TON API v2 get transactions](https://docs.ton.org/api/v2/rpc/get-transactions), and [tonutils-go proof implementation](https://github.com/xssnick/tonutils-go).
