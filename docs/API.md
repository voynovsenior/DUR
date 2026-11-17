# DUR API — Development Preview

Base URL: `http://localhost:8787`

The API is an early development service. Telegram authentication and session endpoints are implemented. TON wallet verification, reputation, attestations, indexing, and escrow are not implemented.

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

## GET /v1/profiles/{identifier}

Returns HTTP 501 with `not_implemented`. No reputation profile is fabricated.

## Local development

~~~bash
npm install
TELEGRAM_BOT_TOKEN="your-bot-token" COOKIE_SECURE=false npm run api
~~~

Use a private local environment. Never commit a real bot token. In deployed environments, keep Secure cookies enabled and set `CORS_ORIGIN` to the exact HTTPS frontend origin.

Optional environment variables:
- `API_PORT` — defaults to 8787.
- `TELEGRAM_BOT_TOKEN` — required for Telegram login.
- `DUR_DATABASE_PATH` — defaults to `./data/dur.sqlite`.
- `COOKIE_SECURE` — defaults to secure cookies; set false only for local HTTP development.
- `CORS_ORIGIN` — exact allowed frontend origin.

## Error model

Responses are JSON and use `Cache-Control: no-store`. Errors include a machine-readable `error` field and request identifier where applicable.

## Security boundary

TON Connect `ton_proof` verification and wallet-link endpoints are not implemented. A connected wallet must not be treated as authenticated. Reputation, attestations, and escrow remain unavailable.
