# DUR Testnet release handoff

## Purpose and boundary

This document separates repository work from operator-only deployment actions. DUR is an early-stage Testnet prototype, not a production financial service. Passing CI does not establish contract safety or production readiness. Do not use Mainnet, real funds, custody, or production escrow.

## Current automated baseline

The latest fully green run set before this documentation update was commit `735ac16d583f6e004b2970c4b0bb086766464dce`. All four workflows completed successfully:
- CI build, type checks and automated tests, including the owner-only attestation-history route and Mini App reputation view;
- container configuration and API/web image builds;
- Tolk contract build, formatting, lint and emulator tests;
- Go proof-verifier race tests, vet and build.

These checks validate repository consistency only. They do not replace mobile QA, live Testnet integration, or an independent security review.

## Work that must be complete before asking the operator for deployment secrets

- [ ] Complete API and UI integration for actual user journeys; the current Escrow screen is a preview and the Escrow API is not implemented.
- [ ] Resolve and test escrow payout failure/bounce behavior, value conservation, deadline boundaries, replay/malformed messages, and the arbiter-unavailable dispute-lock condition.
- [ ] Add reviewed contract address and historical code-hash identity policy before treating decoded events as trusted DUR events.
- [ ] Add end-to-end Testnet fixtures for transaction proofs, event decoding, checkpoint restart, duplicate batches, and provider disagreement.
- [ ] Finish deployment hardening: backup/restore procedure, production logging/monitoring, and mobile Telegram QA.
- [ ] Re-run all CI workflows on the final candidate commit and review dependency audit output.
- [ ] Prepare a deployment-specific checklist with exact values and a rollback procedure.

Do not mark a checkbox complete merely because a related module or draft document exists.

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
