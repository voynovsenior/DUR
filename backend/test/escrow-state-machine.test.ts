import test from 'node:test';
import assert from 'node:assert/strict';
import { createEscrowAgreement, isEscrowTerminal, transitionEscrow } from '../src/escrow/state-machine';

const base = {
  id: 'deal-001',
  network: '-3' as const,
  buyer: `0:${'1'.repeat(64)}`,
  seller: `0:${'2'.repeat(64)}`,
  asset: 'TON',
  amount: '1000000000',
  termsHash: 'a'.repeat(64),
  fundingDeadline: 1_800_000_100,
  completionDeadline: 1_800_000_200,
  disputeDeadline: 1_800_000_300,
};

test('escrow model validates terms and creates a versioned initial state', () => {
  const agreement = createEscrowAgreement(base, 1_800_000_000);
  assert.equal(agreement.state, 'created');
  assert.equal(agreement.version, 1);
});

test('escrow model permits only documented transitions', () => {
  let agreement = createEscrowAgreement(base, 1_800_000_000);
  agreement = transitionEscrow(agreement, 'accepted');
  agreement = transitionEscrow(agreement, 'funded');
  agreement = transitionEscrow(agreement, 'disputed');
  agreement = transitionEscrow(agreement, 'refunded');
  assert.equal(agreement.version, 5);
  assert.equal(isEscrowTerminal(agreement.state), true);
  assert.throws(() => transitionEscrow(agreement, 'released'), /invalid_state_transition/);
});

test('escrow model permits either mutually agreed terminal dispute outcome', () => {
  let agreement = createEscrowAgreement(base, 1_800_000_000);
  agreement = transitionEscrow(agreement, 'accepted');
  agreement = transitionEscrow(agreement, 'funded');
  agreement = transitionEscrow(agreement, 'disputed');
  const released = transitionEscrow(agreement, 'released');
  const refunded = transitionEscrow(agreement, 'refunded');
  assert.equal(released.state, 'released');
  assert.equal(refunded.state, 'refunded');
  assert.equal(isEscrowTerminal(released.state), true);
  assert.equal(isEscrowTerminal(refunded.state), true);
});


test('escrow transition graph is exhaustive and terminal states are immutable', () => {
  const paths: Record<string, Array<'accepted' | 'funded' | 'disputed' | 'released' | 'refunded' | 'cancelled'>> = {
    created: [],
    accepted: ['accepted'],
    funded: ['accepted', 'funded'],
    disputed: ['accepted', 'funded', 'disputed'],
    released: ['accepted', 'funded', 'released'],
    refunded: ['accepted', 'funded', 'refunded'],
    cancelled: ['cancelled'],
  };
  const expected: Record<string, string[]> = {
    created: ['accepted', 'cancelled'],
    accepted: ['funded', 'cancelled'],
    funded: ['released', 'refunded', 'disputed'],
    disputed: ['released', 'refunded'],
    released: [],
    refunded: [],
    cancelled: [],
  };
  const states = Object.keys(expected);
  for (const state of states) {
    let agreement = createEscrowAgreement(base, 1_800_000_000);
    for (const next of paths[state]) agreement = transitionEscrow(agreement, next);
    assert.equal(agreement.state, state);
    for (const next of states) {
      if (expected[state].includes(next)) {
        const updated = transitionEscrow(agreement, next as typeof agreement.state);
        assert.equal(updated.state, next);
        assert.equal(updated.version, agreement.version + 1);
        assert.equal(agreement.state, state, 'transition must not mutate the original agreement');
      } else {
        assert.throws(
          () => transitionEscrow(agreement, next as typeof agreement.state),
          /invalid_state_transition/,
          `unexpected transition ${state} -> ${next}`,
        );
      }
    }
  }
});

test('escrow model rejects unsafe amounts, invalid parties and deadline order', () => {
  assert.throws(() => createEscrowAgreement({ ...base, amount: '1.2' }, 1_800_000_000), /invalid_amount/);
  assert.throws(() => createEscrowAgreement({ ...base, seller: base.buyer }, 1_800_000_000), /participants_must_differ/);
  assert.throws(() => createEscrowAgreement({ ...base, disputeDeadline: 1_800_000_150 }, 1_800_000_000), /invalid_deadline_sequence/);
});
