import test from 'node:test';
import assert from 'node:assert/strict';
import { DurApiError, DurIssuerClient } from '../src/client';

test('issuer SDK sends authenticated JSON requests to the DUR API', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new DurIssuerClient({
    baseUrl: 'https://api.example.com/',
    apiKey: 'dur_issuer_unit_test_key',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: 'attestation-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.createAttestation({
    schemaId: 'dur.delivery.completed',
    schemaVersion: 1,
    subjectId: 'wallet:-3:0:abc',
    claim: { completed: true },
    evidenceRefs: ['ton:transaction:abc'],
  });

  assert.equal(calls[0].url, 'https://api.example.com/v1/attestations');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer dur_issuer_unit_test_key');
  assert.equal(new Headers(calls[0].init?.headers).get('content-type'), 'application/json');
});

test('issuer SDK exposes machine-readable API errors', async () => {
  const client = new DurIssuerClient({
    baseUrl: 'https://api.example.com',
    apiKey: 'dur_issuer_unit_test_key',
    fetchImpl: async () => new Response(JSON.stringify({ error: 'issuer_unauthorized' }), { status: 401 }),
  });

  await assert.rejects(
    () => client.getAttestation('missing'),
    (error: unknown) => error instanceof DurApiError && error.status === 401 && error.code === 'issuer_unauthorized',
  );
});

test('issuer SDK rejects invalid base URLs and empty keys', () => {
  assert.throws(() => new DurIssuerClient({ baseUrl: 'api.example.com', apiKey: 'key' }), /invalid_base_url/);
  assert.throws(() => new DurIssuerClient({ baseUrl: 'https://api.example.com', apiKey: '' }), /invalid_api_key/);
});
