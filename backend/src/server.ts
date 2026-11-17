import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.API_PORT ?? 8787);
const allowedOrigin = process.env.CORS_ORIGIN ?? '';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (origin && allowedOrigin && origin === allowedOrigin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
  }
}

export function createApiServer() {
  return createServer((req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      send(res, 405, { error: 'method_not_allowed', requestId });
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname === '/healthz') {
      send(res, 200, { ok: true, service: 'dur-api', version: '0.1.0' });
      return;
    }

    if (url.pathname === '/v1/status') {
      send(res, 200, {
        protocol: 'DUR',
        version: '0.1.0',
        environment: 'development-preview',
        network: 'ton-testnet-planned',
        capabilities: {
          reputation: 'not_implemented',
          attestations: 'not_implemented',
          escrow: 'not_implemented',
          chainIndexing: 'not_implemented',
        },
      });
      return;
    }

    if (url.pathname.startsWith('/v1/profiles/')) {
      send(res, 501, {
        error: 'not_implemented',
        message: 'Profile queries are unavailable until identity verification and the reputation data layer are implemented.',
        requestId,
      });
      return;
    }

    send(res, 404, { error: 'not_found', requestId });
  });
}

if (process.env.NODE_ENV !== 'test') {
  createApiServer().listen(port, '0.0.0.0', () => {
    console.log(`DUR API listening on port ${port}`);
  });
}
