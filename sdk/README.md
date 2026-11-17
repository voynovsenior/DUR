# DUR Issuer SDK

A small TypeScript client for issuer-authenticated DUR attestation operations.

## Build

From the repository root:

```bash
npm run build:sdk
```

The package emits JavaScript and TypeScript declarations into `sdk/dist`.

## Usage

Create an issuer through the protected `POST /v1/admin/issuers` endpoint, store the returned API key in the issuer application's server-side secret storage, then use:

```ts
import { DurIssuerClient } from '@dur-protocol/issuer-sdk';

const dur = new DurIssuerClient({
  baseUrl: process.env.DUR_API_URL!,
  apiKey: process.env.DUR_ISSUER_API_KEY!,
});

const attestation = await dur.createAttestation({
  schemaId: 'dur.delivery.completed',
  schemaVersion: 1,
  subjectId: 'wallet:-3:0:...',
  claim: { completed: true },
  evidenceRefs: ['ton:transaction:...'],
});
```

The SDK supports issue, read-own-attestation, revoke-own-attestation and revoke-current-key operations. It never sends issuer keys to browser code. Do not commit keys or place them in `VITE_` variables.

## Limitations

The server validates claims against registered JSON Schema versions and requires wallet-owner consent before issuance. Issuer applications must obtain consent through the DUR user-facing flow; the SDK does not create consent grants or verify evidence references. An attestation proves that an authenticated issuer made a claim; it does not prove that claim true.
