// Week 13: the standard "this is going away" headers, added to every answer of a deprecated endpoint so every
// caller is told on every call, not only by email:
//   Deprecation: true                                 this endpoint is deprecated
//   Sunset: Tue, 10 Nov 2026 21:00:00 GMT             the moment it stops working (midnight in Nairobi)
//   Link: </api/v2/jobs>; rel="successor-version"     what replaces it
// The answer itself (status, body, every other header) is not touched.

import type { RouteHandler } from './lib/guards';

// Version 1 of the job list (Endpoints 1 and 2: GET /api/jobs and its alias GET /api/v1/jobs).
// The sunset is the end of the day before Demo Day (Demo Day is 11 November 2026), as the Week 13 handout asks, so
// the whole ring can present on v2: midnight in Nairobi at the end of Tuesday 10 November, which is 21:00 GMT.
// As the course says, v1 keeps running until after Demo Day so no demo breaks.
export const JOBS_V1 = { sunset: '2026-11-10T21:00:00Z', successor: '/api/v2/jobs' };

export function deprecationHeaders({ sunset, successor }: { sunset: string; successor: string }): Record<string, string> {
  return {
    Deprecation: 'true',
    Sunset: new Date(sunset).toUTCString(),
    Link: `<${successor}>; rel="successor-version"`,
  };
}

export function deprecated<P>(handler: RouteHandler<P>, notice: { sunset: string; successor: string }): RouteHandler<P> {
  const headers = deprecationHeaders(notice);
  return async (req, ctx) => {
    const res = await handler(req, ctx);
    for (const [name, value] of Object.entries(headers)) res.headers.set(name, value);
    return res;
  };
}
