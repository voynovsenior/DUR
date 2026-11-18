# Architecture

## Scope and maturity

DUR is a modular trust infrastructure prototype for the TON ecosystem. The repository contains a Telegram Mini App and bot, a backend API, persistent identity and issuer/attestation services, an experimental reputation projection, a Testnet indexer with a separate transaction-proof verifier, a TypeScript issuer SDK, and an experimental Tolk escrow contract.

The project is **prototype / early development**, not production-ready. Wallet linking supports only explicitly implemented wallet versions and still needs real-wallet Testnet QA. The indexer imports provider data as unverified; the proof verifier can establish transaction inclusion/account-history facts and extract v1 escrow lifecycle logs from proved transactions. Source-contract identity, historical code verification and semantic policy remain pending. The escrow contract is not deployed or independently audited. No real funds or Mainnet use are permitted.

## Components

1. **Telegram Mini App** — presentation and user interaction; treat it as an untrusted client.
2. **Telegram bot** — onboarding and notifications; credentials remain server-side.
3. **Identity Layer** — verifies signed Telegram initData, manages persistent SQLite sessions, and links supported TON wallets after server-side ton_proof verification.
4. **Application API** — exposes health/status, Telegram authentication, TON wallet linking, issuer/schema/consent APIs, attestation lifecycle and dispute endpoints, reputation profiles, and read-only indexer endpoints. Escrow API integration remains pending.
5. **Reputation Engine** — deterministic, versioned experimental projection over eligible attestations. It reports separate dimensions, evidence coverage and limitations; it is not a calibrated universal trust score.
6. **Attestation Registry** — issuer registration and API-key authentication, immutable JSON Schema versions, claim validation, issuance/expiry/revocation, wallet-owner consent, issuer trust-tier administration and dispute lifecycle.
7. **Escrow module** — independent experimental Tolk contract and lifecycle model. Reputation may consume verified completion evidence, but it must never control fund release or refund.
8. **Indexer / verifier** — TON Center Testnet ingestion, durable checkpoints and a continuous worker; a separate Go verifier checks transaction inclusion against a Testnet trust anchor. V1 escrow lifecycle-event emission and proof-based extraction are implemented; contract address/code-hash allowlisting, historical code identity and semantic event verification remain pending.
9. **Developer interfaces** — TypeScript issuer SDK, API documentation and OpenAPI contract. Broader profile/query SDK and integration examples remain pending.

## Trust boundaries

- Browser and Telegram WebView inputs are untrusted.
- Telegram initDataUnsafe is display context only; backend verification uses signed raw initData.
- Telegram login and persistent sessions are implemented, but are not an independently audited production identity service.
- A wallet address is not proof of ownership. The backend verifies TON Connect ton_proof before linking a supported wallet.
- A transaction inclusion proof establishes only the chain facts covered by the proof. It does not prove that a decoded application claim is true or that a participant performed quality work.
- TON Center API responses are provider data, not cryptographic proofs. Imported events remain unverified.
- Contract event decoders must be versioned and restricted to reviewed code hashes; unknown versions must be quarantined rather than guessed.
- Issuer trust tiers are administrative judgments. They require a documented policy and review process before production use.
- Reputation summarizes eligible issuer claims; it does not establish unique-human identity or guarantee truth.
- Escrow must remain independently usable. Reputation cannot move funds, and no real-value use is permitted before independent security review.

## Target data flow

~~~mermaid
flowchart TD
 U[Telegram user] --> UI[Mini App]
 UI --> API[Application API]
 UI --> TC[TON Connect]
 API --> ID[Identity verification]
 ID --> AUTH[Session and policy checks]
 AUTH --> REP[Reputation Engine]
 AUTH --> ATT[Attestation Registry]
 AUTH --> IDX[Indexer and verifier]
 IDX --> TON[TON Testnet]
 REP --> DB[(Application database)]
 ATT --> DB
 ESC[Independent escrow contract] <--> TON
 SDK[External apps / issuer SDK] --> API
~~~

## Deployment phases

- **Phase 0 — Local prototype:** frontend, bot and API development.
- **Phase 1 — Identity foundation:** authenticated API, persistent storage and supported Testnet wallet proof.
- **Phase 2 — Evidence layer:** issuer registry, immutable claim schemas, consent, attestations and dispute lifecycle.
- **Phase 3 — Trust projection:** explainable reputation methodology and issuer SDK.
- **Phase 4 — Chain verification:** Testnet ingestion and transaction proof verification; semantic contract-event decoding remains a release gate.
- **Phase 5 — Escrow research:** Tolk prototype, adversarial testing and independent review.
- **Phase 6 — Testnet validation:** HTTPS deployment, real-wallet QA, end-to-end integration and security review. Mainnet is a separate future decision, not an automatic next step.
