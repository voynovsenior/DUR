export type EscrowState =
  | 'created'
  | 'accepted'
  | 'funded'
  | 'disputed'
  | 'released'
  | 'refunded'
  | 'cancelled';

export type EscrowAgreement = {
  id: string;
  network: '-3';
  buyer: string;
  seller: string;
  asset: string;
  amount: string;
  termsHash: string;
  fundingDeadline: number;
  completionDeadline: number;
  disputeDeadline: number;
  state: EscrowState;
  version: number;
};

const transitions: Record<EscrowState, readonly EscrowState[]> = {
  created: ['accepted', 'cancelled'],
  accepted: ['funded', 'cancelled'],
  funded: ['released', 'refunded', 'disputed'],
  disputed: ['released', 'refunded'],
  released: [],
  refunded: [],
  cancelled: [],
};

export function createEscrowAgreement(
  input: Omit<EscrowAgreement, 'state' | 'version'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): EscrowAgreement {
  if (!input.id || input.id.length > 128) throw new Error('invalid_deal_id');
  if (input.network !== '-3') throw new Error('unsupported_network');
  if (!/^0:[a-fA-F0-9]{64}$/.test(input.buyer) || !/^0:[a-fA-F0-9]{64}$/.test(input.seller)) {
    throw new Error('invalid_participant_address');
  }
  if (input.buyer.toLowerCase() === input.seller.toLowerCase()) throw new Error('participants_must_differ');
  if (!input.asset || input.asset.length > 128) throw new Error('invalid_asset');
  if (!/^[1-9][0-9]*$/.test(input.amount)) throw new Error('invalid_amount');
  if (!/^[a-fA-F0-9]{64}$/.test(input.termsHash)) throw new Error('invalid_terms_hash');
  if (!Number.isSafeInteger(input.fundingDeadline) || input.fundingDeadline <= nowSeconds ||
      !Number.isSafeInteger(input.completionDeadline) || input.completionDeadline < input.fundingDeadline ||
      !Number.isSafeInteger(input.disputeDeadline) || input.disputeDeadline < input.completionDeadline) {
    throw new Error('invalid_deadline_sequence');
  }
  return { ...input, state: 'created', version: 1 };
}

/**
 * Pure state transition model. It does not verify signatures, funds, participants,
 * deadlines, or chain state and must not be used as a substitute for an on-chain contract.
 */
export function transitionEscrow(agreement: EscrowAgreement, nextState: EscrowState): EscrowAgreement {
  if (!transitions[agreement.state].includes(nextState)) {
    throw new Error('invalid_state_transition');
  }
  return { ...agreement, state: nextState, version: agreement.version + 1 };
}

export function isEscrowTerminal(state: EscrowState) {
  return transitions[state].length === 0;
}
