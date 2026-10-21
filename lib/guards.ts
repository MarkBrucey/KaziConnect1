// What Express did in front of the routes, as wrappers around route handlers:
//
//   handle(fn)                    a public route
//   withAuth(fn)                  a route that needs a valid login token
//   requireRole('employer')(fn)   a logged in route only one kind of account may use
//
// They run the same checks in the same order as the Express middleware did:
//   1. read the JSON body (a body that is too big or not JSON is refused before anything else, even a login check)
//   2. check the login token (401)
//   3. check the role (403)
//   4. your handler
// And whatever your handler throws becomes a JSON 500, or a 502 when Sherehe could not be used.

import type { NextRequest } from 'next/server';
import * as db from '../db';
import { hashToken } from '../auth';
import { HttpFailure, fail, readJson } from './http';
import { PARTNER_UNAVAILABLE, UpstreamError, logUpstream } from '../clients/upstreamError';
import type { UserRole, UserRow } from './storeTypes';

export type RouteContext<P> = { params: Promise<P> };
export type RouteHandler<P> = (req: NextRequest, ctx: RouteContext<P>) => Promise<Response>;

// What a handler is given. `body` is whatever readJson found, still to be validated.
export interface PublicContext<P> {
  params: P;
  body: unknown;
}
export interface AuthedContext<P> extends PublicContext<P> {
  user: UserRow;
  tokenHash: string;
}

type PublicFn<P> = (req: NextRequest, ctx: PublicContext<P>) => Response | Promise<Response>;
type AuthedFn<P> = (req: NextRequest, ctx: AuthedContext<P>) => Response | Promise<Response>;

async function run(work: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof HttpFailure) return err.response;
    if (err instanceof UpstreamError) {
      logUpstream(err, 'a request to Sherehe');
      return fail(502, PARTNER_UNAVAILABLE);
    }
    console.error(err);
    return fail(500, 'Internal server error');
  }
}

export function handle<P = Record<string, never>>(fn: PublicFn<P>): RouteHandler<P> {
  return (req, ctx) => run(async () => {
    const body = await readJson(req);
    return fn(req, { params: await ctx.params, body });
  });
}

// The request must carry a valid "Authorization: Bearer <token>". On success the handler is given the user's row.
export function withAuth<P = Record<string, never>>(fn: AuthedFn<P>): RouteHandler<P> {
  return (req, ctx) => run(async () => {
    const body = await readJson(req);
    const header = req.headers.get('authorization') || '';
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(header.trim());
    if (!match) return fail(401, 'Log in first, then send your token as: Authorization: Bearer <token>');
    const tokenHash = hashToken(match[1]);
    const session = await db.findSession(tokenHash);
    if (!session || new Date(session.expires_at) <= new Date()) return fail(401, 'Your session has expired or is not valid. Log in again.');
    const user = await db.findUserById(session.user_id);
    if (!user) return fail(401, 'Your session is not valid. Log in again.');
    return fn(req, { params: await ctx.params, body, user, tokenHash });
  });
}

// The logged in user must have this role.
export function requireRole(role: UserRole) {
  return <P>(fn: AuthedFn<P>): AuthedFn<P> => (req, ctx) => {
    if (ctx.user.role !== role) {
      const who = role === 'employer' ? 'employers' : 'students';
      return fail(403, `Only ${who} can do this.`);
    }
    return fn(req, ctx);
  };
}
