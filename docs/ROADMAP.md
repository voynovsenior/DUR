# Roadmap

This roadmap is directional. Items are not complete until implemented, tested and documented.

## 0.1 — Interface prototype
- [x] Dark futuristic Mini App shell
- [x] Overview, Reputation, Attestations, Escrow and Settings views
- [x] TON Connect UI integration point
- [x] Basic Telegram bot commands
- [ ] Configure HTTPS deployment and TON Connect manifest
- [ ] Mobile QA inside Telegram

## 0.2 — Application foundation
- [x] Read-only backend API skeleton
- [x] Initial API tests and OpenAPI contract
- [x] Initial conceptual data model
- [x] Telegram init data HMAC verification helper and unit tests
- [x] Telegram login HTTP route
- [x] Persistent SQLite account and session store
- [x] Session expiry, revocation, and logout
- [x] TON Connect proof verification for explicitly supported fixed-key wallet versions (V1R1–V3R2, V4R2)
- [x] Persistent single-use wallet challenges bound to Telegram account and browser attempt
- [x] Atomic challenge consumption and network-qualified wallet linking
- [ ] Additional wallet versions (V4R1, V5, WalletTg) and independent verifier review
- [ ] End-to-end testing with real TON Connect wallets on Testnet
- [x] Versioned SQLite schema migrations (identity, wallet links and proof challenges)
- [ ] Backup and restore strategy
- [ ] Distributed rate limiting and operational logging
- [ ] Mobile end-to-end authentication QA

## 0.3 — Evidence and attestations
- [x] Canonical claim validation and schema-version metadata helper
- [x] Persistent issuer registry and hashed API-key authentication
- [x] Attestation issuance, expiry, revocation and event history
- [x] Issuer API key revocation
- [x] Registered immutable JSON Schema versions and claim validation
- [x] Wallet-owner consent grants scoped to linked wallet, issuer and schema version
- [x] Consent listing and revocation
- [x] Administrative issuer suspension and terminal revocation
- [x] Admin trust-tier control with reason-audited history
- [ ] Formal issuer trust policy and independent review
- [ ] Dispute and correction workflow
- [x] Durable idempotent chain-event store and checkpoint migrations
- [x] Manual TON Center API v3 Testnet ingestion adapter (records unverified provider data)
- [ ] Cryptographic block/transaction proof verification
- [ ] Contract-specific event decoders and verified event policy
- [ ] Automated continuous indexer operation and recovery

## 0.4 — Reputation
- [x] Versioned experimental reputation methodology v0.1.0
- [x] Deterministic reputation calculation with trust-tier and recency weights
- [x] Evidence eligibility, expiry/revocation filtering and issuer/schema deduplication
- [x] Explainable dimensions, coverage counts and public profile API
- [ ] Calibration against reviewed datasets and independent methodology review
- [ ] Dispute and correction workflow
- [ ] Anti-abuse evaluation and false-positive review

## 0.5 — Escrow Testnet research
- [x] Escrow lifecycle specification and pure state-transition model with validation tests
- [ ] Threat model and invariants
- [ ] Tolk contract implementation
- [ ] Unit, integration and adversarial tests
- [ ] Independent security review before mainnet consideration

## Later
- [x] TypeScript issuer SDK for attestation issue/read/revoke operations
- [ ] Broader public profile/query SDK and integration examples
- [ ] Developer documentation portal
- [ ] Mainnet readiness assessment
- [ ] Consider multi-chain adapters only after TON implementation is stable
