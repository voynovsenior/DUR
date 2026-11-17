# Architecture

## Scope
DUR is planned as a modular application and protocol layer for TON. This repository currently contains a frontend prototype, a minimal Telegram bot, a backend API foundation with Telegram init-data verification and persistent SQLite sessions, and project documentation. The limited TON wallet proof verifier and wallet-link routes are implemented in code; real-wallet Testnet QA and deployment remain pending. The issuer-authenticated attestation registry, immutable JSON Schema validation and wallet-owner consent lifecycle are implemented as a foundation. A manual TON Center Testnet ingestion adapter and durable event store are available, but imported records remain unverified. Canonical proof verification, reputation engine and escrow contracts remain unimplemented.

## Components
1. **Telegram Mini App** — presentation and user interaction; treat it as an untrusted client.
2. **Telegram bot** — onboarding and notifications; credentials remain server-side.
3. **Identity Layer** — verifies Telegram init data, manages persistent sessions, and links supported TON wallets after server-side `ton_proof` verification.
4. **Application API** — exposes health/status, Telegram authentication, TON wallet linking, issuer/schema/consent APIs, attestation lifecycle endpoints and read-only indexer endpoints; reputation profiles and escrow operations remain unavailable.
5. **Reputation Engine** — planned deterministic computation over eligible evidence.
6. **Attestation Registry** — issuer registration, API-key authentication, claim issuance, expiry, revocation and event history are implemented as a foundation; immutable JSON Schema validation and wallet-owner consent are implemented; issuer trust policy and disputes remain planned.
7. **Escrow module** — planned independent contract and application module.
8. **Indexer / verifier** — manual TON Center Testnet ingestion with durable checkpoints is implemented; cryptographic proof verification and contract-specific decoding remain planned.
9. **TON contracts** — planned on-chain state and events; Testnet first.

## Trust boundaries
- Browser and Telegram WebView inputs are untrusted.
- Telegram `initDataUnsafe` is display context only; backend verification uses signed raw `initData`.
- Telegram init-data verification, login, and persistent session routes are implemented; they are not an independently audited production identity service.
- A wallet address is not proof of ownership. The backend must verify TON Connect `ton_proof` before linking a wallet.
- An indexer may derive facts from canonical chain data but must not invent events.
- Off-chain claims require issuer policies and evidence. A transaction cannot prove subjective work quality.

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
 ESC[Escrow module] <--> TON
 SDK[External apps / SDK] --> API
~~~

## Deployment phases
- Phase 0: local prototype and static hosting.
- Phase 1: authenticated API, persistent storage and testnet wallet proof.
- Phase 2: attestation lifecycle, immutable claim schemas and wallet-owner consent; initial provider-backed Testnet ingestion.
- Phase 3: transparent reputation methodology and SDK.
- Phase 4: escrow contracts, formal testing and independent security review before mainnet consideration.
