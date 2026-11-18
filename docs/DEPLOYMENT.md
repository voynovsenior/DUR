# Deployment guide

## Current status
The repository is a prototype. Deployment makes the preview accessible; it does not activate production reputation scoring, cryptographically verified indexing or escrow contracts. Issuer writes require admin-created issuers, registered schemas and wallet-owner consent.

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
- TONCENTER_API_URL (optional; defaults to TON Center Testnet API v3)
- TONCENTER_API_KEY (optional provider key)
- INDEXER_START_SEQNO (required for first manual sync)
- INDEXER_MAX_BLOCKS (bounded manual sync size; defaults to 1)

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

The repository includes a containerized Testnet deployment template. It is not a Mainnet release configuration and does not deploy contracts.

1. Provision a Linux host with Docker Engine and the Docker Compose plugin. Point the chosen domain's DNS A/AAAA records to that host and allow inbound TCP 80/443.
2. Copy `.env.example` to `.env`. Set `APP_DOMAIN`, `MINI_APP_URL`, `CORS_ORIGIN`, `TON_APP_DOMAIN`, and `VITE_TONCONNECT_MANIFEST_URL` to the same HTTPS domain. Keep `VITE_API_BASE_URL` empty so the Mini App uses same-origin `/v1` requests through Caddy.
3. Set `TELEGRAM_BOT_TOKEN` and `BOT_TOKEN` as server-side environment variables. Set a strong random `DUR_ADMIN_TOKEN`. Do not commit `.env`, bot tokens, admin tokens, wallet keys or seed phrases.
4. Keep `COOKIE_SECURE=true`. The Compose network gives Caddy a fixed internal IP and the API trusts forwarded client IPs only from that allowlisted proxy. Do not broaden `TRUSTED_PROXY_IPS` to arbitrary networks.
5. Build and start the API and HTTPS web frontend:

```bash
docker compose up -d --build api web
docker compose logs -f api web
```

6. Start the Testnet indexer worker only after reviewing its starting checkpoint and provider limits:

```bash
docker compose --profile indexer up -d indexer
```

7. Start the Telegram bot only after setting its token and Mini App URL:

```bash
docker compose --profile telegram up -d bot
```

After the services are healthy, run the public smoke checks with `DUR_SMOKE_BASE_URL=https://YOUR-MINI-APP-DOMAIN npm run smoke:test`. Caddy obtains and renews HTTPS certificates automatically when DNS and ports are configured correctly. The API and indexer share a persistent SQLite volume. The indexer remains Testnet-only; imported events remain ineligible for reputation until transaction proof and contract-specific semantic verification are completed.

**Deployment boundary:** this template is for controlled Testnet QA only. The escrow contract has not undergone an independent audit, dispute resolution can lock a deal while an arbiter is unavailable, and payout/gas/bounce behavior still needs specialist review. Do not use real funds or Mainnet.
