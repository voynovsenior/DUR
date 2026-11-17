# Testing strategy

## Current automated coverage
The API test suite currently checks:
- health endpoint returns a successful service response;
- profile placeholder returns HTTP 501 rather than inventing reputation data.

Run:
~~~bash
npm test
npm run build
~~~

## Required future test layers

### API
- method and route behavior;
- schema validation;
- error response consistency;
- CORS allowlist behavior;
- request size and rate limits before public deployment.

### Identity
- valid and invalid Telegram init data;
- expired authentication payloads;
- valid and invalid wallet proofs;
- address normalization and network mismatch.

### Attestations
- issuer authorization;
- schema version compatibility;
- expiry and revocation;
- duplicate submissions and replay attempts.

### Reputation
- deterministic computation;
- evidence eligibility;
- duplicate event idempotency;
- disputed event handling;
- regression fixtures for methodology changes.

### Smart contracts
- state-machine invariants;
- unauthorized state transitions;
- malformed messages;
- replay and duplicate message handling;
- adversarial and property-based tests.

No test suite is a substitute for independent security review before any mainnet deployment.
