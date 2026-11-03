# CLAUDE.md

Standing instructions for Claude agents working in this repository. Source of truth: the "Agent prompts" tab of the team's plan document; keep the two in step.

# Role
You are the coding agent for the Kazi Connect sub-team in the Internet Application Programming unit
(an API course). You work inside the existing KaziConnect1 repository, which already has graded
Week 1-8 work: 21 endpoints on Express (JavaScript), openapi.yaml 1.2.1, 156 Jest tests,
`npm run verify` (44 checks) and a live deployment at https://kaziconnect1-1xmu.onrender.com
backed by PostgreSQL. The humans make every design decision, run the partner interviews and hand
off contracts; you build, document and test what they approve. Read README.md, openapi.yaml,
API_NEEDS.md, CONTRACT_DEVIATIONS.md and __tests__/ before changing anything.

# What changed
Kazi's old ring partners, Shamba Direct (upstream) and SettleIn (downstream), have left. New ring:
  Sherehe (events)  -> Kazi Connect (casual jobs)  -> Ujuzi (skills training)  -> Sherehe
- Producer side: Ujuzi replaces SettleIn and uses endpoints 1-9 EXACTLY as SettleIn did, applying
  on a graduate's behalf with its own ids (grd_0101) as studentId and following status over the
  endpoint 6 WebSocket.
- Consumer side: Sherehe replaces Shamba Direct. Kazi will, for the first time, call an upstream
  API from code.
- The team stack is now Next.js full-stack + TypeScript (strict) + PostgreSQL + Tailwind CSS v4 for
  all three repos, so Kazi moves from Express/JavaScript to Next.js route handlers in TypeScript.
Other sub-teams build Sherehe and Ujuzi; you only ever see their contracts, never their code.

# Hard constraints
1. Endpoints 1-21 keep their paths, methods, inputs, outputs, status codes and headers byte for
   byte: empty-body 400/404 on read endpoints 1-5; 400 { message } on bad JSON; 413 over 20 KB;
   today's CORS headers and OPTIONS -> 204; no X-Powered-By; no ETag; unknown /api paths -> 404
   with no body. Ujuzi builds against them.
2. The 156 tests in __tests__/ stay as untouched .js files and keep passing, as does
   `npm run verify`. They call createServer() from ../app (then .listen(0)) and require ../db,
   ../mailer, ../seedData and ../auth, so those modules keep their root paths and exports when
   converted to .ts (tsconfig allowJs; next/jest resolves .ts). Keep app.ts as a root FILE next to
   the app/ directory and never add app/index.*, so `require('../app')` still resolves to app.ts.
3. Every contract change is additive, bumps openapi.yaml to 1.3.0, and gets a CONTRACT_DEVIATIONS.md
   entry before it ships. The README promises any change to endpoints 1-9 is agreed with the
   downstream partner first: that is now Ujuzi.
4. PostgreSQL stays (pgStore, DATABASE_URL) with the in-memory fallback (memoryStore). Production
   data is never dropped; schema changes are additive migrations.

# Stage 1: Sherehe integration on today's code (website need W7), its own branch
Kazi's needs from Sherehe (DRAFT, confirmed in the Week 2 interview): K1 read upcoming events by
county; K2 read an event's roles; K3 create a staffing offer; K4 read an offer's status; K5 withdraw
a pending offer. Sherehe's draft endpoints: GET /api/events?status=upcoming&county=,
GET /api/events/{eventId}, GET /api/events/{eventId}/roles, POST /api/offers
{roleId, workersOffered, note?}, GET /api/offers/{offerId} (pending | accepted | declined),
DELETE /api/offers/{offerId}; all need Sherehe's X-API-Key. When Sherehe hands off its
openapi.yaml, save it as partner-tests/sherehe_openapi.yaml and build from THAT file.
- clients/fetcher: timeout (10 s when a user waits, 60 s in the background), 5-minute read cache,
  Sherehe failures turned into our own 502 { message }. Never pass Sherehe's body through.
- clients/shereheClient: the only module that knows Sherehe's URL (SHEREHE_API_URL), key
  (SHEREHE_API_KEY), paths and fields. Map in mappers (fromShereheRole, fromShereheOffer,
  toEventOpening, toStaffingOffer); Sherehe's vocabulary never leaks into Kazi's contract.
- New endpoints (the humans will give you the drafted openapi.yaml blocks; merge them into the
  existing paths, components.responses and components.schemas):
  22 GET  /api/event-openings?county=   employer; EventOpening[]; 401/403; 502 if Sherehe is down
  23 POST /api/staffing-offers          employer; NewStaffingOffer -> 201 StaffingOffer; 400/401/403/404/409/502
  24 GET  /api/me/staffing-offers       employer; StaffingOffer[] newest first (optional)
  25 DELETE /api/staffing-offers/{offerId}  the employer who made it; pending only; calls K5;
                                        204/401/403/404/409/502
- Migration: staffing_offers table (id sof_..., employer_id, sherehe_offer_id, role_id, event_name,
  workers_offered, status, job_id, created_at) plus the same functions in memoryStore; jobs gain an
  internal source_role_id column that toJob() never exposes.
- jobs/offerPoller (started by server): polls pending offers (K4) every few minutes; on accepted,
  creates the job for that employer with category from the role and payRange {min: payPerShift,
  max: payPerShift}, stores job_id on the offer; on declined, marks it declined; stops when final.
- Tests: eventWork tests + a shereheStub (a local Sherehe built from its contract's examples): 22-25,
  the poller creating the job, duplicate offer -> 409, Sherehe down -> 502. verifyContract covers
  22-25 against the stub. partner-tests/sherehe.partner test replaces shambaDirect.partner.js and
  shamba_openapi.yaml.
- Website: an Event work page on the employer dashboard.

# Stage 2: move to Next.js + TypeScript + Tailwind v4, its own branch; merge only when every check passes
- Node.js 20.9 or newer, the minimum for current Next.js: package.json "engines" becomes
  ">=20.9" (today ">=18"), and README lines 230 and 724 change from 18 to 20.9.
- Next.js (current stable, App Router), TypeScript "strict": true. tsconfig.json with allowJs (only
  for the untouched tests), @/* alias. Dev deps: typescript, tsx, @types/node, @types/pg, @types/ws,
  @types/jest, @types/supertest, openapi-typescript. jest.config.mjs uses next/jest and picks up
  both __tests__/*.test.js and *.test.ts.
- Convert every module to .ts with explicit types: db.ts, memoryStore.ts, pgStore.ts (both
  implementing one Store interface), seedData.ts, auth.ts, mailer.ts, realtime.ts, mappers.ts,
  validation.ts. Same exports, same behaviour.
- `npm run types` generates types/api.d.ts from openapi.yaml and types/sherehe.d.ts from the frozen
  Sherehe copy; mappers return those types, so contract drift fails `npm run typecheck`.
- Every endpoint becomes a route handler (app/api/**/route.ts): jobs (GET 1-2, POST 14),
  jobs/[jobId] (GET 3, PATCH 17), jobs/[jobId]/status (4), jobs/[jobId]/applications (16),
  applications (POST 7), applications/[applicationId] (PUT 8, DELETE 9, PATCH 18),
  applications/[applicationId]/status (5), applications/[applicationId]/subscribe (plain HTTP ->
  426), auth/register, login, logout, password-resets, password (10, 11, 12, 20, 21), me (13),
  me/jobs (15), me/applications (19), event-openings (22), staffing-offers (23),
  me/staffing-offers (24), staffing-offers/[offerId] (DELETE 25), [...path] (404, empty body). Handlers are typed
  (req: NextRequest, { params }: { params: Promise<{ jobId: string }> }).
- lib/http.ts: readJson<T>, json, fail, noContent. lib/guards.ts: withAuth(handler) and
  requireRole(role), the old authenticate()/requireRole() as wrappers.
- app.ts keeps exporting createServer(): an http.Server around the prepared Next app with realtime
  attached for WebSocket upgrades (route handlers cannot accept them). server.ts calls
  createServer().listen(PORT) and starts offerPoller; run with tsx (dev: `tsx watch server.ts`,
  start: `NODE_ENV=production tsx server.ts`).
- proxy.ts (Next.js 16's name for middleware), matcher /api/:path*: today's CORS headers exactly,
  OPTIONS -> 204. next.config.ts: poweredByHeader false, generateEtags false.
- /docs becomes a page with swagger-ui-react; /openapi.yaml a route handler. Remove express and
  swagger-ui-express, jobsRoutes.js, applicationsRoutes.js and accountRoutes.js only after parity.
- Website: replace index.html with .tsx pages styled with Tailwind CSS v4 (`npm i -D tailwindcss
  @tailwindcss/postcss`; postcss.config.mjs { plugins: { '@tailwindcss/postcss': {} } };
  app/globals.css starts `@import "tailwindcss";`, brand colours in @theme; no tailwind.config
  file): jobs list and filters, job detail with apply and live status, login/register/reset,
  employer dashboard (my jobs, applicants, accept, close, Event work), student applications.
  Pages call /api with fetch. Match every index.html feature before deleting it; move Images/ to
  public/.
- Scripts: dev, build (next build), start, typecheck, types, test (next build && jest --runInBand),
  verify (tsx scripts/verifyContract.ts), test:partner, ring:check, db:migrate. run.sh: npm ci,
  build, start. Render: build command `npm ci && npm run build`, start command `npm start`; add
  SHEREHE_API_URL and SHEREHE_API_KEY to the Render settings (the humans do this).
- Done only when the 156 existing tests pass untouched, the new tests pass, `npm run typecheck`
  and `npm run verify` pass, and every README command works against a local run.

# Closed-ring requirements (the ring only counts when all hold for all three systems)
R1 Provide: Kazi's contract (1.3.0; endpoints 1-9 unchanged) is handed to Ujuzi, which keeps a
   frozen copy; the humans confirm Ujuzi has re-run its tests against 1.3.0.
R2 Consume: every Sherehe call goes through shereheClient, typed from types/sherehe.d.ts.
R3 Deploy: Kazi stays live on Render; README lists Kazi's URL and Sherehe's; SHEREHE_API_URL set.
R4 Credentials (Week 9): Kazi holds Sherehe's X-API-Key in Render settings, never in git.
   Endpoints 1-9 stay open for Ujuzi unless both sub-teams agree and CONTRACT_DEVIATIONS.md says so.
R5 Alignment: categories and counties match the shared lists (accommodation, campus, catering,
   cleaning, electrical, events, plumbing, security, tutoring; Kenya's 47 counties) so Sherehe roles
   become Kazi jobs and Ujuzi's job matches find them.
R6 Partner tests: partner-tests/sherehe.partner test written from Sherehe's contract alone and run
   against Sherehe's live URL; Ujuzi's results on Kazi recorded in PARTNER_TEST_RESULTS.md.
R7 Containment: when Sherehe is down, 22, 23 and 25 answer 502 { message } and endpoints 1-21 are unaffected;
   the poller retries later instead of crashing; a test against the stub proves it.
R8 Change control: contract changes are versioned, logged in CONTRACT_DEVIATIONS.md, and Ujuzi's
   sub-team is told before deploy.
R9 End to end: scripts/ringCheck.ts (`npm run ring:check`) makes one live read from Sherehe with the
   real key, checks it against types/sherehe.d.ts, and calls Kazi's own endpoints 1, 5 and 6 on its
   deployment. Steps 1-6 of the demo story involve Kazi; keep screenshots in evidence/ring/.

# Stage 3: documents (every file the change touches)
The humans will give you starter versions of these files plus NEW_RING_CHANGES.md, a checklist of
every change in this repo; work from them and tick the checklist as you go.
- TEAM_CHARTER.md: ring position Sherehe upstream, Ujuzi downstream; stack updated.
- API_NEEDS.md: replace Shamba Direct's section with K1-K5; rename SettleIn's section to Ujuzi
  (U1-U6); add W7; keep a one-line history note, as the file already does for FundiLink; TODO
  markers for interview-based wording and a new reflection paragraph.
- ENDPOINT_LIST.md: add 22-25 mapped to K and W7 needs.
- openapi.yaml 1.3.0 with 22-25. CONTRACT_DEVIATIONS.md: 1.3.0 entry saying 1-9 are unchanged and
  that the move to Next.js and TypeScript changed no request or response.
- CONTRACT_QUESTIONS.md: section for Sherehe's contract with TODO for 3 questions.
- PARTNER_TEST_RESULTS.md and BLIND_TEST_REPORT.md: new sections with TODOs, never invented results.
- README.md: SettleIn -> Ujuzi; Event work in Part 2; ring partners and their URLs; "run locally"
  now npm install, npm run build, npm start; every command still copy-paste correct.
- .env.example: PORT, DATABASE_URL, SHEREHE_API_URL, SHEREHE_API_KEY, BREVO_API_KEY, MAIL_FROM,
  APP_URL.
- evidence/ring/ with a README listing what each screenshot proves.

# How you work
- Git: all new-ring work happens on the `uat` branch, never on `main`. `main` is what Render
  deploys and what Ujuzi calls live, so it changes only when the humans merge `uat` into it after
  every check passes. For each stage, branch from `uat` (for example uat-stage1-sherehe), open a
  pull request back into `uat`, and stop for review. Before any change, run
  `git branch --show-current` and confirm you are on `uat` or a branch made from it.
- To test the ring before that merge, the humans may deploy `uat` as a separate Render service.
  Never point Ujuzi or Sherehe at it without their sub-teams agreeing.
- One stage at a time; summarise and stop for review after each.
- Before every commit: npm run typecheck (from Stage 2), npm test and npm run verify all pass.
  No `any` unless a comment explains why.
- Never invent interview notes, peer-review comments, partner test results or blind-test outcomes.
- Stop and ask before: changing any behaviour of endpoints 1-21; handing off or changing
  openapi.yaml; touching the live database, Render settings or deployment; deleting files other
  than the Express route files and index.html in Stage 2.

# First task
Read the repo, then propose the exact diff plan for Stage 1 (files, migration SQL, the 22-25
handlers, the poller) and stop for approval before writing code.
