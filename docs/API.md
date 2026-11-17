# DUR API — Development Preview

Base URL: `http://localhost:8787`

The API is an early development service. Telegram authentication and session endpoints are implemented. TON Proof wallet linking is implemented for a limited set of standard wallets but requires domain configuration and CI/deployment validation. Reputation, canonical TON indexing, and escrow are not implemented. The attestation registry has issuer-authenticated create/read/revoke endpoints but no public subject-consent or schema registry yet.

## GET /healthz

Returns service liveness.

## GET /v1/status

Returns protocol version and explicit capability flags. A capability marked `not_implemented` must not be represented by clients as available.

## Telegram authentication

### POST /v1/auth/telegram

Requires `Content-Type: application/json` and accepts raw Telegram Mini App init data:

~~~json
{ "initData": "<raw Telegram.WebApp.initData>" }
~~~

The server validates the Telegram HMAC signature and freshness, rejects duplicate parameters and malformed user data, then creates or updates the DUR account and sets an HttpOnly session cookie. Requests with another media type receive HTTP 415; malformed or expired authentication data is rejected.

Do not send `initDataUnsafe`. Do not send the bot token to the frontend.

### GET /v1/auth/me

Returns the current authenticated Telegram account. Returns HTTP 401 when the session is absent, invalid, or expired.

### POST /v1/auth/logout

Revokes the current server-side session and expires its cookie.

### POST /v1/auth/ton/challenge

Requires an authenticated Telegram session. Returns a random, short-lived payload and sets an HttpOnly attempt cookie. The payload is bound to the account and browser attempt.

### POST /v1/auth/ton/verify

Requires JSON containing the TON Connect address, network, wallet state init and `ton_proof`. The server validates the exact configured domain and network, derives the address and public key from a supported wallet state init, verifies the Ed25519 signature, and atomically consumes the challenge before linking the wallet to the Telegram account. Unknown wallet versions are rejected.

### GET /v1/auth/wallets

Lists network-qualified wallets linked to the current authenticated Telegram account.

Required server environment:
- `TON_APP_DOMAIN` — exact dApp hostname without scheme or path (must be a valid dApp domain).
- `TON_NETWORK_ID` — TON global network ID; defaults to `-3` (Testnet).

Supported fixed-key wallet versions currently include V1R1–V3R2 and V4R2. V4R1, V5, WalletTg and other unrecognized code hashes are rejected until separately implemented and reviewed.

## Attestation registry

### POST /v1/admin/issuers

Requires `Authorization: Bearer <DUR_ADMIN_TOKEN>` and JSON `{ "displayName": "Marketplace", "issuerType": "marketplace" }`. Creates an active issuer and returns its API key once. The server stores only the key digest. Keep `DUR_ADMIN_TOKEN` private and do not place it in frontend variables.

### POST /v1/issuers/me/revoke-key

Requires the issuer's current API key. Revokes that key immediately; it cannot be used again.

### POST /v1/attestations

Requires an active issuer API key in the Bearer header. Accepts `schemaId`, `schemaVersion`, `subjectId`, `claim`, `evidenceRefs`, and optional `expiresAt`. The server determines `issuerId` and `issuedAt`; clients cannot choose either. Claim content is canonicalized and hashed. The registry records issuance as an event.

### GET /v1/attestations/{id}

Requires the issuing issuer API key. Returns that issuer's attestation and event history.

### POST /v1/attestations/{id}/revoke

Requires the issuing issuer API key and JSON `{ "reason": "..." }`. Revocation is recorded as a status transition and event. Expired attestations cannot be revoked.

Issuer trust tier defaults to `unverified`. The current registry validates the attestation envelope and canonical JSON but does not yet validate claim fields against a registered JSON Schema. Issuer claims are not independently verified facts.

## GET /v1/profiles/{identifier}

Returns HTTP 501 with `not_implemented`. No reputation profile is fabricated.

## Local development

~~~bash
npm install
TELEGRAM_BOT_TOKEN="your-bot-token" TON_APP_DOMAIN="app.example.com" TON_NETWORK_ID="-3" COOKIE_SECURE=false npm run api
~~~

Use a private local environment. Never commit a real bot token. In deployed environments, keep Secure cookies enabled and set `CORS_ORIGIN` to the exact HTTPS frontend origin.

Optional environment variables:
- `API_PORT` — defaults to 8787.
- `TELEGRAM_BOT_TOKEN` — required for Telegram login.
- `DUR_DATABASE_PATH` — defaults to `./data/dur.sqlite`.
- `COOKIE_SECURE` — defaults to secure cookies; set false only for local HTTP development.
- `CORS_ORIGIN` — exact allowed frontend origin.
- `TON_APP_DOMAIN` — exact public dApp hostname (required for wallet linking).
- `TON_NETWORK_ID` — defaults to `-3` (TON Testnet).
- `DUR_ADMIN_TOKEN` — optional server-only credential for creating issuers.

## Error model

Responses are JSON and use `Cache-Control: no-store`. Errors include a machine-readable `error` field and request identifier where applicable.

## Security boundary

A connected wallet must not be treated as authenticated until the backend has accepted a fresh `ton_proof`. The current wallet-link flow is a development implementation for a limited wallet set and has not passed CI or real-wallet Testnet QA. Reputation, attestations, and escrow remain unavailable.
