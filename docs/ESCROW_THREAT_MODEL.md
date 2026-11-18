# DUR Escrow Threat Model — Draft v0.1.0

Status: engineering review draft for the experimental Testnet prototype. This is not an independent audit, formal verification report, or approval to deploy. The current contract must not custody real-value funds.

## 1. Scope and assumptions

In scope:
- `contracts/Escrow.tolk` and `contracts/types.tolk`;
- agreement state and immutable terms stored in contract data;
- internal-message authorization and deadline checks;
- funding and payout messages;
- dispute and arbiter resolution;
- TON execution, fees, bounce behavior and contract balance.

Out of scope:
- security of users' wallets and devices;
- legal enforceability of off-chain agreements;
- correctness of an arbiter's real-world judgment;
- frontend UX (the current Mini App is not connected to this contract);
- reputation scoring, which must never authorize or trigger fund movement.

Assumptions:
- the contract is deployed only to TON Testnet during research;
- buyer, seller and arbiter addresses are fixed in initial contract state;
- agreement terms and deadlines are immutable after deployment;
- incoming messages are untrusted, may be duplicated, delayed, malformed or sent with unexpected value;
- external network/provider data is not trusted as contract authorization.

## 2. Assets and security objectives

| Asset / property | Security objective |
|---|---|
| Escrowed TON | Never pay more than once; preserve funds until an authorized terminal transition |
| Agreement terms | Bind both parties to one immutable deal ID, amount, participants and terms hash |
| State | Permit only valid transitions; terminal states remain terminal |
| Authorization | Only the designated buyer, seller or arbiter can invoke their role's operation |
| Availability | Avoid indefinite or unrecoverable locks where a safe recovery policy can be defined |
| Evidence | Emit enough versioned information for an independent indexer to reconstruct lifecycle facts |

## 3. Trust boundaries

- **Buyer / seller wallets:** untrusted message sources; sender address must be checked on-chain.
- **Arbiter:** trusted for dispute decisions, but not trusted to alter terms or bypass contract invariants.
- **TON execution environment:** authoritative for message delivery and contract state, but fees, action failures and bounce semantics must be explicitly tested.
- **Indexer:** observer only. Its output must never authorize contract transitions.
- **Reputation module:** observer only. A score or issuer claim must never release, refund or freeze escrow.

## 4. Threat analysis

### E-01 — Payout action failure or recipient delivery ambiguity

**Observed in prototype:** payout transitions save a terminal state and call `sendPayout`; the helper creates a no-bounce internal message and uses regular send mode. `onBouncedMessage` is empty.

**Risk:** the implementation has no explicit recovery or accounting path if payout delivery does not complete as expected, or if the recipient address cannot accept/use the funds as assumed. The exact behavior depends on TON message/action semantics and must be established with emulator tests.

**Required before Testnet value testing:**
- define whether payouts are bounceable and why;
- model action-phase send failures and bounced messages;
- prove that failed payout cannot leave a terminal state with funds stranded;
- test recipient contract rejection, inactive/uninitialized recipient, insufficient forwarding reserve and duplicate payout attempts;
- define a safe retry/recovery state that cannot permit double payment;
- reconcile contract balance against outstanding escrow liabilities after every transition.

### E-02 — Arbiter unavailable or malicious

**Observed in prototype:** a disputed agreement has no resolution timeout or alternate arbiter path.

**Risk:** funds can remain locked indefinitely if the arbiter disappears. A malicious arbiter can choose either payout destination.

**Required controls:**
- disclose arbiter powers before acceptance;
- choose a bounded dispute window and deterministic fallback;
- consider mutually agreed resolution or a carefully specified timeout path;
- ensure fallback cannot let either party steal funds by unilateral timeout;
- test all deadline boundary conditions and arbiter authorization.

### E-03 — Replay and duplicate messages

**Observed in prototype:** state checks prevent many repeated transitions, but there is no explicit deal/event nonce in the message schema beyond the contract's state.

**Risk:** duplicate messages, message reordering and retries may trigger unexpected action behavior or consume gas. State-based rejection must be tested for every opcode and every terminal state.

**Required controls:**
- add explicit protocol version and deal identifier binding where the deployment model requires it;
- test duplicate and reordered messages for every transition;
- verify one-and-only-one payout invariant under repeated approval, resolution, refund and claim messages.

### E-04 — Funding and accounting mismatch

**Observed in prototype:** `Fund` requires the inbound value to equal the stored amount.

**Risk:** assumptions about inbound value, forwarding fees, contract reserve and send fees may not match real execution. A contract that accepts exact funding but lacks a separately budgeted reserve may be unable to complete later actions.

**Required controls:**
- define whether the escrow amount includes or excludes fees;
- account for storage rent, compute fees, forwarding fees and deployment reserve;
- test exact, underfunded and overfunded messages;
- prove that no transition can release more than the outstanding liability.

### E-05 — Deadline boundary and time manipulation assumptions

**Observed in prototype:** funding/completion use inclusive upper bounds, while refund and seller claim use strict greater-than checks.

**Risk:** boundary behavior may surprise participants or differ between UI and contract if timestamps are rounded or interpreted inconsistently.

**Required controls:**
- publish timestamp semantics and timezone-independent Unix seconds;
- test at deadline - 1, deadline, and deadline + 1;
- ensure UI, SDK and contract use identical deadline definitions;
- ensure an open dispute cannot be bypassed by timeout.

### E-06 — Unversioned or missing lifecycle events

**Observed in prototype:** the current Tolk contract changes state but does not emit explicit versioned lifecycle events.

**Risk:** an indexer cannot reliably reconstruct semantic escrow events from generic transaction metadata alone.

**Required controls:**
- define a versioned event envelope and stable opcodes;
- include deal ID, event sequence, state transition, participant references and terms hash;
- emit events atomically with successful transitions;
- maintain decoder fixtures for every deployed code hash and event version;
- quarantine unknown versions rather than guessing.

### E-07 — Initial storage and deployment configuration

**Risk:** incorrect initial addresses, amount, state, deadlines or referenced terms cell could create an unusable or unsafe agreement.

**Required controls:**
- validate all initial storage fields in an audited deployment wrapper;
- publish a deterministic state-init/address derivation;
- test malformed and boundary initial data;
- verify deployed state against the signed agreement before funding;
- do not permit arbitrary post-deployment mutation of terms.

### E-08 — Reputation coupling

**Required invariant:** reputation is informational only. It must not be able to call privileged contract transitions, change recipient addresses, alter deadlines, or influence a contract's release/refund decision.

## 5. Required invariants

1. Total value paid to buyer and seller never exceeds the funded principal.
2. A terminal agreement cannot transition again.
3. Each agreement can complete at most one successful payout.
4. No payout occurs before a permitted release/refund transition.
5. Only the designated role may invoke each transition.
6. Terms and parties remain immutable after funding.
7. An open dispute blocks both timeout-based payout paths.
8. A failed payout has an explicit, tested recovery path and cannot cause double payment.
9. Fees and storage reserve are accounted for separately from escrow principal.
10. Reputation and indexer inputs cannot authorize fund movement.

## 6. Test matrix

| Area | Required cases |
|---|---|
| Authorization | Wrong sender for every opcode; arbiter-only resolution |
| State machine | Every valid transition; every invalid transition; terminal replay |
| Funding | Exact amount, underpayment, overpayment, wrong buyer, after deadline |
| Payout | Buyer approval, arbiter release/refund, timeout claim/refund |
| Bounce/action | Bounce, no-bounce, recipient rejection, insufficient reserve, send failure |
| Disputes | Open at deadline boundary; dispute blocks timeout; arbiter unavailable |
| Accounting | Principal conservation, fee reserve, repeated payout attempts |
| Data | Malformed message, wrong opcode, invalid terms cell, unsupported version |
| Events | Stable event sequence, versioned decoding, unknown code hash quarantine |

## 7. Release gates

### Prototype
- [x] Tolk source and initial emulator tests exist.
- [x] Lifecycle state model exists.
- [ ] This threat model reviewed by maintainers.

### Testnet integration (no real-value use)
- [ ] Resolve E-01 payout/bounce semantics and add adversarial tests.
- [ ] Define E-02 arbiter timeout/fallback policy.
- [ ] Complete E-03 replay and duplicate-message tests.
- [ ] Complete E-04 fee and balance accounting tests.
- [ ] Complete E-05 boundary tests.
- [ ] Implement E-06 versioned lifecycle events and decoder fixtures.
- [ ] Validate E-07 deterministic deployment state.
- [ ] Demonstrate E-08 separation from Reputation.

### Mainnet consideration
- [ ] Independent TON smart-contract security review.
- [ ] Reproducible build and deployment artifact verification.
- [ ] Formal or property-based invariant testing.
- [ ] Documented incident response and upgrade/deprecation policy.
- [ ] Explicit maintainer approval after all findings are resolved.

## 8. Current conclusion

The current contract is an experimental state-transition prototype, not a safe escrow product. The most important unresolved engineering issue is payout failure/recovery, followed by arbiter unavailability and accounting/fee assumptions. Do not deploy it for real funds or describe it as audited.
