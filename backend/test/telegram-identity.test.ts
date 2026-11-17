import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyTelegramInitData } from '../src/identity/telegram';

const token = '123456:TEST_TOKEN_NOT_REAL';
const now = 1_800_000_000;

function signedInitData(overrides: Record<string, string> = {}) {
  const values = {
    auth_date: String(now),
    query_id: 'AAE-test-query',
    user: JSON.stringify({ id: 42, first_name: 'Test', username: 'tester' }),
    ...overrides,
  };
  const check = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...values, hash }).toString();
}

test('accepts correctly signed, fresh Telegram init data', () => {
  const result = verifyTelegramInitData(signedInitData(), {
    botToken: token,
    nowSeconds: now,
  });
  assert.equal(result.user.id, 42);
  assert.equal(result.user.username, 'tester');
  assert.equal(result.authDate, now);
});

test('rejects tampered init data', () => {
  const raw = signedInitData().replace('tester', 'attacker');
  assert.throws(
    () => verifyTelegramInitData(raw, { botToken: token, nowSeconds: now }),
    /invalid_signature/,
  );
});

test('rejects expired init data', () => {
  const raw = signedInitData({ auth_date: String(now - 4000) });
  assert.throws(
    () => verifyTelegramInitData(raw, { botToken: token, nowSeconds: now, maxAgeSeconds: 3600 }),
    /expired_init_data/,
  );
});

test('rejects duplicate parameters', () => {
  const raw = `${signedInitData()}&auth_date=${now}`;
  assert.throws(
    () => verifyTelegramInitData(raw, { botToken: token, nowSeconds: now }),
    /invalid_init_data/,
  );
});

test('rejects timestamps too far in the future', () => {
  const raw = signedInitData({ auth_date: String(now + 100) });
  assert.throws(
    () => verifyTelegramInitData(raw, { botToken: token, nowSeconds: now, futureSkewSeconds: 30 }),
    /invalid_auth_date/,
  );
});
