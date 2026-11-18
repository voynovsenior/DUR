# DUR API — Development Preview

Base URL: `http://localhost:8787`

The API is an early development service. Telegram authentication and session endpoints are implemented. TON Proof wallet linking is implemented for a limited set of standard wallets but requires domain configuration and CI/deployment validation. A first experimental reputation projection is available from reviewed issuer attestations; it is not a calibrated production trust score. Escrow is not implemented. A manual TON Testnet ingestion adapter is available, but its indexed provider data remains explicitly unverified. The attestation registry has issuer-authenticated create/read/revoke endpoints but wallet-owner consent is required for issuance; owners can inspect and revoke their grants.

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
- `TON_NETWORK_ID` — must be `-3` (TON Testnet) for the current verifier; other networks are rejected.

Supported fixed-key wallet versions currently include V1R1–V3R2 and V4R2. V4R1, V5, WalletTg and other unrecognized code hashes are rejected until separately implemented and reviewed.

## Public directories

### GET /v1/issuers

Lists active issuers with their public ID, display name, type and current trust tier. An issuer with `unverified` tier has not yet passed DUR trust review.

### GET /v1/schemas

Lists active immutable schema IDs and versions available for consent grants.

## Subject consent

### POST /v1/auth/consents

Requires a Telegram-authenticated session and a TON Testnet wallet already linked to that account. Creates a consent grant scoped to one issuer, one schema version, one wallet and a stated purpose. Expiry defaults to 90 days and can be customized up to one year.

### GET /v1/auth/consents

Lists consent grants belonging to the authenticated account.

### POST /v1/auth/consents/{id}/revoke

Revokes the selected grant. Subsequent attestation issuance for that wallet/issuer/schema combination is rejected.

## Attestation registry

### POST /v1/admin/schemas

Requires the server-side admin Bearer token. Registers an immutable `schemaId` and positive `schemaVersion` with a JSON Schema document. Duplicate versions are rejected.

### GET /v1/schemas/{schemaId}/{version}

Returns a registered schema version.

### POST /v1/admin/issuers

Requires `Authorization: Bearer <DUR_ADMIN_TOKEN>` and JSON `{ "displayName": "Marketplace", "issuerType": "marketplace" }`. Creates an active issuer and returns its API key once. The server stores only the key digest. Keep `DUR_ADMIN_TOKEN` private and do not place it in frontend variables.

### POST /v1/admin/issuers/{id}/status

Requires the server-side admin Bearer token and JSON `{ "status": "active|suspended|revoked" }`. Suspension immediately disables issuer API-key authentication. Revocation is terminal and cannot be reversed.

### POST /v1/issuers/me/revoke-key

Requires the issuer's current API key. Revokes that key immediately; it cannot be used again.

### POST /v1/attestations

Requires an active issuer API key in the Bearer header. Accepts `schemaId`, `schemaVersion`, `subjectId`, `claim`, `evidenceRefs`, and optional `expiresAt`. The server determines `issuerId` and `issuedAt`; clients cannot choose either. Claim content is canonicalized and hashed. The registry records issuance as an event.

### GET /v1/attestations/{id}

Requires the issuing issuer API key. Returns that issuer's attestation and event history.

### POST /v1/attestations/{id}/revoke

Requires the issuing issuer API key and JSON `{ "reason": "..." }`. Revocation is recorded as a status transition and event. Expired attestations cannot be revoked.

Issuer trust tier defaults to `unverified`. The registry validates claims against a registered JSON Schema Draft-07 before issuance. Trust-tier changes are admin-controlled and reason-audited; a formal governance policy and dispute workflow remain pending. Issuer claims are not independently verified facts.

## Attestation disputes

### POST /v1/attestations/{id}/disputes

Requires an authenticated Telegram session and proof that the attestation subject wallet is linked to that account. Accepts a reason (10–512 characters) and up to 10 evidence references. Only the subject wallet owner can open a dispute against an active attestation. A second open dispute for the same attestation is rejected.

### GET /v1/auth/disputes

Lists disputes opened by the authenticated account.

### POST /v1/admin/disputes/{id}/resolve

Requires the admin Bearer token and JSON `{ "status": "upheld|rejected", "reason": "..." }`. Resolution is audit-recorded. Open disputes and upheld disputes are excluded from reputation projections; rejected disputes restore eligibility if the attestation is otherwise active and unexpired. This workflow records claims and decisions but does not independently establish facts.

## TON Testnet indexer

### GET /v1/indexer/status

Returns the last persisted Testnet masterchain checkpoint and the `provider_indexed_data_unverified` trust label.

### GET /v1/indexer/events

Returns up to 100 recently ingested events. Optional query parameters: `network=ton-testnet`, `limit=1..100`, and `status=verified|unverified|quarantined`. The current TON Center adapter imports raw transactions as `unverified`; these records must not contribute to reputation.

Run a bounded manual sync with `npm run indexer:sync`. Configure `TONCENTER_API_URL` (Testnet API v3), optional `TONCENTER_API_KEY`, `INDEXER_START_SEQNO` for the first run, and `INDEXER_MAX_BLOCKS`. The first checkpoint must be chosen deliberately; an empty value is not interpreted as block zero. Later runs resume from the stored checkpoint.

## TON transaction proof verification

### POST /v1/admin/indexer/events/{id}/verify-transaction

Admin Bearer token required. The API invokes the separately built Testnet-only proof verifier for the stored event's account, logical time and transaction hash. Optional body: `{ "maxScan": 500 }` (1–10,000). A successful response records the trusted masterchain sequence number/root hash and verifier version.

This proves transaction membership in an account history anchored to a trusted Testnet masterchain state. It does **not** validate contract-specific event semantics or the truth of a business claim. The database stores a verification receipt, not the raw BOC proof payload. The stored event's `verificationStatus` therefore remains `unverified`; proof metadata is exposed separately as `transactionProof`. Configure `DUR_PROOF_VERIFIER_BIN` to enable the endpoint. Without the binary, the endpoint returns 503.

## Reputation profiles

### GET /v1/profiles/{subjectId}/reputation

Requires an authenticated Telegram session and proof that the subject wallet is linked to that account. Accepts a canonical TON Testnet subject ID: `wallet:-3:0:<64-char-hex>`. Returns methodology version, four dimensions, per-dimension evidence and issuer counts, eligible evidence counts, computation time and limitations. Public profile access is intentionally disabled until a separate profile-visibility consent mechanism exists.

Only active, unexpired attestations from active issuers with `verified`, `trusted`, or `official` tiers are eligible. Unverified issuers and all indexer events are excluded. Claims contribute only when they contain `reputation.dimensions` values from 0 to 100. Repeated attestations from the same issuer/schema pair are collapsed to the latest. The projection uses trust-tier weights and a 180-day half-life. It is experimental and must not be treated as a calibrated universal score.

## TypeScript SDK

The SDK package in `sdk/` exposes three clients:

- `DurIssuerClient` — authenticated attestation issue/read/revoke and API-key revocation, plus issuer and schema catalog discovery.
- `DurSubjectClient` — cookie-authenticated reputation reads, dispute workflows and profile-visibility consent management. A profile read is available to its linked wallet owner, or anonymously when an active public-visibility consent exists.
- `DurAdminClient` — server-side trust-tier review, dispute resolution and transaction-proof verification. Never ship this client or its token to a browser.

Issuer catalog discovery maps to `GET /v1/issuers`; schema discovery maps to `GET /v1/schemas` and `GET /v1/schemas/{schemaId}/{version}`. The SDK URL builder percent-encodes schema IDs and validates positive integer schema versions.

Build the package from the repository root with `npm run build:sdk`. A minimal server-side integration example is provided in [sdk/examples/issuer-integration.ts](../sdk/examples/issuer-integration.ts). Keep issuer and admin credentials in server-side secret storage. The SDK does not grant subject consent, verify evidence references, or elevate an issuer's trust tier.

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
- `TON_NETWORK_ID` — must be `-3` (TON Testnet); other networks are rejected.
- `DUR_ADMIN_TOKEN` — optional server-only credential for creating issuers.
- `TONCENTER_API_URL` — defaults to TON Center API v3 Testnet.
- `TONCENTER_API_KEY` — optional provider API key.
- `INDEXER_START_SEQNO` — required for the first indexer run; choose a deliberate starting masterchain sequence number.
- `INDEXER_MAX_BLOCKS` — maximum blocks per manual run, defaults to 1.

## Error model

Responses are JSON and use `Cache-Control: no-store`. Errors include a machine-readable `error` field and request identifier where applicable. Sensitive authentication, wallet-proof, consent and issuer-write routes have process-local fixed-window rate limits and return HTTP 429 with `Retry-After`; production deployments must also enforce edge-level or distributed rate limits.

## Security boundary

A connected wallet must not be treated as authenticated until the backend has accepted a fresh `ton_proof`. The current wallet-link flow is a development implementation for a limited wallet set and has not passed CI or real-wallet Testnet QA. The reputation profile is an experimental attestation projection, not a production trust score. Escrow operations remain unavailable. Attestation writes are restricted to authenticated issuers; public subject-consented profiles are not implemented.
