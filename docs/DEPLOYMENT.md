# Deployment guide

## Current status
The repository is a prototype. Deployment makes the preview accessible; it does not activate reputation scoring, public subject-consented attestations, indexing or escrow contracts. Issuer endpoints require deliberate admin credential configuration.

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
- DUR_ADMIN_TOKEN (optional; server-only issuer administration credential)

Keep the database directory out of static hosting. Back up the SQLite database securely. The API supports Telegram login/session endpoints and Testnet-first TON Proof wallet linking for a limited set of standard wallets. The API and Mini App should share a site so SameSite=Strict cookies work; if separate subdomains are used, verify the cookie and CORS configuration before deployment.

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
- [ ] Build and mobile smoke tests pass
