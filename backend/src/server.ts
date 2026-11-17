import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, type DurDatabase } from './identity/database';
import { SessionService } from './identity/sessions';
import { verifyTelegramInitData } from './identity/telegram';

const port = Number(process.env.API_PORT ?? 8787);
const COOKIE_NAME = 'dur_session';
const MAX_BODY_BYTES = 16_384;

type ApiOptions = {
  db?: DurDatabase;
  botToken?: string;
  allowedOrigin?: string;
  secureCookies?: boolean;
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
    if (part.slice(0, index).trim() === name) {\n      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return undefined; }\n    }
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

function cookie(token: string, secure: boolean, maxAge: number) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function createApiServer(options: ApiOptions = {}) {
  const db = options.db ?? openDatabase();
  const ownsDb = !options.db;
  const sessions = new SessionService(db);
  const botToken = options.botToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '';
  const allowedOrigin = options.allowedOrigin ?? process.env.CORS_ORIGIN ?? '';
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE !== 'false';

  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    const origin = req.headers.origin;

    if (origin && allowedOrigin && origin === allowedOrigin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('access-control-allow-credentials', 'true');
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
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
      send(res, 200, { ok: true, service: 'dur-api', version: '0.2.0' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/status') {
      send(res, 200, {
        protocol: 'DUR',
        version: '0.2.0',
        environment: 'development-preview',
        network: 'ton-testnet-planned',
        capabilities: {
          telegramVerification: 'implemented',
          telegramSessions: 'implemented',
          tonProof: 'not_implemented',
          reputation: 'not_implemented',
          attestations: 'not_implemented',
          escrow: 'not_implemented',
          chainIndexing: 'not_implemented',
        },
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/auth/telegram') {
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
        }, { 'set-cookie': cookie(created.token, secureCookies, 7 * 24 * 60 * 60) });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'authentication_failed';
        const status = code === 'payload_too_large' ? 413 : code === 'invalid_json' ? 400 : 401;
        send(res, status, { error: status === 401 ? 'telegram_auth_failed' : code, requestId });
      }
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
        'set-cookie': cookie('', secureCookies, 0),
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
