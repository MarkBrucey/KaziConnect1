// Next.js 16's name for middleware. For every /api path it sets today's CORS headers exactly,
// and answers OPTIONS with 204 at once (this allows Swagger Editor, editor.swagger.io, and any
// browser app to call the API). /openapi.yaml gets the same headers, so the contract can be
// imported from another site.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function proxy(request: NextRequest): NextResponse {
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
  return response;
}

export const config = { matcher: ['/api/:path*', '/openapi.yaml'] };
