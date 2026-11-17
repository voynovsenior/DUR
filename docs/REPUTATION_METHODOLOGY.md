# DUR Reputation Methodology — Design Draft

Status: design only. No production reputation calculation or public score endpoint is implemented.

## 1. Output model

DUR should publish an explainable evidence profile, not an unexplained universal trust score. A profile is a versioned projection containing:
- per-dimension result;
- confidence and evidence coverage;
- eligible evidence count;
- freshness window;
- methodology version;
- references to the evidence used.

A numeric aggregate must not be exposed until the methodology has been calibrated against representative, reviewed data.

## 2. Evidence classes

### Canonical on-chain facts
Examples include transaction inclusion, message relationships and verified contract events. An indexer must verify source, network, transaction identity, block/masterchain context and event decoding. Client-submitted hashes are not evidence.

### Issuer attestations
An attestation proves that an identified issuer made a structured claim. It does not prove the claim is true. Eligibility depends on issuer status, policy version, evidence references, expiry and revocation state.

### Derived signals
Concentration, repetition and graph patterns are risk indicators. They are not direct facts and must not independently establish fraud.

## 3. Candidate dimensions

- **Fulfilment consistency:** completed outcomes relative to eligible, resolved agreements.
- **Evidence quality:** provenance, verifiability and completeness of supporting evidence.
- **Counterparty breadth:** distribution across independent counterparties, with diminishing marginal contribution from repeated pairs.
- **Recency and consistency:** temporal distribution of eligible outcomes, using a documented versioned decay function.
- **Issuer assurance:** reliability policy of the issuer, kept separate from the truth value of each claim.

These dimensions are candidates, not currently calculated values. Exact weighting and calibration require a reviewed dataset and must be versioned.

## 4. Eligibility and exclusions

- Reject unverified, non-canonical or duplicate chain events.
- Exclude revoked attestations and attestations past expiry.
- Keep disputed outcomes separate from resolved positive outcomes.
- Do not infer service quality from a transfer amount or transaction count.
- Do not let a single issuer or repeated counterparty dominate a profile.
- Keep wallet identity network-qualified; a wallet is not a unique human identity.

## 5. Anti-abuse and correction

Use idempotent event identities, issuer authentication, replay protection, counterparty concentration analysis and graph-based anomaly review. An anomaly is a review signal, not an automatic fraud verdict. Preserve dispute and correction history as append-only events.

## 6. Required invariants

1. Every output must reference a methodology version.
2. Every included input must have a verifiable source and stable identity.
3. Re-ingesting an event must not increase its contribution.
4. Revoked or expired evidence must not contribute to a current projection.
5. Disputed evidence must not silently count as resolved positive evidence.
6. A client must never be able to submit its own reputation contribution directly.
7. Every dimension must expose coverage and confidence, not just a value.

## 7. Implementation gates

Before publishing a profile:
- implement the canonical TON indexer and verifier;
- define evidence event schemas and idempotency keys;
- complete the issuer policy and subject-consent model;
- write deterministic calculation tests and adversarial cases;
- document methodology and version migration;
- evaluate false positives and bias in anomaly review.

Until those gates pass, the UI must continue to show a preview state and must not fabricate scores.
