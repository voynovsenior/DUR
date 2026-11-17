import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import {
  Address,
  Cell,
  contractAddress,
  loadStateInit,
  WalletContractV1R1,
  WalletContractV1R2,
  WalletContractV1R3,
  WalletContractV2R1,
  WalletContractV2R2,
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
} from '@ton/ton';

const TON_PROOF_PREFIX = Buffer.from('ton-proof-item-v2/', 'utf8');
const TON_CONNECT_PREFIX = Buffer.from('ton-connect', 'utf8');
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type TonProofRequest = {
  address: string;
  network: string;
  public_key?: string;
  proof: {
    timestamp: number;
    domain: { lengthBytes: number; value: string };
    signature: string;
    payload: string;
    state_init: string;
  };
};

export type TonProofOptions = {
  expectedDomain: string;
  expectedNetwork: string;
  nowSeconds?: number;
  maxAgeSeconds?: number;
  futureSkewSeconds?: number;
};

function extractKnownWalletPublicKey(stateInit: ReturnType<typeof loadStateInit>): Buffer | null {
  if (!stateInit.code || !stateInit.data) return null;

  const known = [
    { contract: WalletContractV1R1, layout: 'v1' },
    { contract: WalletContractV1R2, layout: 'v1' },
    { contract: WalletContractV1R3, layout: 'v1' },
    { contract: WalletContractV2R1, layout: 'v2' },
    { contract: WalletContractV2R2, layout: 'v2' },
    { contract: WalletContractV3R1, layout: 'v3' },
    { contract: WalletContractV3R2, layout: 'v3' },
    { contract: WalletContractV4, layout: 'v4' },
  ] as const;

  for (const item of known) {
    try {
      const wallet = item.contract.create({ workchain: 0, publicKey: Buffer.alloc(32) });
      if (!wallet.init.code.equals(stateInit.code)) continue;

      const data = stateInit.data.beginParse();
      if (item.layout === 'v1' || item.layout === 'v2') {
        data.loadUint(32);
      } else {
        data.loadUint(32);
        data.loadUint(32);
      }
      return data.loadBuffer(32);
    } catch {
      // A parser mismatch is not a reason to fall back to an untrusted client key.
    }
  }
  return null;
}

function decodeSignature(value: string): Buffer {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('invalid_signature_encoding');
  }
  const signature = Buffer.from(value, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== value) {
    throw new Error('invalid_signature_encoding');
  }
  return signature;
}

function buildProofDigest(address: Address, proof: TonProofRequest['proof']): Buffer {
  const domain = Buffer.from(proof.domain.value, 'utf8');
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain, 0);
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domain.length, 0);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE(BigInt(proof.timestamp), 0);

  const message = Buffer.concat([
    TON_PROOF_PREFIX,
    workchain,
    address.hash,
    domainLength,
    domain,
    timestamp,
    Buffer.from(proof.payload, 'utf8'),
  ]);
  const messageHash = createHash('sha256').update(message).digest();
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from([0xff, 0xff]), TON_CONNECT_PREFIX, messageHash]))
    .digest();
}

/**
 * Verifies TON Connect ton_proof for explicitly supported fixed-key wallet versions.
 * Unknown wallets are rejected. Client-provided public_key is only a consistency hint,
 * never the source of trust. Challenge creation/consumption must be handled server-side.
 */
export function verifyTonProof(
  request: TonProofRequest,
  options: TonProofOptions,
): { address: string; network: string; publicKey: string } {
  if (!request || typeof request !== 'object' || !request.proof) throw new Error('invalid_proof_request');
  if (request.network !== options.expectedNetwork) throw new Error('wrong_network');
  const expectedLabels = options.expectedDomain.split('.');
  const validExpectedDomain = options.expectedDomain.length <= 128 && expectedLabels.length >= 2 &&
    expectedLabels.every(label => label.length >= 1 && label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
  if (!validExpectedDomain || request.proof.domain?.value !== options.expectedDomain) {
    throw new Error('wrong_domain');
  }

  const proof = request.proof;
  if (!Number.isSafeInteger(proof.timestamp) || proof.timestamp <= 0) throw new Error('invalid_timestamp');
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = options.maxAgeSeconds ?? 600;
  const futureSkew = options.futureSkewSeconds ?? 30;
  if (proof.timestamp > now + futureSkew || now - proof.timestamp > maxAge) {
    throw new Error('expired_proof');
  }

  const domainBytes = Buffer.from(proof.domain.value, 'utf8');
  const payloadBytes = Buffer.from(proof.payload, 'utf8');
  if (proof.domain.lengthBytes !== domainBytes.length || domainBytes.length > 128 ||
      payloadBytes.length < 1 || payloadBytes.length > 128 ||
      domainBytes.length + payloadBytes.length > 222) {
    throw new Error('invalid_proof_lengths');
  }

  const stateInitCell = Cell.fromBase64(proof.state_init);
  const stateInit = loadStateInit(stateInitCell.beginParse());
  const address = Address.parse(request.address);
  const derivedAddress = contractAddress(address.workChain, stateInit);
  if (!derivedAddress.equals(address)) throw new Error('address_state_init_mismatch');

  const publicKey = extractKnownWalletPublicKey(stateInit);
  if (!publicKey || publicKey.length !== 32) throw new Error('unsupported_wallet');
  if (request.public_key !== undefined) {
    if (!/^[a-fA-F0-9]{64}$/.test(request.public_key) ||
        !publicKey.equals(Buffer.from(request.public_key, 'hex'))) {
      throw new Error('public_key_mismatch');
    }
  }

  const signature = decodeSignature(proof.signature);
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: 'der',
    type: 'spki',
  });
  const digest = buildProofDigest(address, proof);
  if (!verifySignature(null, digest, key, signature)) throw new Error('invalid_signature');

  return { address: address.toRawString(), network: request.network, publicKey: publicKey.toString('hex') };
}
