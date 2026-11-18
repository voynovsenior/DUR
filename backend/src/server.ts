import 'dotenv/config';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, type DurDatabase } from './identity/database';
import { SessionService } from './identity/sessions';
import { verifyTelegramInitData } from './identity/telegram';
import { TonProofChallengeStore } from './identity/ton-proof-challenges';
import { verifyTonProof, type TonProofRequest } from './identity/ton-proof';
import { AttestationRegistry } from './attestations/registry';
import type { JsonValue } from './attestations/model';
import { ChainEventStore } from './indexer/event-store';
import { AttestationSchemaRegistry } from './attestations/schema-registry';
import { calculateReputation } from './reputation/engine';

const port = Number(process.env.API_PORT ?? 8787);
const COOKIE_NAME = 'dur_session';
const TON_ATTEMPT_COOKIE = 'dur_ton_attempt';
const MAX_BODY_BYTES = 16_384;

type ApiOptions = {
  db?: DurDatabase;
  botToken?: string;
  allowedOrigin?: string;
  secureCookies?: boolean;
  tonProofDomain?: string;
  tonNetworkId?: string;
  adminToken?: string;
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(data);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token && token.length <= 512 ? token : undefined;
}

function secureTokenEquals(candidate: string | undefined, expected: string): boolean {
  if (!candidate || !expected) return false;
  const candidateHash = createHash('sha256').update(candidate).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

type RateBucket = { count: number; resetAt: number };

function consumeRateLimit(
  buckets: Map<string, RateBucket>,
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  for (const [bucketKey, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  }
  if (!buckets.has(key) && buckets.size >= 10_000) {
    return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
  }
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfter: 0 };
}

function cookie(name: string, token: string, secure: boolean, maxAge: number, path = '/') {
  return `${name}=${encodeURIComponent(token)}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function createApiServer(options: ApiOptions = {}) {
  const db = options.db ?? openDatabase();
  const ownsDb = !options.db;
  const sessions = new SessionService(db);
  const tonChallenges = new TonProofChallengeStore(db);
  const attestations = new AttestationRegistry(db);
  const chainEvents = new ChainEventStore(db);
  const schemas = new AttestationSchemaRegistry(db);
  const rateBuckets = new Map<string, RateBucket>();
  const clientKey = (req: IncomingMessage, scope: string) => `${scope}:${req.socket.remoteAddress ?? 'unknown'}`;
  const enforceLimit = (res: ServerResponse, requestId: string, key: string, limit: number) => {
    const result = consumeRateLimit(rateBuckets, key, limit, 60_000);
    if (result.allowed) return false;
    send(res, 429, { error: 'rate_limited', requestId }, { 'retry-after': String(result.retryAfter) });
    return true;
  };
  const botToken = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  const allowedOrigin = options.allowedOrigin ?? process.env.CORS_ORIGIN ?? '';
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE !== 'false';
  const tonProofDomain = options.tonProofDomain ?? process.env.TON_APP_DOMAIN ?? '';
  const tonNetworkId = options.tonNetworkId ?? process.env.TON_NETWORK_ID ?? '-3';
  const adminToken = options.adminToken ?? process.env.DUR_ADMIN_TOKEN ?? '';
  const tonProofConfigured = Boolean(tonProofDomain) && tonNetworkId === '-3';

  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    const origin = req.headers.origin;

    if (origin && allowedOrigin && origin === allowedOrigin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (allowedOrigin && origin !== allowedOrigin) {
      send(res, 403, { error: 'origin_not_allowed', requestId });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, { ok: true, service: 'dur-api', version: '0.3.0' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/issuers') {
      send(res, 200, { issuers: attestations.listActiveIssuers() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/schemas') {
      send(res, 200, { schemas: schemas.listActive() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/indexer/status') {
      const checkpoint = chainEvents.getCheckpoint('ton-testnet');
      send(res, 200, {
        network: 'ton-testnet',
        mode: 'manual_sync',
        checkpoint,
        trust: 'provider_indexed_data_unverified',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/indexer/events') {
      const network = url.searchParams.get('network') ?? 'ton-testnet';
      if (network !== 'ton-testnet') {
        send(res, 400, { error: 'unsupported_network', requestId });
        return;
      }
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit === null ? 50 : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        send(res, 400, { error: 'invalid_limit', requestId });
        return;
      }
      const requestedStatus = url.searchParams.get('status');
      const verificationStatus = requestedStatus === 'verified' || requestedStatus === 'unverified' ||
        requestedStatus === 'quarantined' ? requestedStatus : undefined;
      if (requestedStatus !== null && !verificationStatus) {
        send(res, 400, { error: 'invalid_verification_status', requestId });
        return;
      }
      send(res, 200, {
        network,
        events: chainEvents.listEvents({ network, limit, verificationStatus }),
        trust: 'provider_indexed_data_unverified',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      send(res, 200, {
        protocol: 'DUR',
        version: '0.3.0',
        environment: 'development-preview',
        network: tonNetworkId === '-3' ? 'ton-testnet' : 'configured-network-preview',
        capabilities: {
          telegramVerification: 'implemented',
          telegramSessions: 'implemented',
          tonProof: tonProofConfigured ? 'configured' : tonProofDomain ? 'unsupported_network' : 'configuration_required',
          reputation: 'experimental_attestation_projection_v0.1',
          attestations: 'issuer_registry_available',
          escrow: 'not_implemented',
          chainIndexing: 'manual_testnet_sync_available',
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/telegram') {
      if (enforceLimit(res, requestId, clientKey(req, 'telegram-login'), 10)) return;
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      if (!botToken) {
        send(res, 503, { error: 'telegram_auth_not_configured', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { initData?: unknown };
        if (!body || typeof body.initData !== 'string') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const verified = verifyTelegramInitData(body.initData, { botToken });
        // Rotate an existing browser session instead of leaving it active after re-authentication.
        sessions.revoke(readCookie(req, COOKIE_NAME));
        const created = sessions.createForTelegram(verified.user);
        send(res, 200, {
          authenticated: true,
          user: {
            id: created.userId,
            telegramId: String(verified.user.id),
            username: verified.user.username ?? null,
            firstName: verified.user.first_name,
          },
          expiresAt: created.expiresAt,
        }, { 'set-cookie': cookie(COOKIE_NAME, created.token, secureCookies, 7 * 24 * 60 * 60) });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'authentication_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 401;
        send(res, status, { error: status === 401 ? 'telegram_auth_failed' : code, requestId });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/ton/challenge') {
      if (!tonProofConfigured) {
        send(res, 503, { error: 'ton_proof_not_configured', requestId });
        return;
      }
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      if (enforceLimit(res, requestId, `ton-challenge:${user.id}`, 10)) return;
      const challenge = tonChallenges.issue(user.id);
      send(res, 200, { payload: challenge.payload, expiresAt: challenge.expiresAt }, {
        'set-cookie': cookie(TON_ATTEMPT_COOKIE, challenge.attemptToken, secureCookies, 10 * 60, '/v1/auth/ton'),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/ton/verify') {
      if (enforceLimit(res, requestId, clientKey(req, 'ton-proof-verify'), 10)) return;
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      if (!tonProofDomain) {
        send(res, 503, { error: 'ton_proof_not_configured', requestId });
        return;
      }
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      try {
        const body = await readJson(req) as TonProofRequest;
        if (!body?.proof || typeof body.proof.payload !== 'string') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const attemptToken = readCookie(req, TON_ATTEMPT_COOKIE);
        if (!tonChallenges.matches(body.proof.payload, attemptToken, user.id)) {
          send(res, 401, { error: 'challenge_invalid_or_expired', requestId });
          return;
        }
        const verified = verifyTonProof(body, {
          expectedDomain: tonProofDomain,
          expectedNetwork: tonNetworkId,
        });
        if (!tonChallenges.consume(body.proof.payload, attemptToken, user.id)) {
          send(res, 409, { error: 'challenge_already_consumed', requestId });
          return;
        }

        const existing = db.prepare('SELECT user_id FROM wallet_links WHERE network = ? AND address = ?')
          .get(verified.network, verified.address) as { user_id: string } | undefined;
        if (existing && existing.user_id !== user.id) {
          send(res, 409, { error: 'wallet_already_linked', requestId });
          return;
        }
        if (!existing) {
          db.prepare(`
            INSERT INTO wallet_links (id, user_id, network, address, public_key, linked_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(randomUUID(), user.id, verified.network, verified.address,
            verified.publicKey, Math.floor(Date.now() / 1000));
        }
        send(res, 200, { verified: true, address: verified.address, network: verified.network }, {
          'set-cookie': cookie(TON_ATTEMPT_COOKIE, '', secureCookies, 0, '/v1/auth/ton'),
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'ton_proof_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 401;
        send(res, status, { error: status === 401 ? 'ton_proof_failed' : code, requestId });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/admin/schemas') {
      if (enforceLimit(res, requestId, clientKey(req, 'schema-admin'), 20)) return;
      if (!adminToken) {
        send(res, 503, { error: 'schema_admin_not_configured', requestId });
        return;
      }
      if (!secureTokenEquals(bearerToken(req), adminToken)) {
        send(res, 401, { error: 'admin_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { schemaId?: unknown; schemaVersion?: unknown; schema?: unknown };
        if (!body || typeof body.schemaId !== 'string' || typeof body.schemaVersion !== 'number') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const registered = schemas.register(body.schemaId, body.schemaVersion, body.schema);
        send(res, 201, registered);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'schema_registration_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    const schemaRoute = url.pathname.match(/^\/v1\/schemas\/([^/]+)\/(\d+)$/);
    if (schemaRoute && req.method === 'GET') {
      const schema = schemas.get(schemaRoute[1], Number(schemaRoute[2]));
      if (!schema) {
        send(res, 404, { error: 'schema_not_found', requestId });
        return;
      }
      send(res, 200, schema);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/admin/issuers') {
      if (enforceLimit(res, requestId, clientKey(req, 'issuer-admin'), 20)) return;
      if (!adminToken) {
        send(res, 503, { error: 'issuer_admin_not_configured', requestId });
        return;
      }
      if (!secureTokenEquals(bearerToken(req), adminToken)) {
        send(res, 401, { error: 'admin_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { displayName?: unknown; issuerType?: unknown };
        if (!body || typeof body.displayName !== 'string' || typeof body.issuerType !== 'string') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const created = attestations.createIssuer({ displayName: body.displayName, issuerType: body.issuerType });
        send(res, 201, created);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'issuer_creation_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    const issuerTrustTierRoute = url.pathname.match(/^\/v1\/admin\/issuers\/([^/]+)\/trust-tier$/);
    if (issuerTrustTierRoute && req.method === 'POST') {
      if (enforceLimit(res, requestId, clientKey(req, 'issuer-trust-tier-admin'), 20)) return;
      if (!adminToken) {
        send(res, 503, { error: 'issuer_admin_not_configured', requestId });
        return;
      }
      if (!secureTokenEquals(bearerToken(req), adminToken)) {
        send(res, 401, { error: 'admin_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { trustTier?: unknown; reason?: unknown };
        const tiers = ['unverified', 'verified', 'trusted', 'official'];
        if (!body || typeof body.trustTier !== 'string' || !tiers.includes(body.trustTier) ||
            typeof body.reason !== 'string') {
          send(res, 400, { error: 'invalid_issuer_trust_tier', requestId });
          return;
        }
        const updated = attestations.setIssuerTrustTier(
          issuerTrustTierRoute[1],
          body.trustTier as 'unverified' | 'verified' | 'trusted' | 'official',
          body.reason,
        );
        if (!updated) {
          send(res, 404, { error: 'issuer_not_found', requestId });
          return;
        }
        send(res, 200, { issuerId: issuerTrustTierRoute[1], trustTier: body.trustTier });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'issuer_trust_tier_update_failed';
        send(res, 400, { error: code, requestId });
      }
      return;
    }

    const issuerStatusRoute = url.pathname.match(/^\/v1\/admin\/issuers\/([^/]+)\/status$/);
    if (issuerStatusRoute && req.method === 'POST') {
      if (enforceLimit(res, requestId, clientKey(req, 'issuer-status-admin'), 20)) return;
      if (!adminToken) {
        send(res, 503, { error: 'issuer_admin_not_configured', requestId });
        return;
      }
      if (!secureTokenEquals(bearerToken(req), adminToken)) {
        send(res, 401, { error: 'admin_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { status?: unknown };
        if (!body || (body.status !== 'active' && body.status !== 'suspended' && body.status !== 'revoked')) {
          send(res, 400, { error: 'invalid_issuer_status', requestId });
          return;
        }
        const updated = attestations.setIssuerStatus(issuerStatusRoute[1], body.status);
        if (!updated) {
          send(res, 404, { error: 'issuer_not_found_or_terminal', requestId });
          return;
        }
        send(res, 200, { issuerId: issuerStatusRoute[1], status: body.status });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'issuer_status_update_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/issuers/me/revoke-key') {
      const key = bearerToken(req);
      const issuer = attestations.authenticateIssuer(key);
      if (!issuer || !key) {
        send(res, 401, { error: 'issuer_unauthorized', requestId });
        return;
      }
      attestations.revokeIssuerKey(key);
      send(res, 200, { revoked: true });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/attestations') {
      if (enforceLimit(res, requestId, clientKey(req, 'attestation-issue'), 60)) return;
      const issuer = attestations.authenticateIssuer(bearerToken(req));
      if (!issuer) {
        send(res, 401, { error: 'issuer_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as {
          schemaId?: unknown;
          schemaVersion?: unknown;
          subjectId?: unknown;
          claim?: unknown;
          evidenceRefs?: unknown;
          expiresAt?: unknown;
        };
        if (!body || typeof body !== 'object') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        if (typeof body.schemaId !== 'string' || !Number.isSafeInteger(body.schemaVersion) ||
            typeof body.subjectId !== 'string' || !body.claim || typeof body.claim !== 'object' ||
            Array.isArray(body.claim) || !Array.isArray(body.evidenceRefs) ||
            !body.evidenceRefs.every(reference => typeof reference === 'string')) {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const subjectMatch = body.subjectId.match(/^wallet:(-3):(0:[a-fA-F0-9]{64})$/);
        if (!subjectMatch) {
          send(res, 400, { error: 'invalid_subject_id', requestId });
          return;
        }
        const consent = db.prepare(`
          SELECT 1 FROM subject_consents
          WHERE network = ? AND wallet_address = ? AND issuer_id = ?
            AND schema_id = ? AND schema_version = ? AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
        `).get('-3', subjectMatch[2].toLowerCase(), issuer.id, body.schemaId, body.schemaVersion, Math.floor(Date.now() / 1000));
        if (!consent) {
          send(res, 403, { error: 'subject_consent_required', requestId });
          return;
        }
        schemas.validate(body.schemaId, body.schemaVersion as number, body.claim);
        const issued = attestations.issue(issuer.id, {
          schemaId: body.schemaId as string,
          schemaVersion: body.schemaVersion as number,
          subjectId: `wallet:-3:${subjectMatch[2].toLowerCase()}`,
          claim: body.claim as { [key: string]: JsonValue },
          evidenceRefs: body.evidenceRefs as string[],
          ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt as number } : {}),
        });
        send(res, 201, issued);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'attestation_issue_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    const attestationRoute = url.pathname.match(/^\/v1\/attestations\/([^/]+)(?:\/(revoke))?$/);
    if (attestationRoute && !attestationRoute[2] && req.method === 'GET') {
      const issuer = attestations.authenticateIssuer(bearerToken(req));
      if (!issuer) {
        send(res, 401, { error: 'issuer_unauthorized', requestId });
        return;
      }
      const record = attestations.get(attestationRoute[1]);
      if (!record || record.issuerId !== issuer.id) {
        send(res, 404, { error: 'attestation_not_found', requestId });
        return;
      }
      send(res, 200, { attestation: record, events: attestations.listEvents(record.id) });
      return;
    }

    if (attestationRoute && attestationRoute[2] === 'revoke' && req.method === 'POST') {
      const issuer = attestations.authenticateIssuer(bearerToken(req));
      if (!issuer) {
        send(res, 401, { error: 'issuer_unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as { reason?: unknown };
        if (!body || typeof body.reason !== 'string') {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const revoked = attestations.revoke(issuer.id, attestationRoute[1], body.reason);
        if (!revoked) {
          send(res, 404, { error: 'attestation_not_found_or_not_active', requestId });
          return;
        }
        send(res, 200, { revoked: true });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'attestation_revoke_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/consents') {
      if (enforceLimit(res, requestId, clientKey(req, 'subject-consent'), 20)) return;
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') {
        send(res, 415, { error: 'unsupported_media_type', requestId });
        return;
      }
      try {
        const body = await readJson(req) as {
          walletAddress?: unknown;
          issuerId?: unknown;
          schemaId?: unknown;
          schemaVersion?: unknown;
          purpose?: unknown;
          expiresAt?: unknown;
        };
        if (!body || typeof body.walletAddress !== 'string' ||
            !/^0:[a-fA-F0-9]{64}$/.test(body.walletAddress) ||
            typeof body.issuerId !== 'string' || typeof body.schemaId !== 'string' ||
            !Number.isSafeInteger(body.schemaVersion) || typeof body.purpose !== 'string' ||
            body.purpose.trim().length < 5 || body.purpose.trim().length > 256) {
          send(res, 400, { error: 'invalid_request', requestId });
          return;
        }
        const walletAddress = body.walletAddress.toLowerCase();
        const wallet = db.prepare(
          'SELECT 1 FROM wallet_links WHERE user_id = ? AND network = ? AND address = ?',
        ).get(user.id, '-3', walletAddress);
        if (!wallet) {
          send(res, 403, { error: 'wallet_not_linked_to_account', requestId });
          return;
        }
        const issuer = db.prepare("SELECT 1 FROM issuers WHERE id = ? AND status = 'active'")
          .get(body.issuerId);
        if (!issuer) {
          send(res, 404, { error: 'issuer_not_found', requestId });
          return;
        }
        if (!schemas.get(body.schemaId, body.schemaVersion as number)) {
          send(res, 404, { error: 'schema_not_found', requestId });
          return;
        }
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = body.expiresAt === undefined || body.expiresAt === null
          ? now + 90 * 24 * 60 * 60
          : body.expiresAt as number;
        if (!Number.isSafeInteger(expiresAt) || expiresAt <= now ||
            expiresAt > now + 365 * 24 * 60 * 60) {
          send(res, 400, { error: 'invalid_consent_expiry', requestId });
          return;
        }
        const id = randomUUID();
        db.prepare(`
          INSERT INTO subject_consents (
            id, user_id, network, wallet_address, issuer_id, schema_id, schema_version,
            purpose, created_at, expires_at
          ) VALUES (?, ?, '-3', ?, ?, ?, ?, ?, ?, ?)
        `).run(id, user.id, walletAddress, body.issuerId, body.schemaId,
          body.schemaVersion as number, body.purpose.trim(), now, expiresAt);
        send(res, 201, {
          id,
          network: '-3',
          walletAddress,
          issuerId: body.issuerId,
          schemaId: body.schemaId,
          schemaVersion: body.schemaVersion,
          purpose: body.purpose.trim(),
          createdAt: now,
          expiresAt,
          revokedAt: null,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'consent_creation_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 400;
        send(res, status, { error: code, requestId });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/consents') {
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      const consents = db.prepare(`
        SELECT id, network, wallet_address AS walletAddress, issuer_id AS issuerId,
               schema_id AS schemaId, schema_version AS schemaVersion, purpose,
               created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM subject_consents WHERE user_id = ? ORDER BY created_at DESC
      `).all(user.id);
      send(res, 200, { consents });
      return;
    }

    const consentRevokeRoute = url.pathname.match(/^\/v1\/auth\/consents\/([^/]+)\/revoke$/);
    if (consentRevokeRoute && req.method === 'POST') {
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      const result = db.prepare(`
        UPDATE subject_consents SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `).run(Math.floor(Date.now() / 1000), consentRevokeRoute[1], user.id);
      if (result.changes === 0) {
        send(res, 404, { error: 'consent_not_found_or_already_revoked', requestId });
        return;
      }
      send(res, 200, { revoked: true });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/wallets') {
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      const wallets = db.prepare(`
        SELECT network, address, linked_at AS linkedAt
        FROM wallet_links WHERE user_id = ? ORDER BY linked_at DESC
      `).all(user.id);
      send(res, 200, { wallets });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/auth/me') {
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      send(res, 200, { authenticated: true, user });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/logout') {
      const token = readCookie(req, COOKIE_NAME);
      sessions.revoke(token);
      send(res, 200, { authenticated: false }, {
        'set-cookie': cookie(COOKIE_NAME, '', secureCookies, 0),
      });
      return;
    }

    const reputationProfileRoute = url.pathname.match(/^\/v1\/profiles\/(.+)\/reputation$/);
    if (reputationProfileRoute && req.method === 'GET') {
      const user = sessions.getUser(readCookie(req, COOKIE_NAME));
      if (!user) {
        send(res, 401, { error: 'unauthorized', requestId });
        return;
      }
      let subjectId: string;
      try {
        subjectId = decodeURIComponent(reputationProfileRoute[1]);
      } catch {
        send(res, 400, { error: 'invalid_subject_id', requestId });
        return;
      }
      if (!/^wallet:-3:0:[a-fA-F0-9]{64}$/.test(subjectId)) {
        send(res, 400, { error: 'invalid_subject_id', requestId });
        return;
      }
      const walletAddress = subjectId.slice('wallet:-3:'.length).toLowerCase();
      const walletLink = db.prepare(
        "SELECT 1 FROM wallet_links WHERE user_id = ? AND network = '-3' AND address = ?",
      ).get(user.id, walletAddress);
      if (!walletLink) {
        send(res, 403, { error: 'profile_access_denied', requestId });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const evidence = attestations.listReputationEvidence(subjectId, now);
      const projection = calculateReputation(evidence, now);
      send(res, 200, { subjectId, reputation: projection });
      return;
    }

    if (url.pathname.startsWith('/v1/profiles/')) {
      send(res, 404, { error: 'profile_not_found', requestId });
      return;
    }

    send(res, 404, { error: 'not_found', requestId });
  });

  if (ownsDb) server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  createApiServer().listen(port, '0.0.0.0', () => {
    console.log(`DUR API listening on port ${port}`);
  });
}
