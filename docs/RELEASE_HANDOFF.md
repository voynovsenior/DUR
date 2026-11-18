# DUR Testnet release handoff

## Purpose and boundary

This document separates repository work from operator-only deployment actions. DUR is an early-stage Testnet prototype, not a production financial service. Passing CI does not establish contract safety or production readiness. Do not use Mainnet, real funds, custody, or production escrow.

## Current automated baseline

The latest fully green release-candidate run set is commit `da026db6fe1df0706383fe3f80c9ca82eb415f4a` (2026-11-18). All four required workflows completed successfully on this exact HEAD:
- CI run `44268501892`: npm install, production dependency audit, full audit report, build and automated tests;
- Container Build run `44268501862`: Compose configuration validation and API/web image builds;
- TON Contracts run `44268501869`: Tolk build, formatting, wrapper generation, lint and contract tests;
- TON Proof Verifier run `44268501946`: Go tests, vet and build.

These checks validate repository consistency only. They do not replace mobile QA, live Testnet integration, or an independent security review. The escrow contract remains an experimental artifact: its payout bounce handler is empty, and the repository does not yet demonstrate safe recovery of a failed payout. It must not be deployed or used to hold funds. The UI correctly remains a non-interactive design preview.

## Finite Testnet MVP release gates

The initial deployable MVP contains only:
- Telegram authentication and server-side session handling;
- TON Testnet wallet linking through TON Connect and server-side proof verification;
- wallet-owner consent and revocation;
- issuer/schema administration and attestation issue/revoke/history;
- experimental reputation projection based only on eligible attestations;
- Telegram Mini App, API, and bot deployment template.

Explicitly excluded from this release:
- **Escrow:** design preview only. No contract deployment, funding, payout, custody, or real-value workflow.
- **Indexer worker:** not started in the MVP. Raw provider imports remain unverified and are not reputation evidence. The proof-verifier/indexer code remains research infrastructure.
- Mainnet, real assets, and production financial use.

## Gates before operator secret entry

- [x] Final candidate CI workflows all green on the same commit (`da026db`).
- [x] Production dependency audit passed in CI; the full development audit report is retained in CI logs.
- [x] Deployment template and `.env.example` validated by Docker Compose CI.
- [x] Secret handling rules documented; deployment rollback is performed by redeploying the previous known-good Git commit.
- [x] Default Compose startup contains only API and web; bot and indexer are opt-in profiles; Escrow is not deployed.
- [ ] Public HTTPS smoke test — necessarily runs after the operator supplies the domain and deploys the services.

## Gates after operator secret entry and deployment

- [ ] Public HTTPS smoke test passes against the deployed origin.
- [ ] HTTPS and health endpoint verified.
- [ ] Telegram login works inside Telegram on Android.
- [ ] TON Connect manifest loads from the deployed domain.
- [ ] Throwaway Testnet wallet connects and server-side ownership proof succeeds.
- [ ] Owner consent can be granted and revoked.
- [ ] Issuer can issue an attestation only with valid owner consent.
- [ ] Owner can view attestation history and reputation projection.
- [ ] SQLite backup and restore procedure is exercised.
- [ ] No escrow or indexer service is running.

This is the complete boundary of the first Testnet MVP. Do not add more features to this release. Any excluded subsystem requires a separate versioned scope and review.

## Operator inputs needed now

Repository-side release checks are green. The remaining step is deployment configuration, not another development sprint. Choose a public HTTPS domain and a host/provider capable of running Docker Compose with persistent storage. Replace the public TON Connect manifest placeholders before building the frontend. Enter Telegram bot tokens and the admin token only in the host's private secret settings. Then deploy API and web, run the HTTPS smoke test, start the bot profile, and perform Testnet wallet QA.

## Operator inputs needed later

These are not requested now. The operator should provide only non-secret configuration in chat if needed (for example, the public app domain or a public Testnet wallet address). Secret values must be entered directly into the hosting provider's secret/environment settings or a private server-side `.env` file.

| Variable | Purpose | Secret? | Where it belongs |
|---|---|---:|---|
| `APP_DOMAIN` | Public HTTPS host used by Caddy | No | Host environment |
| `MINI_APP_URL` | Telegram Mini App HTTPS URL | No | Bot runtime |
| `CORS_ORIGIN` | Exact frontend origin | No | API runtime |
| `TON_APP_DOMAIN` | Exact TON Connect dApp hostname | No | API runtime |
| `VITE_TONCONNECT_MANIFEST_URL` | Public manifest URL | No | Frontend build |
| `TELEGRAM_BOT_TOKEN` | Telegram login verification in API | **Yes** | API secret store |
| `BOT_TOKEN` | Telegram bot process | **Yes** | Bot secret store |
| `DUR_ADMIN_TOKEN` | Privileged issuer/schema/admin API | **Yes** | API secret store |
| `TONCENTER_API_KEY` | Optional Testnet provider quota credential | **Yes** | Indexer secret store |
| `TON_NETWORK_ID` | Must remain `-3` (Testnet) | No | API runtime |
| `COOKIE_SECURE` | Must be `true` on HTTPS | No | API runtime |
| `TRUSTED_PROXY_IPS` | Exact trusted reverse-proxy IPs only | No | API runtime |

A Testnet wallet is connected through TON Connect and the wallet's own approval screen. DUR must never request a seed phrase or private key. A public wallet address is not a credential.

## Secret handling rules

1. Never paste tokens, API keys, passwords, private keys, seed phrases, recovery codes, or wallet exports into ChatGPT, GitHub issues, commits, screenshots, or source files.
2. Do not prefix secrets with `VITE_`; Vite variables are public and can be embedded in browser assets.
3. For a self-hosted Compose deployment, create `.env` on the server, restrict it to the service operator (for example, file mode `600`), and keep it out of Git and Docker build contexts.
4. Prefer a hosting provider's encrypted secret store over a checked-in configuration file.
5. Use a throwaway Testnet wallet only. Never fund this prototype with real assets.
6. Rotate any credential that is accidentally exposed; deleting a message or commit does not reliably revoke a leaked credential.

## Final operator handoff

Only after the pre-secret checklist is complete should the operator be asked to:
1. choose the HTTPS domain and hosting target;
2. create/configure the Telegram bot and enter its token in the secret store;
3. set a fresh random `DUR_ADMIN_TOKEN` in the API secret store;
4. optionally configure a Testnet TON Center API key;
5. start the services and run the documented public smoke checks;
6. connect a throwaway Testnet wallet and complete the live QA script.

No contract deployment or transaction signing should be initiated automatically. Any wallet action must be explicitly reviewed and approved by the operator in their own wallet.
