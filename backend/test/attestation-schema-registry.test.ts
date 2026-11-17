import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/identity/database';
import { AttestationSchemaRegistry } from '../src/attestations/schema-registry';

test('schema registry persists immutable versions and validates claims', () => {
  const db = openDatabase(':memory:');
  const registry = new AttestationSchemaRegistry(db);
  const schema = {
    type: 'object',
    required: ['completed'],
    properties: { completed: { type: 'boolean' } },
    additionalProperties: false,
  };
  registry.register('dur.delivery.completed', 1, schema, 1_800_000_000);
  assert.equal(registry.validate('dur.delivery.completed', 1, { completed: true }), true);
  assert.throws(
    () => registry.validate('dur.delivery.completed', 1, { completed: 'yes' }),
    /claim_schema_validation_failed/,
  );
  assert.throws(
    () => registry.register('dur.delivery.completed', 1, schema),
    /schema_version_already_registered/,
  );
  db.close();
});

test('schema registry reloads persisted schemas and rejects unknown versions', () => {
  const db = openDatabase(':memory:');
  const first = new AttestationSchemaRegistry(db);
  first.register('dur.review.completed', 1, { type: 'object', required: ['rating'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 } }, additionalProperties: false });
  const second = new AttestationSchemaRegistry(db);
  assert.equal(second.validate('dur.review.completed', 1, { rating: 5 }), true);
  assert.throws(() => second.validate('dur.review.completed', 2, { rating: 5 }), /schema_not_registered/);
  db.close();
});
