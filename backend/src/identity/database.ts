import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type DurDatabase = InstanceType<typeof Database>;

export function openDatabase(filename = process.env.DUR_DATABASE_PATH ?? './data/dur.sqlite'): DurDatabase {
  if (filename !== ':memory:' && !filename.startsWith('file:')) {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const initialMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!initialMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          telegram_id TEXT NOT NULL UNIQUE,
          telegram_username TEXT,
          first_name TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }

  const walletMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 2').get();
  if (!walletMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_links (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          network TEXT NOT NULL,
          address TEXT NOT NULL,
          public_key TEXT NOT NULL,
          linked_at INTEGER NOT NULL,
          UNIQUE (network, address)
        );
        CREATE INDEX IF NOT EXISTS wallet_links_user_id_idx ON wallet_links(user_id);
        CREATE TABLE IF NOT EXISTS ton_proof_challenges (
          payload_hash TEXT PRIMARY KEY,
          attempt_hash TEXT NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ton_proof_challenges_expires_at_idx ON ton_proof_challenges(expires_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }

  const attestationMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 3').get();
  if (!attestationMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS issuers (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          policy_version INTEGER NOT NULL,
          trust_tier TEXT NOT NULL DEFAULT 'unverified',
          status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS issuer_api_keys (
          key_hash TEXT PRIMARY KEY,
          issuer_id TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          revoked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS issuer_api_keys_issuer_id_idx ON issuer_api_keys(issuer_id);
        CREATE TABLE IF NOT EXISTS attestations (
          id TEXT PRIMARY KEY,
          schema_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          issuer_id TEXT NOT NULL REFERENCES issuers(id),
          subject_id TEXT NOT NULL,
          claim_json TEXT NOT NULL,
          claim_digest TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL,
          issued_at INTEGER NOT NULL,
          expires_at INTEGER,
          status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
          revoked_at INTEGER,
          revocation_reason TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS attestations_subject_idx ON attestations(subject_id, issued_at DESC);
        CREATE INDEX IF NOT EXISTS attestations_issuer_idx ON attestations(issuer_id, issued_at DESC);
        CREATE TABLE IF NOT EXISTS attestation_events (
          id TEXT PRIMARY KEY,
          attestation_id TEXT NOT NULL REFERENCES attestations(id),
          actor_issuer_id TEXT REFERENCES issuers(id),
          event_type TEXT NOT NULL CHECK (event_type IN ('issued', 'revoked', 'expired')),
          occurred_at INTEGER NOT NULL,
          reason TEXT
        );
        CREATE INDEX IF NOT EXISTS attestation_events_attestation_idx ON attestation_events(attestation_id, occurred_at);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const indexerMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 4').get();
  if (!indexerMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS indexer_checkpoints (
          network TEXT PRIMARY KEY,
          seqno INTEGER NOT NULL,
          root_hash TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chain_events (
          id TEXT PRIMARY KEY,
          network TEXT NOT NULL,
          account TEXT NOT NULL,
          lt TEXT NOT NULL,
          tx_hash TEXT NOT NULL,
          event_index INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          source_contract TEXT NOT NULL,
          source_code_hash TEXT,
          decoder_version TEXT NOT NULL,
          verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'unverified', 'quarantined')),
          observed_at INTEGER NOT NULL,
          UNIQUE (network, account, lt, tx_hash, event_index)
        );
        CREATE INDEX IF NOT EXISTS chain_events_network_type_idx ON chain_events(network, event_type, observed_at DESC);
        CREATE INDEX IF NOT EXISTS chain_events_account_idx ON chain_events(network, account, observed_at DESC);
        CREATE TABLE IF NOT EXISTS chain_event_reviews (
          id TEXT PRIMARY KEY,
          chain_event_id TEXT NOT NULL REFERENCES chain_events(id),
          status TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const schemaRegistryMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 5').get();
  if (!schemaRegistryMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attestation_schemas (
          schema_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          schema_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('active', 'deprecated')),
          created_at INTEGER NOT NULL,
          PRIMARY KEY (schema_id, schema_version)
        );
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (5, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const consentMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 6').get();
  if (!consentMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS subject_consents (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          network TEXT NOT NULL,
          wallet_address TEXT NOT NULL,
          issuer_id TEXT NOT NULL REFERENCES issuers(id) ON DELETE CASCADE,
          schema_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          purpose TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER,
          revoked_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS subject_consents_lookup_idx
          ON subject_consents(network, wallet_address, issuer_id, schema_id, schema_version, revoked_at, expires_at);
        CREATE INDEX IF NOT EXISTS subject_consents_user_idx ON subject_consents(user_id, created_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (6, ?)').run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const reputationMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 7').get();
  if (!reputationMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS issuer_trust_events (
          id TEXT PRIMARY KEY,
          issuer_id TEXT NOT NULL REFERENCES issuers(id),
          previous_tier TEXT NOT NULL,
          new_tier TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS issuer_trust_events_issuer_idx
          ON issuer_trust_events(issuer_id, occurred_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (7, ?)')
        .run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const disputeMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 8').get();
  if (!disputeMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attestation_disputes (
          id TEXT PRIMARY KEY,
          attestation_id TEXT NOT NULL REFERENCES attestations(id),
          subject_id TEXT NOT NULL,
          opened_by_user_id TEXT NOT NULL REFERENCES users(id),
          reason TEXT NOT NULL,
          evidence_refs_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('open', 'upheld', 'rejected')),
          resolution_reason TEXT,
          opened_at INTEGER NOT NULL,
          resolved_at INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS attestation_disputes_one_open_idx
          ON attestation_disputes(attestation_id) WHERE status = 'open';
        CREATE INDEX IF NOT EXISTS attestation_disputes_user_idx
          ON attestation_disputes(opened_by_user_id, opened_at DESC);
        CREATE INDEX IF NOT EXISTS attestation_disputes_attestation_idx
          ON attestation_disputes(attestation_id, status);
        CREATE TABLE IF NOT EXISTS attestation_dispute_events (
          id TEXT PRIMARY KEY,
          dispute_id TEXT NOT NULL REFERENCES attestation_disputes(id),
          previous_status TEXT,
          new_status TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL,
          occurred_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS attestation_dispute_events_dispute_idx
          ON attestation_dispute_events(dispute_id, occurred_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (8, ?)')
        .run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }


  const transactionProofMigration = db.prepare('SELECT version FROM schema_migrations WHERE version = 9').get();
  if (!transactionProofMigration) {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chain_event_transaction_proofs (
          id TEXT PRIMARY KEY,
          chain_event_id TEXT NOT NULL REFERENCES chain_events(id),
          network TEXT NOT NULL,
          account TEXT NOT NULL,
          lt TEXT NOT NULL,
          tx_hash TEXT NOT NULL,
          masterchain_seqno INTEGER NOT NULL,
          masterchain_root_hash TEXT NOT NULL,
          proof_policy TEXT NOT NULL CHECK(proof_policy = 'secure'),
          verifier_version TEXT NOT NULL,
          verified_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS chain_event_transaction_proofs_event_idx
          ON chain_event_transaction_proofs(chain_event_id, verified_at DESC);
      `);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (9, ?)')
        .run(Math.floor(Date.now() / 1000));
    });
    migrate();
  }

  return db;
}
