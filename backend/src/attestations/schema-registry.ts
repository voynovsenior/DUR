import Ajv, { type AnySchema, type ValidateFunction } from 'ajv';
import type { DurDatabase } from '../identity/database';

export class AttestationSchemaRegistry {
  private readonly ajv = new Ajv({ allErrors: true, strict: true, validateSchema: true });

  constructor(private readonly db: DurDatabase) {
    const rows = this.db.prepare(`
      SELECT schema_id AS schemaId, schema_version AS schemaVersion, schema_json AS schemaJson
      FROM attestation_schemas WHERE status = 'active'
    `).all() as Array<{ schemaId: string; schemaVersion: number; schemaJson: string }>;
    for (const row of rows) {
      this.ajv.addSchema(JSON.parse(row.schemaJson) as AnySchema, this.key(row.schemaId, row.schemaVersion));
    }
  }

  private key(schemaId: string, version: number) {
    return `${schemaId}@${version}`;
  }

  register(schemaId: string, version: number, schema: unknown, nowSeconds = Math.floor(Date.now() / 1000)) {
    if (typeof schemaId !== 'string' || !/^[a-z][a-z0-9_.-]{2,119}$/.test(schemaId)) {
      throw new Error('invalid_schema_id');
    }
    if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid_schema_version');
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) throw new Error('invalid_json_schema');
    const candidate = schema as AnySchema;
    if (!this.ajv.validateSchema(candidate)) throw new Error('invalid_json_schema');
    const key = this.key(schemaId, version);
    if (this.db.prepare('SELECT 1 FROM attestation_schemas WHERE schema_id = ? AND schema_version = ?')
      .get(schemaId, version)) {
      throw new Error('schema_version_already_registered');
    }
    try {
      new Ajv({ allErrors: true, strict: true, validateSchema: true }).compile(candidate);
    } catch {
      throw new Error('invalid_json_schema');
    }
    this.db.prepare(`
      INSERT INTO attestation_schemas (schema_id, schema_version, schema_json, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(schemaId, version, JSON.stringify(candidate), nowSeconds);
    this.ajv.addSchema(candidate, key);
    return { schemaId, schemaVersion: version, status: 'active' as const };
  }

  validate(schemaId: string, version: number, claim: unknown) {
    const validator = this.ajv.getSchema(this.key(schemaId, version)) as ValidateFunction | undefined;
    if (!validator) throw new Error('schema_not_registered');
    if (!validator(claim)) throw new Error('claim_schema_validation_failed');
    return true;
  }

  get(schemaId: string, version: number) {
    const row = this.db.prepare(`
      SELECT schema_id AS schemaId, schema_version AS schemaVersion,
             schema_json AS schemaJson, status, created_at AS createdAt
      FROM attestation_schemas WHERE schema_id = ? AND schema_version = ?
    `).get(schemaId, version) as {
      schemaId: string; schemaVersion: number; schemaJson: string; status: string; createdAt: number;
    } | undefined;
    if (!row) return null;
    return {
      schemaId: row.schemaId,
      schemaVersion: row.schemaVersion,
      schema: JSON.parse(row.schemaJson) as AnySchema,
      status: row.status,
      createdAt: row.createdAt,
    };
  }
}
