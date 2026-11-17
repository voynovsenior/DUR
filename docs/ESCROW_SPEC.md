# DUR Modular Escrow — Testnet Specification Draft

Status: specification plus a pure off-chain state-transition model with tests. No executable TON escrow contract is deployed or available for real funds. The model does not verify signatures, participant authority, deadlines at chain level, or deposited funds.

## 1. Design boundary

Escrow must be independently usable. Reputation may consume verified completed-deal events, but an escrow contract must not depend on the reputation engine to release or refund funds.

The first implementation target is TON Testnet. Mainnet and real-value use are excluded until independent security review.

## 2. Lifecycle

| State | Meaning | Permitted next states |
|---|---|---|
| Created | Terms and participants recorded; no funds accepted | Accepted, Cancelled |
| Accepted | Counterparty accepted the exact terms | Funded, Cancelled |
| Funded | Required value is confirmed in contract state | Released, Refunded, Disputed |
| Disputed | A party raised a dispute within the permitted window | Resolved, Refunded |
| Released | Funds sent to the designated recipient | Terminal |
| Refunded | Funds returned according to the agreed rules | Terminal |
| Resolved | A dispute resolution action completed | Released, Refunded |
| Cancelled | Agreement ended before funding | Terminal |

Exact transitions, deadlines and resolution authority must be fixed in the contract specification before implementation.

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
6. Every transition must be replay-resistant and emit an unambiguous event.
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

The current UI is a design preview only. It does not accept, lock, transfer or release funds.
