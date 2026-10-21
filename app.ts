// createServer(): an http.Server around the prepared Next.js app, with the WebSocket for
// Endpoint 6 attached. Route handlers cannot accept a WebSocket upgrade, so that one endpoint is
// handled here; every other endpoint is a route handler under app/api.
//
// The tests call createServer() and then .listen(0), so this stays a root FILE next to the app/
// directory (require('../app') finds app.ts, and there must never be an app/index.* file).

import http from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import next from 'next';
import { attachRealtime } from './realtime';

// Express matched /api paths without regard to letter case and ignored a trailing slash, so
// /API/Jobs/job_1/ and /api/jobs/job_1 were the same request. Next is strict about both (it redirects
// or answers its own 404 page). The fixed words of the paths are put back to lower case and a trailing
// slash is dropped before Next sees the request. Ids are left exactly as they were sent.
const FIXED_WORDS = new Set([
  'api', 'jobs', 'status', 'applications', 'subscribe', 'auth', 'register', 'login', 'logout',
  'password-resets', 'password', 'me', 'event-openings', 'staffing-offers',
]);

function normaliseApiPath(req: IncomingMessage): void {
  const url = req.url || '';
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  if (!/^\/api(\/|$)/i.test(path)) return;
  const fixed = path.split('/').map((segment) => (FIXED_WORDS.has(segment.toLowerCase()) ? segment.toLowerCase() : segment)).join('/');
  req.url = (fixed.length > 1 ? fixed.replace(/\/+$/, '') : fixed) + (cut === -1 ? '' : url.slice(cut));
}

// Next adds a Vary header (rsc, next-router-state-tree, ...) to every response because a page and its
// React Server Component payload share one URL. An API answer has no such twin, and Express never sent
// Vary, so it is removed from /api and /openapi.yaml answers to keep their headers exactly as before.
function dropNextOnlyHeaders(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url || '';
  if (!url.startsWith('/api/') && !url.startsWith('/openapi.yaml')) return;
  const writeHead = res.writeHead.bind(res) as (...args: unknown[]) => ServerResponse;
  res.writeHead = ((...args: unknown[]): ServerResponse => {
    res.removeHeader('vary');
    const last = args[args.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      const headers = { ...(last as Record<string, unknown>) };
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'vary') delete headers[name];
      args[args.length - 1] = headers;
    }
    return writeHead(...args);
  }) as typeof res.writeHead;
}

// Express decoded the id in /api/jobs/{id} and the like, and answered a JSON 500 when it had a malformed
// escape such as %zz. Next would answer its own plain-text error page, so that case is answered here.
const ID_IN_PATH = /^\/api\/(?:jobs|applications|staffing-offers)\/([^/?#]+)/;
function hasMalformedId(url: string): boolean {
  const match = ID_IN_PATH.exec(url);
  if (!match) return false;
  try {
    decodeURIComponent(match[1]);
    return false;
  } catch {
    return true;
  }
}

function internalServerError(res: ServerResponse): void {
  const body = JSON.stringify({ message: 'Internal server error' });
  res.writeHead(500, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function createServer(): http.Server {
  const dev = process.env.NODE_ENV === 'development';
  const nextApp = next({ dev, dir: __dirname, hostname: 'localhost', port: Number(process.env.PORT) || 3000 });
  const handleRequest = nextApp.getRequestHandler();
  const ready = nextApp.prepare();
  ready.catch((err: unknown) => console.error('Next.js could not start. Has `npm run build` been run?', err));

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    normaliseApiPath(req);
    if (hasMalformedId(req.url || '') && req.method !== 'OPTIONS') { internalServerError(res); return; }
    dropNextOnlyHeaders(req, res);
    ready.then(() => handleRequest(req, res)).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });

  attachRealtime(server, {
    // In development Next opens its own WebSocket for hot reloading; give it those upgrades.
    passOn: dev
      ? (req, socket, head) => {
          if (!req.url || !req.url.startsWith('/_next/')) return false;
          ready.then(() => nextApp.getUpgradeHandler()(req, socket, head)).catch(() => socket.destroy());
          return true;
        }
      : undefined,
  });
  return server;
}
