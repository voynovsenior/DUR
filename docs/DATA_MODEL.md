# DUR data model

The entities below define the protocol model. The backend currently includes a validated canonical claim helper in `backend/src/attestations/model.ts`; persistent issuer and attestation registry tables and API routes are not implemented yet.

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
Represents an entity allowed to issue a defined class of attestations.

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
Represents a structured claim made by an issuer about a subject.

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

## Disputes and revocation
Disputed or revoked evidence must remain auditable. Do not physically erase history when a correction or revocation is required; append a status transition with actor, timestamp, reason and reference.

## Design constraints
- Store only data required for the protocol purpose.
- Avoid storing private keys, seed phrases or unnecessary personal data.
- Separate public chain facts from issuer claims and derived risk signals.
- Keep schema versions explicit.
- Do not expose private moderation signals through public profile endpoints.
