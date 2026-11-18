import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApiServer } from '../src/server';
import { openDatabase } from '../src/identity/database';
import { AttestationRegistry } from '../src/attestations/registry';

const token = '123456:LOCAL_TEST_TOKEN';
const now = Math.floor(Date.now() / 1000);

function initData(authDate = now) {
  const fields = {
    auth_date: String(authDate),
    user: JSON.stringify({ id: 987654, first_name: 'DUR Test', username: 'dur_test' }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

async function withServer(run: (base: string, db: ReturnType<typeof openDatabase>) => Promise<void>) {
  const db = openDatabase(':memory:');
  const server = createApiServer({ db, botToken: token, secureCookies: false, tonProofDomain: 'dur.example', tonNetworkId: '-3', adminToken: 'unit-test-admin-value' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`, db);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
}

test('Telegram login creates a session and /me returns the verified account', async () => {
  await withServer(async base => {
    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.ok(setCookie?.includes('HttpOnly'));
    assert.ok(setCookie?.includes('SameSite=Strict'));
    const sessionCookie = setCookie!.split(';')[0];

    const me = await fetch(`${base}/v1/auth/me`, { headers: { cookie: sessionCookie } });
    assert.equal(me.status, 200);
    const body = await me.json() as { authenticated: boolean; user: { telegramId: string; firstName: string } };
    assert.equal(body.authenticated, true);
    assert.equal(body.user.telegramId, '987654');
    assert.equal(body.user.firstName, 'DUR Test');
  });
});

test('Telegram login rejects invalid signatures', async () => {
  await withServer(async base => {
    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData().replace('dur_test', 'forged') }),
    });
    assert.equal(login.status, 401);
  });
});

test('logout revokes the server-side session', async () => {
  await withServer(async base => {
    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    const sessionCookie = login.headers.get('set-cookie')!.split(';')[0];

    const logout = await fetch(`${base}/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    assert.equal(logout.status, 200);

    const me = await fetch(`${base}/v1/auth/me`, { headers: { cookie: sessionCookie } });
    assert.equal(me.status, 401);
  });
});

test('auth endpoints do not create sessions when Telegram token is absent', async () => {
  const db = openDatabase(':memory:');
  const server = createApiServer({ db, botToken: '', secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    assert.equal(response.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});

test('Telegram login rejects non-JSON request bodies', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'initData=not-json',
    });
    assert.equal(response.status, 415);
  });
});

test('Telegram login rejects expired initData', async () => {
  await withServer(async base => {
    const expired = initData(now - 60 * 60 - 1);
    const response = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: expired }),
    });
    assert.equal(response.status, 401);
  });
});

test('TON proof challenge requires a verified Telegram session and is bound to that session', async () => {
  await withServer(async base => {
    const anonymous = await fetch(`${base}/v1/auth/ton/challenge`, { method: 'POST' });
    assert.equal(anonymous.status, 401);

    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    const sessionCookie = login.headers.get('set-cookie')!.split(';')[0];

    const challenge = await fetch(`${base}/v1/auth/ton/challenge`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    assert.equal(challenge.status, 200);
    const attemptCookie = challenge.headers.get('set-cookie')!.split(';')[0];
    const body = await challenge.json() as { payload: string; expiresAt: number };
    assert.ok(body.payload.length > 20);
    assert.ok(body.expiresAt > Math.floor(Date.now() / 1000));

    const invalidProof = await fetch(`${base}/v1/auth/ton/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${sessionCookie}; ${attemptCookie}` },
      body: JSON.stringify({ address: '0:invalid', network: '-3', proof: { payload: body.payload } }),
    });
    assert.equal(invalidProof.status, 401);
  });
});

test('issuer issuance requires a registered schema and current wallet-owner consent', async () => {
  await withServer(async (base, db) => {
    const schema = await fetch(`${base}/v1/admin/schemas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({
        schemaId: 'dur.delivery.completed',
        schemaVersion: 1,
        schema: {
          type: 'object',
          required: ['completed'],
          properties: { completed: { type: 'boolean' } },
          additionalProperties: false,
        },
      }),
    });
    assert.equal(schema.status, 201);
    assert.equal((await fetch(`${base}/v1/schemas/dur.delivery.completed/1`)).status, 200);
    assert.equal((await fetch(`${base}/v1/schemas`)).status, 200);

    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json() as { user: { id: string } };
    const sessionCookie = login.headers.get('set-cookie')!.split(';')[0];
    const walletAddress = `0:${'a'.repeat(64)}`;
    db.prepare(`
      INSERT INTO wallet_links (id, user_id, network, address, public_key, linked_at)
      VALUES (?, ?, '-3', ?, ?, ?)
    `).run('test-wallet-link', loginBody.user.id, walletAddress, 'b'.repeat(64), now);

    const created = await fetch(`${base}/v1/admin/issuers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ displayName: 'Test Marketplace', issuerType: 'marketplace' }),
    });
    assert.equal(created.status, 201);
    const issuer = await created.json() as { issuer: { id: string }; apiKey: string };
    const issuerDirectory = await fetch(`${base}/v1/issuers`);
    assert.equal(issuerDirectory.status, 200);
    const subjectId = `wallet:-3:${walletAddress}`;

    const issue = (claim: unknown) => fetch(`${base}/v1/attestations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${issuer.apiKey}` },
      body: JSON.stringify({
        schemaId: 'dur.delivery.completed',
        schemaVersion: 1,
        subjectId,
        claim,
        evidenceRefs: ['ton:transaction:abc123'],
      }),
    });

    assert.equal((await issue({ completed: true })).status, 403);

    const consent = await fetch(`${base}/v1/auth/consents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({
        walletAddress,
        issuerId: issuer.issuer.id,
        schemaId: 'dur.delivery.completed',
        schemaVersion: 1,
        purpose: 'Issue delivery completion attestations',
      }),
    });
    assert.equal(consent.status, 201);
    const consentBody = await consent.json() as { id: string; expiresAt: number };
    assert.ok(consentBody.expiresAt > now);

    assert.equal((await issue({ completed: 'yes' })).status, 400);
    const issued = await issue({ completed: true });
    assert.equal(issued.status, 201);
    const attestation = await issued.json() as { id: string; claimDigest: string };
    assert.match(attestation.claimDigest, /^[a-f0-9]{64}$/);

    const revoked = await fetch(`${base}/v1/attestations/${attestation.id}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${issuer.apiKey}` },
      body: JSON.stringify({ reason: 'Order was disputed' }),
    });
    assert.equal(revoked.status, 200);

    const revokeConsent = await fetch(`${base}/v1/auth/consents/${consentBody.id}/revoke`, {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    assert.equal(revokeConsent.status, 200);
    assert.equal((await issue({ completed: true })).status, 403);
  });
});

test('read-only indexer endpoints expose Testnet status and validate query filters', async () => {
  await withServer(async base => {
    const status = await fetch(`${base}/v1/indexer/status`);
    assert.equal(status.status, 200);
    const statusBody = await status.json() as { network: string; mode: string; trust: string; checkpoint: unknown };
    assert.equal(statusBody.network, 'ton-testnet');
    assert.equal(statusBody.mode, 'manual_sync');
    assert.equal(statusBody.trust, 'provider_indexed_data_unverified');
    assert.equal(statusBody.checkpoint, null);

    const events = await fetch(`${base}/v1/indexer/events?limit=10&status=unverified`);
    assert.equal(events.status, 200);
    const eventsBody = await events.json() as { events: unknown[]; trust: string };
    assert.deepEqual(eventsBody.events, []);
    assert.equal(eventsBody.trust, 'provider_indexed_data_unverified');

    const invalid = await fetch(`${base}/v1/indexer/events?limit=1000`);
    assert.equal(invalid.status, 400);
  });
});
test('CORS preflight permits the authorization header only for the configured origin', async () => {
  const db = openDatabase(':memory:');
  const server = createApiServer({ db, allowedOrigin: 'https://app.dur.example', secureCookies: false });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const allowed = await fetch(`http://127.0.0.1:${address.port}/v1/indexer/status`, {
      method: 'OPTIONS',
      headers: { origin: 'https://app.dur.example', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-headers'), 'content-type, authorization');

    const denied = await fetch(`http://127.0.0.1:${address.port}/v1/indexer/status`, {
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(denied.status, 403);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});

test('Telegram login applies a per-IP fixed-window rate limit', async () => {
  await withServer(async base => {
    const responses: Response[] = [];
    for (let index = 0; index < 11; index++) {
      responses.push(await fetch(`${base}/v1/auth/telegram`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }));
    }
    assert.equal(responses[0].status, 400);
    assert.equal(responses[9].status, 400);
    assert.equal(responses[10].status, 429);
    assert.ok(Number(responses[10].headers.get('retry-after')) > 0);
  });
});

test('admin trust review enables an owner-only reputation projection', async () => {
  await withServer(async (base, db) => {
    const createdResponse = await fetch(`${base}/v1/admin/issuers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ displayName: 'Reviewed Marketplace', issuerType: 'marketplace' }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { issuer: { id: string } };

    const tierResponse = await fetch(`${base}/v1/admin/issuers/${created.issuer.id}/trust-tier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ trustTier: 'verified', reason: 'Manual issuer policy review completed' }),
    });
    assert.equal(tierResponse.status, 200);

    const registry = new AttestationRegistry(db);
    const subjectId = `wallet:-3:0:${'a'.repeat(64)}`;
    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    assert.equal(login.status, 200);
    const sessionCookie = login.headers.get('set-cookie')!.split(';')[0];
    const loginBody = await login.json() as { user: { id: string } };
    db.prepare(`
      INSERT INTO wallet_links (id, user_id, network, address, public_key, linked_at)
      VALUES (?, ?, '-3', ?, ?, ?)
    `).run('reputation-wallet-link', loginBody.user.id, '0:' + 'a'.repeat(64), 'b'.repeat(64), now);
    registry.issue(created.issuer.id, {
      schemaId: 'dur.reputation.sample',
      schemaVersion: 1,
      subjectId,
      claim: { reputation: { dimensions: { reliability: 92, delivery: 88 } } },
      evidenceRefs: ['https://example.org/evidence/1'],
    });

    const anonymousProfile = await fetch(`${base}/v1/profiles/${subjectId}/reputation`);
    assert.equal(anonymousProfile.status, 401);
    const profile = await fetch(`${base}/v1/profiles/${subjectId}/reputation`, { headers: { cookie: sessionCookie } });
    assert.equal(profile.status, 200);
    const body = await profile.json() as {
      subjectId: string;
      reputation: {
        methodologyVersion: string;
        dimensions: {
          reliability: { value: number | null; evidenceCount: number };
          delivery: { value: number | null };
          communication: { value: number | null };
        };
      };
    };
    assert.equal(body.subjectId, subjectId);
    assert.equal(body.reputation.methodologyVersion, '0.1.0');
    assert.equal(body.reputation.dimensions.reliability.value, 92);
    assert.equal(body.reputation.dimensions.reliability.evidenceCount, 1);
    assert.equal(body.reputation.dimensions.delivery.value, 88);
    assert.equal(body.reputation.dimensions.communication.value, null);

    const invalid = await fetch(`${base}/v1/profiles/not-a-wallet/reputation`, { headers: { cookie: sessionCookie } });
    assert.equal(invalid.status, 400);
  });
});

test('wallet owner can dispute attestations and reviewed outcomes control reputation eligibility', async () => {
  await withServer(async (base, db) => {
    const issuerResponse = await fetch(`${base}/v1/admin/issuers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ displayName: 'Dispute Test Issuer', issuerType: 'marketplace' }),
    });
    assert.equal(issuerResponse.status, 201);
    const issuerBody = await issuerResponse.json() as { issuer: { id: string } };

    const tierResponse = await fetch(`${base}/v1/admin/issuers/${issuerBody.issuer.id}/trust-tier`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ trustTier: 'verified', reason: 'Issuer passed a documented review' }),
    });
    assert.equal(tierResponse.status, 200);

    const login = await fetch(`${base}/v1/auth/telegram`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ initData: initData() }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const loginBody = await login.json() as { user: { id: string } };
    const subjectId = `wallet:-3:0:${'c'.repeat(64)}`;
    db.prepare(`
      INSERT INTO wallet_links (id, user_id, network, address, public_key, linked_at)
      VALUES (?, ?, '-3', ?, ?, ?)
    `).run('dispute-wallet-link', loginBody.user.id, '0:' + 'c'.repeat(64), 'd'.repeat(64), now);

    const registry = new AttestationRegistry(db);
    const attestation = registry.issue(issuerBody.issuer.id, {
      schemaId: 'dur.reputation.dispute-test',
      schemaVersion: 1,
      subjectId,
      claim: { reputation: { dimensions: { reliability: 95 } } },
      evidenceRefs: ['https://example.org/dispute-test'],
    });

    const before = await fetch(`${base}/v1/profiles/${subjectId}/reputation`, { headers: { cookie } });
    assert.equal((await before.json() as { reputation: { dimensions: { reliability: { value: number | null } } } }).reputation.dimensions.reliability.value, 95);

    const opened = await fetch(`${base}/v1/attestations/${attestation.id}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'The reported delivery did not occur', evidenceRefs: ['https://example.org/complaint'] }),
    });
    assert.equal(opened.status, 201);
    const disputeBody = await opened.json() as { dispute: { id: string; status: string } };
    assert.equal(disputeBody.dispute.status, 'open');

    const list = await fetch(`${base}/v1/auth/disputes`, { headers: { cookie } });
    assert.equal(list.status, 200);
    assert.equal((await list.json() as { disputes: unknown[] }).disputes.length, 1);

    const whileOpen = await fetch(`${base}/v1/profiles/${subjectId}/reputation`, { headers: { cookie } });
    assert.equal((await whileOpen.json() as { reputation: { dimensions: { reliability: { value: number | null } } } }).reputation.dimensions.reliability.value, null);

    const rejected = await fetch(`${base}/v1/admin/disputes/${disputeBody.dispute.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ status: 'rejected', reason: 'Submitted material did not substantiate the dispute' }),
    });
    assert.equal(rejected.status, 200);

    const afterRejected = await fetch(`${base}/v1/profiles/${subjectId}/reputation`, { headers: { cookie } });
    assert.equal((await afterRejected.json() as { reputation: { dimensions: { reliability: { value: number | null } } } }).reputation.dimensions.reliability.value, 95);

    const second = await fetch(`${base}/v1/attestations/${attestation.id}/disputes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'Additional evidence indicates the claim was incorrect' }),
    });
    assert.equal(second.status, 201);
    const secondBody = await second.json() as { dispute: { id: string } };

    const upheld = await fetch(`${base}/v1/admin/disputes/${secondBody.dispute.id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ status: 'upheld', reason: 'Independent review confirmed the reported issue' }),
    });
    assert.equal(upheld.status, 200);

    const afterUpheld = await fetch(`${base}/v1/profiles/${subjectId}/reputation`, { headers: { cookie } });
    assert.equal((await afterUpheld.json() as { reputation: { dimensions: { reliability: { value: number | null } } } }).reputation.dimensions.reliability.value, null);
  });
});
