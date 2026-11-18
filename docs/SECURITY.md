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

## Testnet proof-verifier boundary

The optional Go proof verifier uses a Testnet trust anchor and secure proof-check policy. It never enables Mainnet verification. A successful check establishes account-history membership for a transaction, not application semantics. The API persists a compact verification receipt rather than raw proof BOCs; operators should be able to re-run verification against the Testnet liteserver before relying on old receipts. The verifier must remain disabled if its binary is missing or its trust configuration cannot be loaded.

## Dependency audit status

The CI pipeline fails if the production dependency tree contains high-severity npm advisories. The current production audit reports zero vulnerabilities. The full development-tooling audit still reports the upstream `picomatch` ReDoS advisory (GHSA-fc5q-39xc-vjpf) through Vite's build dependency tree; the registry version available in this environment remains 4.0.7, which is within the advisory's affected range. This is a development/build-time dependency, not shipped in the Mini App runtime. Do not expose the Vite development server to untrusted networks. Re-run the full audit and remove this note once an upstream fixed release is available and adopted.

## Reverse-proxy rate-limit identity

Set `TRUSTED_PROXY_IPS` only to exact, controlled proxy IP addresses. The API ignores `X-Forwarded-For` from all other peers. The included Caddy template overwrites the forwarded header with the connected client address and runs at the fixed internal address `172.30.0.2`; the API allowlists only that address.
