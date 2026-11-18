# DUR Issuer Trust Policy — Draft v0.2.0

Status: **proposal for Testnet evaluation; not yet formally adopted**. This document describes a review policy; it is not yet enforced as a complete governance workflow. The current implementation provides administrator-controlled trust-tier changes with reason-audited history. Production use requires an independent review process and stronger operational controls.

## 1. Purpose and scope

Issuer trust tiers control the weight assigned to an issuer's attestations by the experimental Reputation methodology. A tier is a protocol-level assessment of the issuer's identity, evidence practices, operational reliability and accountability. It is not a guarantee that any individual claim is true.

This policy applies to issuers that submit off-chain attestations to DUR. It does not determine whether a transaction exists on TON; chain facts must pass the separate indexer and proof-verification pipeline.

## 2. Core principles

1. **Evidence before status.** A tier must be supported by recorded review evidence, not popularity, payment, token holdings or self-assertion.
2. **Least privilege.** New issuers begin as unverified and have zero reputation weight.
3. **Separation of issuer and subject.** Issuers must disclose ownership, employment, financial and other material relationships with the subject of an attestation.
4. **Explainability.** Every tier decision records the previous tier, new tier, reviewer, timestamp and a non-empty reason.
5. **Revocability.** A tier can be reduced or suspended when evidence changes, controls fail or material abuse is found.
6. **No pay-to-rank.** Fees, grants, sponsorships and commercial relationships must not increase trust tier or reputation weight.
7. **Privacy minimization.** Reviewers should retain only the information necessary to establish the criteria and document the decision.

## 3. Tier definitions and provisional criteria

The numerical weights below match Reputation methodology v0.2.0. They are experimental parameters, not a statement that an issuer is objectively trustworthy.

| Tier | Weight | Meaning |
|---|---:|---|
| unverified | 0.00 | Default state; issuer has not completed review |
| verified | 0.50 | Basic identity/control and evidence-process checks passed |
| trusted | 0.75 | Sustained, reviewed operating history and stronger accountability |
| official | 1.00 | Explicitly recognized protocol or ecosystem program issuer |

### 3.1 Unverified

- Assigned automatically on registration.
- May use permitted issuer APIs, subject to consent and schema rules.
- Attestations do not contribute to reputation while the issuer remains unverified.
- No public claim of DUR endorsement is permitted.

### 3.2 Verified

Reviewers should confirm and record:

- control of a stable organization, project or professional identity channel;
- a reachable security/contact channel and published description of the issuer's role;
- a clear explanation of what the issuer attests to and what it cannot verify;
- documented evidence collection and retention practices;
- disclosure of conflicts of interest and related-party attestations;
- use of registered schemas and appropriate subject consent;
- an accountable process for correcting mistakes and responding to disputes.

An individual issuer may qualify without incorporating a legal entity. Review must be proportionate and must not require unnecessary sensitive personal data.

### 3.3 Trusted

In addition to the verified criteria, reviewers should confirm:

- a sustained operating history, normally at least 90 days;
- a representative sample of attestations with traceable evidence references;
- timely handling of disputes, corrections and revocations;
- no unresolved material integrity incident;
- documented access control for issuer API keys and a rotation/revocation procedure;
- periodic reassessment and disclosure of material changes.

The 90-day period is a default review guideline, not an automatic promotion rule.

### 3.4 Official

Reserved for issuers explicitly designated by a documented DUR governance decision or a named ecosystem integration program. The record must identify:

- the recognizing authority and scope of recognition;
- the program or integration covered;
- the decision date, review date and conditions;
- conflicts of interest and any limitations on the issuer's authority.

An issuer cannot obtain official status by paying, holding tokens, being popular or self-labeling as official. Official status is not a blanket endorsement of every claim.

## 4. Review procedure

For the current prototype:

1. The issuer remains unverified until an administrator completes a review.
2. The reviewer checks the applicable tier criteria and records evidence references without storing unnecessary personal data.
3. The reviewer records a concise reason for the decision through the administrative trust-tier operation.
4. The issuer is notified of the outcome and any material conditions through the project's supported communication channel.
5. A reassessment date is recorded in the review process outside the current API until a dedicated review workflow exists.

Before production, tier promotion and official designation should require two-person review, conflict-of-interest checks, and a documented appeal path. These controls are policy requirements for a future operational workflow; they are not represented as implemented by the current prototype.

## 5. Monitoring, suspension and downgrade

Reviewers should reassess an issuer when:

- a material dispute is upheld;
- evidence is fabricated, materially misleading or unverifiable;
- an issuer's API key or account is compromised;
- the issuer changes ownership, control or declared scope;
- repeated policy violations or undisclosed conflicts are identified;
- the issuer becomes unreachable or ceases the activity for which it was approved.

Available responses should be proportionate: request clarification, restrict issuance, rotate/revoke credentials, downgrade the tier, suspend the issuer, or revoke affected attestations where the evidence supports that action.

A downgrade or suspension must preserve an audit trail. Historical decisions must not be silently overwritten. The reputation projection must use the current issuer status and must not allow revoked or superseded evidence to reappear through older records.

## 6. Conflicts, self-attestation and collusion

- Issuers must disclose when they are the subject, employer, contractor, affiliate, owner or financial beneficiary of an attestation.
- Self-attestations and related-party attestations must be excluded from reputation weighting unless a future methodology explicitly defines a separately labeled use case.
- Reviewers should look for reciprocal attestation patterns, coordinated issuer clusters, repeated templates, implausible activity bursts and common control signals.
- These signals are risk indicators, not proof of Sybil behavior. A human review and an appeal path are required before a punitive decision.
- Issuer diversity must not be treated as human uniqueness: multiple wallets or accounts may share control, and one person may legitimately control multiple accounts.

## 7. Disputes and corrections

Subjects should be able to challenge an attestation with a reason and optional evidence references. Reviewers must record whether a dispute is upheld or rejected and why. An upheld dispute should trigger a documented review of the affected attestation and its reputation eligibility.

The current repository has dispute opening and administrative resolution primitives. The exact effect of an upheld dispute on attestation status and reputation projection must be explicitly integrated and covered by regression tests before the workflow is considered complete.

## 8. Reassessment and transparency

- Verified and trusted issuers should be reviewed at least every 12 months, or sooner after a material incident.
- Official issuers should be reviewed at least every 6 months and whenever the recognition program changes.
- Public profile responses should disclose the methodology version, evidence coverage and limitations.
- Public issuer status should disclose tier and review date where doing so does not expose private information.
- Tier weights and eligibility rules must be versioned with the reputation methodology.

## 9. Limitations and non-goals

- A tier is not proof of truth, legal accreditation, identity uniqueness or a guarantee of future conduct.
- A high tier does not make every claim eligible; each attestation must independently pass schema, consent, status, expiry and evidence checks.
- This policy does not replace cryptographic verification of on-chain events.
- This draft does not define a token-based governance system, DAO voting, paid verification, or automatic trust scoring.

## 10. Adoption checklist

Before this policy is considered production-ready:

- [ ] Maintainer review and explicit policy approval
- [ ] Two-person promotion and official-designation workflow
- [ ] Conflict-of-interest declarations and reviewer recusal
- [ ] Reassessment scheduling and issuer notification
- [ ] Appeal and correction workflow
- [x] Tested integration of open/upheld/rejected dispute states with reputation eligibility
- [ ] Public issuer status and review-date disclosure
- [ ] Independent review of tier criteria and methodology weights
