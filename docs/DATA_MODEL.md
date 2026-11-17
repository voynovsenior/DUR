# DUR data model

The entities below define the protocol model. The backend includes a canonical claim helper and a persistent issuer/attestation registry with issuer API keys, issuance, expiry, revocation and event history. Subject-consent workflows and registered JSON Schema validation remain unimplemented.

This document is a design proposal, not a deployed database schema. It defines conceptual entities for later review before migrations are written.

## Identity reference
A DUR subject should be represented by a typed identifier, not by an assumption that one wallet equals one human.

Proposed fields:
- `subject_id`: internal opaque identifier;
- `identifier_type`: wallet, application account, or another supported namespace;
- `identifier_value`: normalized public identifier;
- `proof_status`: unverified, verified, revoked;
- `created_at`, `updated_at`.

Wallet ownership must be proven with a server-verified wallet proof. A client-provided address alone is not proof.

## Issuer
Represents an entity allowed to issue a defined class of attestations. The initial SQLite registry, admin creation endpoint, issuer API-key authentication, versioned JSON Schema registration, and wallet-owner consent lifecycle are implemented. New issuers default to the `unverified` trust tier.

Proposed fields:
- `issuer_id`;
- `display_name`;
- `issuer_type`;
- `policy_version`;
- `trust_tier`;
- `status`;
- `created_at`.

Trust tiers must be governed by explicit policies and must not be silently inferred from transaction volume.

## Attestation
Represents a structured claim made by an issuer about a subject. Persistence, issuer-authenticated issuance, expiry, revocation and event history are implemented. Schema IDs and versions are immutable and backed by a persisted JSON Schema registry. Issuance is rejected unless the claim validates against the registered version. Wallet-owner consent is stored per linked wallet, issuer and schema version; owners can revoke it. Consent is checked before issuance.

Proposed fields:
- `attestation_id`;
- `schema_id` and `schema_version`;
- `issuer_id`;
- `subject_id`;
- `claim_digest`;
- `evidence_refs`;
- `issued_at`, optional `expires_at`;
- `status`;
- optional `revocation_reason`.

The claim and its evidence must remain distinguishable. The current helper validates identifiers, schema version, timestamps, evidence reference bounds and JSON-safe claim content, then computes a deterministic SHA-256 digest over canonical JSON. This digest identifies the claim bytes; it does not authenticate an issuer or prove the claim true. An attestation is evidence that an issuer made a claim, not automatic proof that the claim is true.

## Evidence event
Represents a normalized input to future reputation computation.

Proposed fields:
- `event_id`;
- `source_type`;
- `source_reference`;
- `subject_id`;
- `counterparty_id`, where relevant;
- `event_type`;
- `verification_status`;
- `observed_at`;
- `canonicality_metadata`.

Events need deterministic identities and idempotent ingestion. Reprocessing the same chain event must not create additional reputation weight.

## Reputation projection
A derived view over eligible evidence, not a source of truth.

Proposed fields:
- `subject_id`;
- `methodology_version`;
- `dimension_values`;
- `evidence_count`;
- `computed_at`;
- `source_checkpoint`.

Every displayed value must be explainable through its methodology version and supporting evidence references.

## Attestation events
Issuance, revocation and expiry transitions are stored as separate events. Issuer credentials are stored as SHA-256 digests and are returned only once at creation.

## Disputes and revocation
Disputed or revoked evidence must remain auditable. Do not physically erase history when a correction or revocation is required; append a status transition with actor, timestamp, reason and reference.

## Design constraints
- Store only data required for the protocol purpose.
- Avoid storing private keys, seed phrases or unnecessary personal data.
- Separate public chain facts from issuer claims and derived risk signals.
- Keep schema versions explicit.
- Do not expose private moderation signals through public profile endpoints.
