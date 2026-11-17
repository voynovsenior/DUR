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
- [ ] Registered JSON Schema validation and subject-consent workflow
- [ ] Issuer trust-tier policy and administrative suspension workflow
- [ ] Canonical TON event verification
- [ ] Duplicate and replay protection

## 0.4 — Reputation
- [ ] Public methodology document
- [ ] Evidence eligibility rules
- [ ] Explainable dimensions and aggregation
- [ ] Dispute and correction workflow
- [ ] Anti-abuse evaluation and false-positive review

## 0.5 — Escrow Testnet research
- [ ] State-machine specification
- [ ] Threat model and invariants
- [ ] Tolk contract implementation
- [ ] Unit, integration and adversarial tests
- [ ] Independent security review before mainnet consideration

## Later
- [ ] Developer SDK and integration examples
- [ ] Developer documentation portal
- [ ] Mainnet readiness assessment
- [ ] Consider multi-chain adapters only after TON implementation is stable
