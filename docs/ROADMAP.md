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
- [ ] TON Connect proof verification
- [ ] Persistent single-use wallet challenge store
- [ ] Database migrations and backup strategy
- [ ] Distributed rate limiting and operational logging
- [ ] Mobile end-to-end authentication QA

## 0.3 — Evidence and attestations
- [ ] Attestation schema and versioning
- [ ] Issuer registry and policies
- [ ] Revocation and expiry
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
