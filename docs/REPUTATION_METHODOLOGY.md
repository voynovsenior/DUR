# DUR Reputation Methodology

Status: **experimental implementation v0.1.0**. This is a deterministic attestation projection for development and Testnet evaluation, not a calibrated universal trust score.

## 1. Dimensions

The current implementation reports four independent dimensions:
- `reliability`
- `delivery`
- `communication`
- `disputeResolution`

An issuer attestation contributes values only when its claim contains a `reputation.dimensions` object with a numeric value from 0 to 100 for the relevant dimension. Missing or invalid dimensions are omitted rather than treated as zero.

## 2. Eligible evidence

An attestation is eligible only when:
- its status is `active`;
- it has not expired;
- its issuer is active;
- its issuer trust tier is `verified`, `trusted`, or `official`;
- the claim contains a valid value for the requested dimension.

New issuers start as `unverified` and contribute nothing. Raw TON Center indexer events are excluded because the current provider adapter does not establish cryptographic proof of event inclusion or canonical event semantics.

## 3. Weights and aggregation

Issuer tier weights:

| Tier | Weight |
|---|---:|
| unverified | 0 |
| verified | 0.50 |
| trusted | 0.75 |
| official | 1.00 |

Recency weight uses a 180-day half-life:

`recencyWeight = 0.5 ^ (ageSeconds / (180 * 24 * 60 * 60))`

For each issuer/schema pair, the newest attestation record is selected before eligibility filtering. A newer revoked, expired, or disputed record suppresses older active records rather than allowing them to reappear. Only after selecting the latest record are status, expiry, issuer tier, and claim validity checked. This prevents repeated updates by one issuer under one schema from multiplying its evidence count or bypassing revocation.

Each dimension is a weighted arithmetic mean:

`dimension = sum(value * tierWeight * recencyWeight) / sum(tierWeight * recencyWeight)`

Values are clamped to the 0–100 range and rounded to two decimal places. There is no fixed age cutoff: older evidence has progressively less influence but remains eligible while its attestation is active and unexpired. If no eligible evidence exists for a dimension, its value is `null`. Attestations with no supported dimension values are not included in the eligible evidence totals.

## 4. Issuer review

Only an administrator can change issuer trust tiers through the protected API. Every tier change records the old tier, new tier, actor label, reason and timestamp. The endpoint does not itself establish that an issuer deserves a tier: a formal review policy, evidence checklist, independent reviewer process and periodic reassessment are still required.

## 5. Interpretation and limitations

- The projection summarizes issuer claims; it does not prove that the underlying claims are true.
- Tier assignment is an administrative trust judgment, not a cryptographic guarantee.
- The current implementation does not calculate counterparty independence, deal completion ratios, graph-based Sybil risk, or verified on-chain outcomes.
- It does not include unverified indexer events.
- A wallet is not proof of a unique human identity.
- No score should be used as the sole basis for financial, access, moderation or eligibility decisions.
- Open and upheld attestation disputes are excluded from reputation eligibility. A rejected dispute restores eligibility only if the attestation is otherwise active, unexpired, issued by an active eligible issuer, and wins the issuer/schema latest-record selection.
- A newer disputed, revoked, or expired record suppresses older records from the same issuer/schema pair; filtering happens after latest-record selection to prevent resurrection.
- Dispute opening and administrative resolution primitives are implemented. Independent review, a complete correction workflow, calibration against reviewed datasets, and abuse evaluation remain outstanding.

## 6. API

`GET /v1/profiles/{subjectId}/reputation` returns the projection and its methodology version, evidence counts and limitations.

`POST /v1/admin/issuers/{id}/trust-tier` requires the admin Bearer token and a JSON body with `trustTier` and a non-empty `reason`.

## 7. Versioning

Any change to eligible evidence, dimensions, tier weights, decay, deduplication or aggregation must increment the methodology version and include deterministic regression tests. Existing outputs must remain attributable to the methodology version that produced them.
