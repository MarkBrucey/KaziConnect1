// Next.js 16's name for middleware. For every /api path it sets today's CORS headers exactly,
// and answers OPTIONS with 204 at once (this allows Swagger Editor, editor.swagger.io, and any
// browser app to call the API). /openapi.yaml gets the same headers, so the contract can be
// imported from another site.
//
// Week 9: when API keys are switched on (API_KEYS is set; see lib/apiKeys.ts), every other /api call must
// carry a valid X-API-Key before anything else happens, and no consumer may call more than the rate limit
// allows. A refused call answers 401 or 429 here and its handler never runs. OPTIONS (the browser's preflight)
// is answered before the check, because a preflight cannot carry a key. /openapi.yaml is public on purpose:
// it is the documentation, and holds no data.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { clientAddress, gate } from '@/lib/apiGate';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function proxy(request: NextRequest): NextResponse {
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  if (request.nextUrl.pathname.startsWith('/api')) {
    const result = gate({ key: request.headers.get('x-api-key'), address: clientAddress(request.headers.get('x-forwarded-for')) });
    if (!result.ok) {
      const body = result.retryAfter === undefined ? { message: result.message } : { message: result.message, retryAfter: result.retryAfter };
      const headers: Record<string, string> = { ...CORS_HEADERS };
      if (result.retryAfter !== undefined) headers['Retry-After'] = String(result.retryAfter);
      return NextResponse.json(body, { status: result.status, headers });
    }
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = { matcher: ['/api/:path*', '/openapi.yaml'] };
