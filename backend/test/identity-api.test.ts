import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApiServer } from '../src/server';
import { openDatabase } from '../src/identity/database';

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

async function withServer(run: (base: string) => Promise<void>) {
  const db = openDatabase(':memory:');
  const server = createApiServer({ db, botToken: token, secureCookies: false, tonProofDomain: 'dur.example', tonNetworkId: '-3', adminToken: 'unit-test-admin-value' });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await run(`http://127.0.0.1:${address.port}`);
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

test('issuer admin creates an issuer and its key can issue and revoke attestations', async () => {
  await withServer(async base => {
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

    const created = await fetch(`${base}/v1/admin/issuers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer unit-test-admin-value' },
      body: JSON.stringify({ displayName: 'Test Marketplace', issuerType: 'marketplace' }),
    });
    assert.equal(created.status, 201);
    const issuer = await created.json() as { issuer: { id: string }; apiKey: string };
    assert.ok(issuer.apiKey.startsWith('dur_issuer_'));

    const issued = await fetch(`${base}/v1/attestations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${issuer.apiKey}` },
      body: JSON.stringify({
        schemaId: 'dur.delivery.completed',
        schemaVersion: 1,
        subjectId: 'wallet:-3:0:abc123',
        claim: { completed: true },
        evidenceRefs: ['ton:transaction:abc123'],
      }),
    });
    assert.equal(issued.status, 201);
    const attestation = await issued.json() as { id: string; claimDigest: string };
    assert.match(attestation.claimDigest, /^[a-f0-9]{64}$/);

    const revoke = await fetch(`${base}/v1/attestations/${attestation.id}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${issuer.apiKey}` },
      body: JSON.stringify({ reason: 'Order disputed' }),
    });
    assert.equal(revoke.status, 200);
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
