import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server';
import { openDatabase } from '../src/identity/database';

async function withServer(run: (base: string) => Promise<void>) {
  const db = openDatabase(':memory:');
  const server = createApiServer({ db, secureCookies: false });
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

test('health endpoint reports service status', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; service: string; version: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, 'dur-api');
    assert.equal(body.version, '0.3.0');
  });
});

test('unknown profile routes return not found', async () => {
  await withServer(async base => {
    const response = await fetch(`${base}/v1/profiles/example`);
    assert.equal(response.status, 404);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'profile_not_found');
  });
});
