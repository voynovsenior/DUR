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
          reputation: 'not_implemented',
          attestations: 'issuer_registry_available',
          escrow: 'not_implemented',
          chainIndexing: 'manual_testnet_sync_available',
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/telegram') {
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
      const challenge = tonChallenges.issue(user.id);
      send(res, 200, { payload: challenge.payload, expiresAt: challenge.expiresAt }, {
        'set-cookie': cookie(TON_ATTEMPT_COOKIE, challenge.attemptToken, secureCookies, 10 * 60, '/v1/auth/ton'),
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/ton/verify') {
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
        schemas.validate(body.schemaId, body.schemaVersion as number, body.claim);
        const issued = attestations.issue(issuer.id, {
          schemaId: body.schemaId as string,
          schemaVersion: body.schemaVersion as number,
          subjectId: body.subjectId as string,
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

    if (url.pathname.startsWith('/v1/profiles/')) {
      send(res, 501, {
        error: 'not_implemented',
        message: 'Profile queries are unavailable until the reputation data layer is implemented.',
        requestId,
      });
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
