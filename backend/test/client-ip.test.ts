import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClientIp } from '../src/server';

test('ignores forwarded headers from untrusted peers', () => {
  assert.equal(resolveClientIp('198.51.100.10', '203.0.113.9', new Set()), '198.51.100.10');
});

test('uses forwarded client address only for an explicitly trusted proxy', () => {
  assert.equal(
    resolveClientIp('172.30.0.2', '203.0.113.9', new Set(['172.30.0.2'])),
    '203.0.113.9',
  );
});

test('falls back to the proxy address when forwarded address is malformed', () => {
  assert.equal(
    resolveClientIp('172.30.0.2', 'not-an-ip', new Set(['172.30.0.2'])),
    '172.30.0.2',
  );
});

test('normalizes IPv4-mapped IPv6 proxy addresses', () => {
  assert.equal(
    resolveClientIp('::ffff:172.30.0.2', '203.0.113.9', new Set(['172.30.0.2'])),
    '203.0.113.9',
  );
});
