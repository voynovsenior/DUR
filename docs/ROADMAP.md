# Roadmap

This roadmap tracks implementation, validation and release gates. A checked item means the capability exists in the repository; it does not imply production readiness, independent audit, or Mainnet approval.

## Stage 1 — Stabilization and application foundation

- [x] Dark Telegram Mini App prototype with Overview, Reputation, Attestations, Escrow and Settings views
- [x] Telegram bot starter implementation
- [x] Backend API, OpenAPI contract and automated tests
- [x] Telegram initData HMAC verification, login, persistent SQLite accounts and sessions
- [x] Session expiry, revocation and logout
- [x] Versioned SQLite migrations
- [x] CI workflows for application, contracts and proof verifier
- [ ] Confirm latest CI runs are green and keep dependency/security findings triaged
- [ ] Configure HTTPS deployment and TON Connect manifest
- [ ] Mobile QA inside Telegram
- [ ] Backup/restore, production logging and distributed rate limiting

## Stage 2 — Reputation and attestations

- [x] Persistent issuer registry with hashed API-key authentication and key revocation
- [x] Immutable, versioned JSON Schema registry and canonical claim validation
- [x] Attestation issuance, expiry, revocation and event history
- [x] Wallet-owner consent scoped to linked wallet, issuer and schema version
- [x] Administrative issuer suspension, terminal revocation and reason-audited trust-tier changes
- [x] Experimental Reputation methodology v0.2.0 with deterministic dimension projections and issuer-concentration diagnostics
- [x] Trust-tier and 180-day half-life recency weighting
- [x] Evidence eligibility, expiry/revocation filtering and issuer/schema deduplication
- [x] Explainable dimensions, coverage counts and public profile API
- [x] Issuer concentration index and largest-issuer-share diagnostics with explicit non-collusion caveats
- [x] Dispute opening and administrative resolution with append-only dispute events
- [x] Exclude open/upheld disputes from reputation eligibility; restore eligibility after rejected disputes only when all other checks pass
- [ ] Publish a formal issuer trust policy and independent review process
- [ ] Calibrate methodology against reviewed datasets; evaluate collusion, Sybil resistance and false positives
- [ ] Independent methodology review

## Stage 3 — TON Indexer and verifier

- [x] Durable idempotent chain-event store and checkpoint migrations
- [x] TON Center API v3 Testnet ingestion adapter; imported provider records remain unverified
- [x] Bounded one-shot sync and continuous worker with checkpoint resume and retry/backoff
- [x] Separate Go transaction proof verifier using a Testnet trust anchor and secure proof policy
- [x] Admin API integration that stores transaction-proof provenance
- [ ] Contract-specific event decoders with code-hash allowlists and versioned schemas
- [ ] Semantic verification policy: a proved transaction must not automatically become a verified DUR business event
- [ ] End-to-end fixtures for supported contract versions, reorg/provider disagreement and recovery
- [ ] Independent review of proof-verifier trust-anchor and operational assumptions

## Stage 4 — Escrow Protocol

- [x] Modular escrow lifecycle specification
- [x] Pure state-transition model and validation tests
- [x] Experimental Tolk contract prototype
- [x] Acton build, formatting/linting and 21 emulator tests, including deadline and bilateral dispute-vote cases
- [x] Draft escrow threat model and release-gate register
- [x] Bilateral dispute-resolution votes; conflicting votes remain disputed and the arbiter retains override authority
- [ ] Complete enforceable invariants and independent threat-model review
- [ ] Property-based conservation and terminal-state tests
- [ ] Adversarial tests for replay, malformed messages, timing boundaries, bounce and gas behavior
- [ ] Resolve arbiter-unavailable / indefinite-dispute-lock risk
- [ ] Explicit versioned contract event emission and decoder fixtures
- [ ] Testnet deployment and end-to-end integration; no real funds
- [ ] Independent contract security review before any Mainnet consideration

## Stage 5 — Developer ecosystem

- [x] TypeScript issuer SDK for attestation issue/read/revoke operations
- [x] API documentation and OpenAPI specification
- [x] Subject SDK for owner/public-consented reputation queries, disputes and profile-visibility consent management
- [x] Server-side issuer integration example and SDK onboarding guide
- [ ] Public developer documentation portal
- [x] Admin API and SDK for issuer lifecycle, trust-tier review and filtered dispute queue
- [ ] Operational dashboard and reviewer-facing web interface

## Stage 6 — Testnet validation and release readiness

- [ ] Configure and verify HTTPS frontend/API deployment
- [ ] Configure public TON Connect manifest and bot Mini App URL
- [ ] Real-wallet Testnet authentication and wallet-link QA
- [ ] End-to-end attestation → reputation profile flow
- [ ] End-to-end indexer → transaction proof → semantic event verification flow
- [ ] Escrow Testnet integration and adversarial QA
- [ ] Threat-model review, dependency audit triage and security test report
- [ ] Independent audit preparation and documented unresolved risks
- [ ] Mainnet readiness assessment only after all preceding gates pass

## Explicit exclusions for the current prototype

- No Mainnet deployment or real-value escrow.
- No claim that a wallet represents one unique human.
- No reputation score as the sole basis for financial, access or eligibility decisions.
- No treating provider-indexed transactions or transaction inclusion proofs as proof of subjective deal quality.
- No production-readiness or audit claim based only on passing CI or emulator tests.
