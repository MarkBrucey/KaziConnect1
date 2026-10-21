// Express answered 404 with no body for any method a path does not have, and for any /api path it
// did not know. Next would answer 405 for the first, so every route file hands the methods it does
// not support to this, and app/api/[...path] hands it everything else.
//
// The JSON body is still read first, as express.json() did: a request with a body that is not valid
// JSON got a 400 whatever path it was sent to.

import { handle } from './guards';
import { empty } from './http';

export const notFound = handle<Record<string, string | string[]>>(() => empty(404));
