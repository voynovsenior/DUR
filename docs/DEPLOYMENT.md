# Deployment guide

Before requesting operator credentials, follow the [Testnet release handoff](RELEASE_HANDOFF.md). It records the remaining engineering gates and the later operator-only configuration step.

## Current status
The Testnet MVP release scope is deliberately finite: Telegram authentication, Testnet wallet ownership linking, owner consent, issuer-managed attestations, and the experimental reputation projection. Escrow is excluded and remains a non-functional design preview. The indexer is optional research telemetry: its imports remain unverified and are never reputation evidence. Do not deploy escrow contracts or start the indexer worker as part of the MVP.

## Frontend hosting
1. Connect this repository to a static hosting provider that supports Vite.
2. Set the build command to npm run build.
3. Set the output directory to dist.
4. Configure `VITE_TONCONNECT_MANIFEST_URL` with the full HTTPS manifest URL.
5. Set `VITE_API_BASE_URL` to the API origin or leave it empty when the API is reverse-proxied under the app origin.
6. Deploy and verify that the app and /tonconnect-manifest.json load publicly.

## Telegram Mini App
1. Configure the bot in BotFather.
2. Set the Mini App URL to the deployed HTTPS origin.
3. Test the Mini App inside Telegram on Android and iOS.
4. Confirm safe-area layout, navigation, wallet connect and return-to-app behavior.

## TON Connect
Replace the placeholder values in public/tonconnect-manifest.json with the production HTTPS origin and a publicly accessible icon. The manifest must be served over HTTPS.

## API hosting
Run npm run api on a Node.js host with a persistent disk for SQLite. Configure private server environment variables:
- TELEGRAM_BOT_TOKEN
- DUR_DATABASE_PATH (optional; defaults to ./data/dur.sqlite)
- COOKIE_SECURE=true
- CORS_ORIGIN (exact HTTPS frontend origin)
- TON_APP_DOMAIN (exact public dApp hostname, e.g. app.example.com)
- TON_NETWORK_ID=-3 (Testnet)
- DUR_ADMIN_TOKEN (server-only issuer/schema administration credential)
TON Center credentials and indexer checkpoint variables are not required for the MVP; the indexer is excluded from the initial deployment.

Keep the database directory out of static hosting. Back up the SQLite database securely. The API supports Telegram login, Testnet-first TON Proof wallet linking, wallet-owner consent, issuer/schema administration and a manual unverified Testnet indexer adapter. The API and Mini App should share a site so SameSite=Strict cookies work; if separate subdomains are used, verify the cookie and CORS configuration before deployment.

## Bot hosting
Run npm run bot on a Node.js host with private environment variables:
- BOT_TOKEN
- MINI_APP_URL

Never place BOT_TOKEN or TELEGRAM_BOT_TOKEN in VITE_ variables: those are bundled into client-side assets. Do not commit secrets.

## Telegram Serverless
Telegram Serverless access is not assumed. If access becomes available, evaluate it as an optional bot runtime. Keep the bot logic portable and keep protocol backend responsibilities separate.

## Pre-release checklist
- [ ] HTTPS enabled
- [ ] Manifest values replaced
- [ ] Telegram bot token and `DUR_ADMIN_TOKEN` stored as server-only credentials
- [ ] Telegram init data validated server-side before privileged operations
- [ ] Wallet proof verified server-side before associating ownership
- [ ] No real escrow or custody enabled
- [ ] Consent grants and issuer API keys reviewed before enabling external issuers
- [ ] Indexer imports remain marked unverified until independent proof verification is implemented
- [ ] Build and mobile smoke tests pass

## Build-tooling network boundary

The production dependency audit is enforced in CI. The current full development audit still reports a Vite build-chain `picomatch` advisory without an available upstream patched release. Keep the Vite development server local-only; production deployments must serve the built static assets and must not run the Vite dev server.

## Docker + Caddy Testnet deployment template

The repository includes a containerized Testnet deployment template. It is not a Mainnet release configuration and does not deploy contracts. The root `.dockerignore` excludes local environment files, wallet material, databases and generated output from Docker build contexts; keep the server-side `.env` on the host only.

1. Provision a Linux host with Docker Engine and the Docker Compose plugin. Point the chosen domain's DNS A/AAAA records to that host and allow inbound TCP 80/443.
2. Copy `.env.example` to `.env`. Set `APP_DOMAIN`, `MINI_APP_URL`, `CORS_ORIGIN`, `TON_APP_DOMAIN`, and `VITE_TONCONNECT_MANIFEST_URL` to the same HTTPS domain. Keep `VITE_API_BASE_URL` empty so the Mini App uses same-origin `/v1` requests through Caddy.
3. Set `TELEGRAM_BOT_TOKEN` and `BOT_TOKEN` as server-side environment variables. Set a strong random `DUR_ADMIN_TOKEN`. Do not commit `.env`, bot tokens, admin tokens, wallet keys or seed phrases.
4. Keep `COOKIE_SECURE=true`. The Compose network gives Caddy a fixed internal IP and the API trusts forwarded client IPs only from that allowlisted proxy. Do not broaden `TRUSTED_PROXY_IPS` to arbitrary networks.
5. Build and start the API and HTTPS web frontend:

```bash
docker compose up -d --build api web
docker compose logs -f api web
```

6. Do **not** start the optional indexer worker in the MVP deployment. It imports unverified chain observations and is not required by the attestation/reputation user journey. Do not deploy or activate the experimental escrow contract.

7. Start the Telegram bot only after setting its token and Mini App URL:

```bash
docker compose --profile telegram up -d bot
```

After the services are healthy, run the public smoke checks with `DUR_SMOKE_BASE_URL=https://YOUR-MINI-APP-DOMAIN npm run smoke:test`. Caddy obtains and renews HTTPS certificates automatically when DNS and ports are configured correctly. Complete the Telegram mobile QA checklist and wallet-linking journey before inviting any external testers.

**Deployment boundary:** this template is for controlled Testnet QA only. Escrow is excluded, the indexer is not started, and no real funds or Mainnet use are permitted.
