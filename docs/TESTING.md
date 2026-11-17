# Testing strategy

## Current automated coverage

Run all checks:

~~~bash
npm test
npm run build
~~~

The automated suite covers:
- API health and status behavior;
- explicit not-implemented profile response;
- Telegram init-data HMAC validation, tampering, duplicate keys, and freshness;
- Telegram login route and session cookie issuance;
- authenticated account lookup;
- invalid signature rejection;
- logout revocation;
- disabled auth when the bot token is not configured.

Identity API tests use an in-memory SQLite database and synthetic Telegram test data. They do not require a real bot token or Telegram account.

## Required future test layers

### API
- request schema validation and content-type enforcement;
- CORS allowlist behavior;
- request size and rate limits before public deployment;
- database backup and recovery.

### Identity
- persistent single-use TON wallet challenges;
- valid and invalid wallet proofs for every explicitly supported wallet version;
- address normalization and network mismatch;
- session rotation when a wallet is linked;
- expiry and revocation under concurrent requests.

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

## Indexer adapter

The TON Center adapter is tested with deterministic API fixtures. Tests cover Testnet-only configuration, block/transaction normalization, and the explicit `unverified` trust status. These tests do not establish live provider availability or cryptographic chain verification.
