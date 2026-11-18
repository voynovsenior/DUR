# DUR Issuer SDK

TypeScript clients for issuer attestation operations, wallet-owner reputation/dispute workflows, and server-side administration.

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

`DurIssuerClient` supports issue, read-own-attestation, revoke-own-attestation, revoke-current-key, issuer-directory discovery, active schema listing and versioned schema retrieval. `DurSubjectClient` uses the authenticated session cookie to read the caller's linked-wallet reputation profile and open/list disputes. The profile API is owner-only until a separate public visibility-consent mechanism exists.

`DurAdminClient` supports issuer creation, issuer suspension/revocation, schema registration, issuer trust-tier review, dispute resolution and Testnet transaction verification. It is server-side only: never instantiate it in browser code, never expose its token through `VITE_` variables, and never commit the token. The SDK does not store or request wallet seed phrases or private keys.

## Integration example

A minimal server-side example is available at [`sdk/examples/issuer-integration.ts`](./examples/issuer-integration.ts). It demonstrates environment-based secret loading, typed attestation submission, and protocol catalog discovery. Adapt the schema ID and claim fields to a schema registered by the DUR administrator; the example does not create schemas or bypass wallet-owner consent.

## Limitations

The server validates claims against registered JSON Schema versions and requires wallet-owner consent before issuance. Issuer applications must obtain consent through the DUR user-facing flow; the SDK does not create consent grants or verify evidence references. Reputation values are experimental projections of eligible issuer claims, not calibrated trust scores. The admin transaction-verification method requires the separate Testnet-only Go verifier binary and records transaction-history verification only; application event semantics remain pending. An attestation proves that an authenticated issuer made a claim; it does not prove that claim true.
