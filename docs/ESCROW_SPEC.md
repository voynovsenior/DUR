# DUR Modular Escrow — Testnet Specification Draft

Status: experimental Tolk contract prototype v0.2.0. Acton compilation, formatting/linting and 24 emulator tests pass (including deadline-boundary, terminal-replay and bilateral dispute-vote cases). The contract is not deployed, has not undergone an independent audit, and is not approved for real funds. Any deployment consideration is Testnet-only.

See [Escrow Threat Model](ESCROW_THREAT_MODEL.md) for the current threat register, payout/bounce risk, arbiter-availability risk, required invariants and release gates. The threat model is a maintainer draft, not an audit.

## 1. Design boundary

Escrow must be independently usable. Reputation may consume verified completed-deal events, but an escrow contract must not depend on the reputation engine to release or refund funds.

The first implementation target is TON Testnet. Mainnet and real-value use are excluded until independent security review.

## 2. Lifecycle

| State | Meaning | Permitted next states |
|---|---|---|
| Created | Terms and participants recorded; no funds accepted | Accepted, Cancelled |
| Accepted | Counterparty accepted the exact terms | Funded, Cancelled |
| Funded | Required value is confirmed in contract state | Released, Refunded, Disputed |
| Disputed | A party raised a dispute within the permitted window | Released, Refunded |
| Released | Funds sent to the designated recipient | Terminal |
| Refunded | Funds returned according to the agreed rules | Terminal |
| Cancelled | Agreement ended before funding | Terminal |

The first Tolk prototype fixes the transitions and deadlines in contract storage. The terms and deadline fields are stored in a referenced cell to stay within TON's 1023-bit cell limit. Before accepting funds, the contract checks a positive amount, nonzero deal ID and terms hash, distinct buyer/seller/arbiter addresses, ordered deadlines, and exact TON funding. It supports seller acceptance, seller completion, buyer approval, participant disputes, arbiter resolution, bilateral dispute resolution, buyer refund after the dispute window when completion was not marked, and seller finalization after the dispute window when completion was marked and no dispute is open. During a dispute, either party may submit or revise its own release/refund vote. A matching buyer and seller vote finalizes the corresponding outcome; conflicting votes leave the agreement disputed. The arbiter retains the independent resolution path.

## 3. Required agreement fields

- unique deal identifier;
- TON network and contract address;
- buyer and seller addresses;
- exact asset and amount;
- immutable terms hash;
- funding deadline;
- completion and dispute deadlines;
- release/refund conditions;
- dispute resolution policy identifier;
- state version and event sequence.

## 4. Security invariants

1. Only authorized participants may perform their designated transitions.
2. Terms cannot be changed after acceptance without a new agreement.
3. Funds cannot be released or refunded more than once.
4. A deal cannot become Funded without verified value in contract state.
5. A timeout cannot bypass an active dispute.
6. Every successful lifecycle transition emits a versioned external event with a monotonic per-deal sequence. The proof verifier can extract v1 events from proof-verified transactions; source-contract allowlisting and semantic verification remain pending.
7. Amounts, asset identifiers and recipient addresses must be validated on-chain.
8. Contract accounting must preserve all deposited value except explicitly specified network fees.
9. Reputation integration must not be able to move funds.
10. No privileged upgrade or administrator key may silently alter existing deal terms.

## 5. Testing gates

- state-machine unit tests for every transition;
- property-based tests for conservation and terminal-state invariants;
- adversarial tests for replay, duplicate messages, malformed payloads and timing boundaries;
- sandbox/Testnet integration tests;
- independent contract review and audit before any mainnet consideration.

The UI remains a design preview and is not connected to this contract. The current 0.2.0 prototype adds bilateral dispute-resolution votes and versioned external lifecycle events while retaining arbiter resolution. Conflicting votes do not move funds and leave the deal disputed. This does not remove the indefinite-lock risk if the parties disagree and the arbiter is unavailable. An open dispute has no resolution timeout: if the arbiter becomes unavailable, the escrow can remain locked indefinitely. Property-based conservation tests, deployment-reserve calibration, payout gas/bounce behavior, source-contract identity and semantic event verification, and independent accounting/security review remain outstanding. No real funds or Mainnet use are permitted.
