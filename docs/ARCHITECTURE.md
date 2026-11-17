# Architecture

## Scope
DUR is planned as a modular application and protocol layer for TON. This repository currently contains a frontend prototype and a minimal Telegram bot. Backend, indexer, reputation engine, attestation registry and contracts remain future work.

## Components
1. **Telegram Mini App** — presentation and user interaction; treat it as an untrusted client.
2. **Telegram bot** — onboarding and notifications; credentials remain server-side.
3. **Application API** — planned authenticated profile and integration endpoints.
4. **Reputation Engine** — planned deterministic computation over eligible evidence.
5. **Attestation Registry** — planned issuer and attestation lifecycle management.
6. **Escrow module** — planned independent contract and application module.
7. **Indexer / verifier** — planned ingestion of canonical TON data and event provenance checks.
8. **TON contracts** — planned on-chain state and events; Testnet first.

## Trust boundaries
- Browser and Telegram WebView inputs are untrusted.
- Telegram initDataUnsafe is display context only; backend authentication must validate signed raw initData.
- A wallet address is not proof of ownership. A future backend must verify TON Connect proof data.
- An indexer may derive facts from canonical chain data but must not invent events.
- Off-chain claims require issuer policies and evidence. A transaction cannot prove subjective work quality.

## Target data flow
~~~mermaid
flowchart TD
 U[Telegram user] --> UI[Mini App]
 UI --> API[Application API]
 UI --> TC[TON Connect]
 API --> AUTH[Auth and policy checks]
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
- Phase 2: event indexer and attestation lifecycle.
- Phase 3: transparent reputation methodology and SDK.
- Phase 4: escrow contracts, formal testing and independent security review before mainnet consideration.
