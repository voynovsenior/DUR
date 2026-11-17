import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { beginCell, storeStateInit } from '@ton/core';
import { WalletContractV4 } from '@ton/ton';
import { verifyTonProof, type TonProofRequest } from '../src/identity/ton-proof';

const DOMAIN = 'dur.example';
const NETWORK = '-3';
const NOW = 1_800_000_000;

function makeSignedRequest(): TonProofRequest {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey });
  const stateInit = beginCell().store(storeStateInit(wallet.init)).endCell().toBoc().toString('base64');
  const payload = 'test-single-use-challenge';
  const timestamp = NOW;

  const wc = Buffer.alloc(4);
  wc.writeInt32BE(wallet.address.workChain, 0);
  const domainBytes = Buffer.from(DOMAIN, 'utf8');
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(domainBytes.length, 0);
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64LE(BigInt(timestamp), 0);
  const message = Buffer.concat([
    Buffer.from('ton-proof-item-v2/', 'utf8'),
    wc,
    wallet.address.hash,
    domainLength,
    domainBytes,
    ts,
    Buffer.from(payload, 'utf8'),
  ]);
  const innerHash = createHash('sha256').update(message).digest();
  const digest = createHash('sha256')
    .update(Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect'), innerHash]))
    .digest();

  const privateSeed = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
  const privateKey = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), privateSeed]);
  const signature = sign(null, digest, {
    key: privateKey,
    format: 'der',
    type: 'pkcs8',
  }).toString('base64');

  return {
    address: wallet.address.toRawString(),
    network: NETWORK,
    public_key: publicKey.toString('hex'),
    proof: {
      timestamp,
      domain: { lengthBytes: domainBytes.length, value: DOMAIN },
      signature,
      payload,
      state_init: stateInit,
    },
  };
}

test('TON proof verifies a signature bound to address, domain, network and payload', () => {
  const request = makeSignedRequest();
  const result = verifyTonProof(request, {
    expectedDomain: DOMAIN,
    expectedNetwork: NETWORK,
    nowSeconds: NOW,
  });
  assert.equal(result.address, request.address);
  assert.equal(result.network, NETWORK);
  assert.equal(result.publicKey, request.public_key);
});

test('TON proof rejects wrong domain, network and tampered payload', () => {
  const request = makeSignedRequest();
  assert.throws(() => verifyTonProof(request, {
    expectedDomain: 'attacker.example',
    expectedNetwork: NETWORK,
    nowSeconds: NOW,
  }), /wrong_domain/);

  assert.throws(() => verifyTonProof(request, {
    expectedDomain: DOMAIN,
    expectedNetwork: '-239',
    nowSeconds: NOW,
  }), /wrong_network/);

  assert.throws(() => verifyTonProof({
    ...request,
    proof: { ...request.proof, payload: 'different-challenge' },
  }, {
    expectedDomain: DOMAIN,
    expectedNetwork: NETWORK,
    nowSeconds: NOW,
  }), /invalid_signature/);
});
