# Protocol concepts

## Reputation
DUR exposes an experimental, versioned attestation projection with four dimensions: reliability, delivery, communication and dispute resolution. Each dimension is a weighted mean of eligible issuer-provided values. Issuer tiers weight evidence (verified 0.5, trusted 0.75, official 1.0); recency decays with a 180-day half-life. The latest active attestation per issuer/schema pair replaces earlier submissions. Unverified issuers, revoked/expired attestations and unverified indexer events are excluded. This is a development methodology, not a calibrated universal score. Issuer claims are claims, not independently verified facts.

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
