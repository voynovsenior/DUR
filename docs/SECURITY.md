# Security model

This document describes design requirements; it is not an audit report. The current prototype is not suitable for custody, payments or production escrow.

## Assets
- Telegram bot token and backend credentials;
- wallet ownership and signature-verification flows;
- profile and attestation integrity;
- reputation calculation inputs and outputs;
- future contract state and escrowed assets.

## Threats and required controls
| Threat | Required control |
|---|---|
| Forged Telegram identity | Validate raw Telegram Web App init data server-side using HMAC-SHA-256 and enforce freshness |
| Wallet address spoofing | Verify TON Connect proof server-side; never trust a client-supplied address |
| Duplicate or replayed event | Canonical transaction parsing, event identity, idempotency and replay checks |
| Fake transaction hash | Resolve and verify against canonical TON data |
| Sybil accounts | Multi-signal risk controls; never equate one wallet with one human |
| Collusive reviews | Counterparty concentration and graph analysis with review |
| Malicious issuer | Issuer registration, API-key revocation, administrative suspension and evidence policy |
| Disputed deal | Explicit dispute state; suspend positive reputation effects pending resolution |
| Secret leakage | Environment variables or secret manager; no credentials in Git |
| Contract exploit | Tests, static analysis, threat modeling and independent audit before mainnet |

## Identity implementation status
- Telegram init-data HMAC verification is connected to a login route; accounts and sessions are stored in SQLite. This is not an audited production authentication service.
- TON Connect proof verification and wallet linking are implemented for a limited set of standard fixed-key wallet versions; CI and real-wallet Testnet QA remain pending.
- Issuer-authenticated attestation writes require a registered schema and an active wallet-owner consent grant. Consent creation/revocation is bound to the authenticated account and a linked Testnet wallet. Public reputation profiles and escrow operations remain unavailable.
- Never trust `initDataUnsafe`, a client-supplied wallet address, or a client-supplied public key as proof of identity.

## Safe development rules
- Use TON Testnet for experiments.
- Never request or store seed phrases or private keys.
- Do not treat frontend checks as security controls.
- Do not claim an event is verified unless its source and verification procedure are recorded. TON Center API v3 imports are explicitly marked unverified.
- Do not deploy real-value escrow without complete review and independent audit.
