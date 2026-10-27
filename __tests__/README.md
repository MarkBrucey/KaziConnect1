Automated tests for the Kazi Connect API: 661 tests in 18 files (660 run on the in-memory store; 1 more runs only when DATABASE_URL is set). Run them with: npm test

`npm test` builds the app first (`next build`), because the tests start the real server, then runs Jest one file at a time.

The first 156 tests, in 5 files, cover Endpoints 1 to 21, one file per area. They are the same files as before the move to Next.js and TypeScript, byte for byte, and they pass unchanged:
- jobs.test.js (21): Endpoints 1 to 4
- applications.test.js (42): Endpoints 5 to 9
- accounts.test.js (35): Endpoints 10 to 13 and 19
- employer.test.js (39): Endpoints 14 to 18
- passwordReset.test.js (19): Endpoints 20 and 21

286 more tests prove the move to Next.js and TypeScript changed nothing a client can see, and check the tools around the API and the Week 9 security work:
- parityWithExpress.test.js (153): sends 151 requests (happy paths, every error path, wrong methods, malformed JSON, the exact 20 KB limit, odd ids) and compares every status, every header except Date, and every body with the answer the real Express version gave to the same request. The recorded answers are in fixtures/parity.golden.json and fixtures/parityCases.js lists the requests. Two more tests check that all of them were replayed and that no answer carries X-Powered-By or ETag
- apiKeys.test.ts (58): API keys and the rate limit. One request per operation in openapi.yaml proves each answers 401 without a key; `200 200 200 429 429` with its Retry-After header and JSON body; each consumer counted on its own; the website key counted per visitor; wrong keys slowed down; fail-closed REQUIRE_API_KEY; the WebSocket (header, browser subprotocol, 401, 429); the website pages carrying only the website key; and that with no key set the API stays open
- mailerLog.test.ts (2): a password-reset link is printed to the log on your own computer, and never on a deployment (API keys on)
- ringStatus.test.ts (33): `npm run ring:status`, the report on how far each system in the ring has got, and how it tells a part that is not built yet from a real error (including Kazi Connect asking for an API key)
- ringCheck.test.ts (17): `npm run ring:check`, the end-to-end check of Kazi Connect's part of the ring, including when Sherehe is down or refuses the key, and that it leaves nothing behind
- sourceGuards.test.ts (10): checks on the website source: nothing from Sherehe or the API can be read as markup, links only go to pages of the site, and the Event work page offers the shared list of 47 counties
- bootstrapEnv.test.ts (6): a `.env` file is read before the database and the port are chosen, a real environment variable wins over it, and NODE_ENV defaults correctly (run on a copy of the real file in a temp folder, so your own `.env` is never touched)
- migrate.test.ts (7): `npm run db:migrate` only adds, never drops, and never prints the database password. The one test that needs a real database is skipped unless DATABASE_URL is set

The other 219 tests, in 5 files, cover Event work (Endpoints 22 to 25, website need W7). Sherehe is a local stand-in, helpers/shereheStub.ts, so none of them needs the real Sherehe or its key:
- eventWork.test.js (94): Endpoints 22 to 25, every status code, that Endpoints 1 to 21 keep working while Sherehe is down, and that a role added at Sherehe within the last 5 minutes can still be offered for
- offerPoller.test.js (34): the job that opens when the organiser accepts an offer
- shereheClient.test.js (52): the only module that talks to Sherehe, and the mappers
- fetcher.test.js (23): timeouts, the 5-minute cache and its limited refresh, the size limit, and how failures are handled
- staffingStore.test.js (16): the staffing offer functions of the data store

They run on the in-memory store by default. With DATABASE_URL set they run on that PostgreSQL database, and they empty it first, so never point DATABASE_URL at data you want to keep.

The partner tests in partner-tests/ are separate and run with npm run test:partner. They are written from Sherehe's contract alone and need Sherehe's real address and key.
