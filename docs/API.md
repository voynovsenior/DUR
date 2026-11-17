# DUR API — Development Preview

Base URL: `http://localhost:8787`

This is an initial service shell, not a production API. It intentionally exposes only health and capability metadata. Identity, reputation, attestations and escrow HTTP endpoints are not implemented.

## GET /healthz

Returns service liveness.

~~~json
{
  "ok": true,
  "service": "dur-api",
  "version": "0.1.0"
}
~~~

## GET /v1/status

Returns the protocol preview status and explicit capability flags. A capability marked `not_implemented` must not be represented by clients as available.

## GET /v1/profiles/{identifier}

Returns HTTP 501 with `not_implemented`. No reputation profile is fabricated.

## Identity verification helper

A server-side Telegram Mini App init-data verifier is available at `backend/src/identity/telegram.ts`. It is a library helper only: no login route, account persistence, or session is created yet. Pass raw `Telegram.WebApp.initData`, not `initDataUnsafe`. Supply the bot token only through server-side environment configuration.

TON Connect `ton_proof` verification and wallet-link endpoints are not implemented. A connected wallet must not be treated as authenticated.

## Error envelope

Errors include a stable machine-readable `error` field and a request identifier where applicable. Responses are JSON and use `Cache-Control: no-store`.

## Local development

~~~bash
npm install
npm run api
npm test
~~~

Optional environment variables:
- `API_PORT` — defaults to 8787.
- `CORS_ORIGIN` — one exact allowed browser origin. Do not use a wildcard for credentialed flows.

## Security boundary

No authenticated write endpoints exist. Do not add privileged writes until Telegram init-data validation is connected to server-side sessions and TON wallet proof verification is implemented and tested.
