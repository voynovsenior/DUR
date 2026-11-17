import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server';

test('health endpoint reports service status', async () => {
  const server = createApiServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean; service: string };
    assert.equal(body.ok, true);
    assert.equal(body.service, 'dur-api');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('profile endpoint does not fabricate reputation data', async () => {
  const server = createApiServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/profiles/example`);
    assert.equal(response.status, 501);
    const body = await response.json() as { error: string };
    assert.equal(body.error, 'not_implemented');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
