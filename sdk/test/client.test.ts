import test from 'node:test';
import assert from 'node:assert/strict';
import { DurAdminClient, DurApiError, DurIssuerClient, DurSubjectClient } from '../src/client';

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

test('subject SDK sends cookie-authenticated reputation and dispute requests', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new DurSubjectClient({
    baseUrl: 'https://api.example.com',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ subjectId: 'wallet:-3:0:abc', reputation: {} }), { status: 200 });
    },
  });

  await client.getReputation('wallet:-3:0:abc');
  await client.openDispute('attestation/1', 'The stated delivery did not occur', ['https://evidence.example/1']);

  assert.equal(calls[0].url, 'https://api.example.com/v1/profiles/wallet%3A-3%3A0%3Aabc/reputation');
  assert.equal(calls[0].init?.credentials, 'include');
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), null);
  assert.equal(calls[1].url, 'https://api.example.com/v1/attestations/attestation%2F1/disputes');
  assert.equal(calls[1].init?.credentials, 'include');
});

test('admin SDK keeps bearer authentication on administrative routes', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new DurAdminClient({
    baseUrl: 'https://api.example.com',
    adminToken: 'server-side-admin-token',
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await client.setIssuerTrustTier('issuer/1', 'verified', 'Reviewed and approved');
  await client.resolveDispute('dispute-1', 'rejected', 'Evidence did not substantiate the complaint');
  await client.verifyTransaction('event-1', 250);

  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer server-side-admin-token');
  assert.equal(calls[0].url, 'https://api.example.com/v1/admin/issuers/issuer%2F1/trust-tier');
  assert.equal(calls[1].url, 'https://api.example.com/v1/admin/disputes/dispute-1/resolve');
  assert.equal(calls[2].url, 'https://api.example.com/v1/admin/indexer/events/event-1/verify-transaction');
});
