# DUR API — Development Preview

Base URL: `http://localhost:8787`

This is an initial service shell, not a production API. It intentionally exposes only health and capability metadata. Identity, reputation, attestations and escrow endpoints are not implemented.

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

## Error envelope

Errors include a stable machine-readable `error` field and a request identifier where applicable. Responses are JSON and use `Cache-Control: no-store`.

## Local development

~~~bash
npm install
npm run api
~~~

Optional environment variables:
- `API_PORT` — defaults to 8787.
- `CORS_ORIGIN` — one exact allowed browser origin. Do not use a wildcard for credentialed flows.

## Security boundary

This API does not authenticate Telegram users or verify wallet ownership. Do not add privileged writes until signed Telegram init data and wallet proof verification are implemented server-side.
