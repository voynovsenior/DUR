# Protocol concepts

## Reputation
DUR intends to represent reputation as evidence-backed dimensions rather than an unexplained universal number. Any future aggregate must publish its methodology, eligible evidence classes, weighting rules, decay policy and dispute handling.

## Attestations
An attestation is a structured claim. A proposed record should include schema and version, issuer identity and policy reference, subject identifier, claim payload or content hash, evidence references, creation time, optional expiry, status and revocation reference.

An issuer claim is not automatically true because it is recorded. Consumers must evaluate issuer trust and evidence quality.

## Escrow
Escrow is intended to be modular and independently usable. Reputation integration may consume completed, verified deal events, but Escrow must not require Reputation to function. No escrow transaction is implemented in this repository. Do not send funds to experimental contracts or addresses.

## Evidence categories
- **On-chain facts:** transaction inclusion, contract address, message relationships and contract-emitted events, subject to correct chain verification.
- **Off-chain attestations:** claims from identified issuers, subject to issuer policy and evidence review.
- **Derived signals:** risk or reputation indicators computed from verified inputs; estimates, not direct blockchain facts.

## Anti-abuse principles
Planned controls include event idempotency, replay protection, source authentication, issuer trust tiers, rate limits, dispute states, diminishing returns for repetitive counterparties and graph-based anomaly review. No single signal should automatically prove fraud. Sybil resistance is an ongoing risk-management problem, not a solved binary check.
