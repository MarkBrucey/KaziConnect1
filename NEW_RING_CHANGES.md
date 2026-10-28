# Kazi Connect: changes for the new ring

Every file in this repository that changes because Shamba Direct and SettleIn left, Sherehe and Ujuzi joined, and the team stack moved to Next.js, TypeScript, PostgreSQL and Tailwind CSS v4. Stages match CLAUDE.md. Tick each line when done.

**Branch:** all of this happens on `uat`, with one branch per stage cut from `uat` and merged back by pull request. `main` stays as deployed, because Ujuzi calls the live API, and receives `uat` only after the gate in Stage 2 and the ring checks below pass. Render keeps deploying `main`; deploy `uat` as a separate Render service if you want to test the ring before merging.

## Documents already updated in this starter folder (copy them into the repo)

- [x] `TEAM_CHARTER.md`: new ring position (history kept), Event work added to the audit, new stack. Copied in; one fix (Event work is Endpoints 22 to 25, not 22 to 24). **Still TODO for the team:** the sub-team names.
- [x] `API_NEEDS.md`: K1-K5 from Sherehe, U1-U6 for Ujuzi (mapped to SettleIn's old Statements 1-8), W7; the first ring kept as history. Copied in; K1 to K5 were checked against Sherehe's draft contract fields. **Still TODO for the team:** rewrite from the real interviews and write the new reflection.
- [x] `ENDPOINT_LIST.md`: endpoints 22-25 for Event work, the Sherehe endpoints Kazi consumes, and a peer-review table for the new rows. Copied in. **Still TODO for the team:** the peer review of rows 22 to 25.
- [x] `CONTRACT_QUESTIONS.md`: three questions on Sherehe's draft contract, after the Shamba Direct ones. Copied in; each question was checked against `partner-tests/sherehe_openapi.yaml`. Re-check them against the contract Sherehe finally hands off.
- [ ] `CONTRACT_DEVIATIONS.md`: the 1.2.1 to 1.3.0 entry is written, with the evidence that the move to Next.js changed no request or response. **Two TODO dates remain:** when Ujuzi was told (R8), and when 1.3.0 was deployed.
- [x] `PARTNER_TEST_RESULTS.md`, `BLIND_TEST_REPORT.md`: new-ring sections left as TODO for real results. Only one real result is recorded, and it is labelled as what it is: a dry run of our Sherehe tests against our own stand-in (35 passed, 1 skipped). Nothing is recorded for the real Sherehe, for Ujuzi's tests of Kazi, or for a blind test, because none has happened. The test file name in the starter (`sherehe.partner.test.ts`) was wrong; it is `sherehe.partner.js`.
- [x] `CLAUDE.md`: standing instructions for the Kazi agent. Copied in unchanged.
- [x] `.env.example`: new file.
- [x] `partner-tests/README.md`, `partner-tests/sherehe_openapi.yaml`: replace the Shamba Direct files.
- [x] `evidence/ring/README.md`: new folder for the end-to-end demo. It lists the six screenshots and the `ring:check` output the humans still have to take, each marked TODO; none was made up.

## Stage 1: Sherehe integration

- [x] `openapi.yaml`: merge `openapi_1.3.0_additions.yaml` (endpoints 22-25, `PartnerUnavailable`, `EventOpening`, `NewStaffingOffer`, `StaffingOffer`); set `info.version: 1.3.0`. Delete the additions file afterwards. Done. The additions file stayed in the starter folder and was never copied into this repository, so there is nothing to delete here.
- [x] New: `clients/fetcher`, `clients/shereheClient`, `eventWorkRoutes`, `offerPoller`. Also `clients/upstreamError` and `sharedLists`.
- [x] `pgStore` and `memoryStore`: `staffing_offers` table and functions; internal `jobs.source_role_id`. The table has one extra column, `job_draft`, so the job can be opened without calling Sherehe again.
- [x] `mappers`, `validation`: Sherehe mappers, `validateStaffingOffer`.
- [x] `server`: start the poller. `app`: mount the new routes.
- [x] Tests: `eventWork` tests and `helpers/shereheStub`; `partner-tests/sherehe.partner` replaces `shambaDirect.partner.js`; delete `shamba_openapi.yaml`. `sherehe.partner` is written and dry-run against the local stand-in only. It has not been run against the live Sherehe, and no result is recorded anywhere.
- [x] `verifyContract`: cover 22-25 against the stub; regenerate `VERIFICATION.md` with `npm run verify`.
- [x] Website: Event work page for employers. Checked by script in a headless DOM, not by eye in a browser. Stage 2 must port it.

## Stage 2: Next.js, TypeScript, Tailwind v4

- [x] `package.json`: `"engines": { "node": ">=20.9" }`; next, react, react-dom, swagger-ui-react; dev deps typescript, @types/node, @types/pg, @types/ws, @types/jest, @types/supertest, openapi-typescript, tailwindcss, @tailwindcss/postcss; scripts dev, build, start, typecheck, types, test, verify, test:partner, ring:status, ring:check, db:migrate. express and swagger-ui-express are removed. `tsx` is in `dependencies`, not dev, because `npm start` runs `tsx server.ts` on the host.
- [x] New: `tsconfig.json` (strict, allowJs for the untouched tests), `jest.config.mjs` (next/jest), `next.config.ts`, `postcss.config.mjs`, `proxy.ts`, `run.sh`, `types/`.
- [x] Converted to `.ts` at the same root paths: `app`, `server`, `db`, `memoryStore`, `pgStore`, `seedData`, `auth`, `mailer`, `realtime`, `mappers`, `validation`, `verifyContract`.
- [x] Route handlers in `app/api/**/route.ts` for Endpoints 1 to 25 and the `[...path]` catch-all; `jobsRoutes.js`, `applicationsRoutes.js` and `accountRoutes.js` are removed.
- [x] Website pages in `app/` with Tailwind (jobs and filters, job detail with apply and live status, login, register, reset, employer dashboard with Event work, student applications, `/docs` with Swagger UI); `Images/` moved to `public/Images/`; `index.html` removed. Checked in a headless DOM (62 checks, against a built copy of the site), not by eye in a browser.
- [x] `.gitignore`: `.next/` and `.env`.
- [x] `start_lab.bat`: `call npm run build` before `call npm start`.
- [ ] Render settings (humans): build command `npm ci && npm run build`, start command `npm start`, Node 20.9 or newer, `SHEREHE_API_URL`, `SHEREHE_API_KEY`.
  Measured on a Mac on 21 October 2026, so a guide and not a promise for Render's Linux machines: a cold `next build` peaks at about 1.0 GB for its largest process (about 0.85 GB with `--webpack`), and the running server uses 145 to 190 MB. Render's free instances have 512 MB, so **the first build may run out of memory** even though the running server fits. Watch the first deploy. If it fails with an out-of-memory message, the options are a paid instance for the build, or building elsewhere and deploying the result; nothing in the code needs to change for either.
- [x] Gate: the 156 existing tests pass with their files untouched (identical to `main`); `npm run typecheck` and `npm run verify` (82 of 82) pass. Whole suite: 691 tests, 690 on the in-memory store plus 1 that runs only with `DATABASE_URL` set; 691 of 691 on PostgreSQL.
- [x] Proof that Endpoints 1 to 21 did not change: 151 recorded Express answers replayed (`__tests__/parityWithExpress.test.js`), and a live side-by-side run of 154 requests and 3 WebSocket connections against Express on `main`. See `CONTRACT_DEVIATIONS.md`.

Where this stage differs from the starter brief, on purpose:

- `npm start` is `tsx server.ts` with no `NODE_ENV=production` in front: `bootstrapEnv.ts` sets it, so the same command works in Command Prompt, PowerShell and bash. `npm run dev` passes `--dev`.
- The WebSocket for Endpoint 6 is handled in `realtime.ts`, which answers every `upgrade` request itself. Next.js attaches its own upgrade listener lazily, and it closes sockets that are not its own.
- Next.js route handlers get their own copies of each module, so state that must be shared (the in-memory store, the PostgreSQL pool, the mail outbox, the Sherehe cache) lives in `lib/singleton.ts`.

## Stage 3: README.md (Week 8 deliverable)

- [x] Replace SettleIn with Ujuzi. The README now uses U1 to U6, with one table that maps them to SettleIn's old statements; the only remaining mentions of SettleIn are that table. `openapi.yaml`'s five descriptions that named SettleIn now name Ujuzi (approved by the user; wording only, recorded in `CONTRACT_DEVIATIONS.md`).
- [ ] Add the ring: Sherehe upstream with its URL, Ujuzi downstream with its URL. The ring section and both rows are in; **both addresses are TODO** until the sub-teams deploy.
- [x] Add Event work (endpoints 22-25) with real requests and replies. It is Part 3 rather than part of Part 2, because it needs a different setup. The replies come from a local run against our stand-in for Sherehe, and the README says so. **TODO:** capture them again against the real Sherehe.
- [x] "Run the API on your own computer": Node.js 20.9 or newer, `npm install`, `npm run build`, `npm start`, the startup output after the move, the ring commands, the settings table, and a note that the 4 moderate `npm audit` advisories all come through `swagger-ui-react`.
- [ ] Re-run every command from a clean terminal, then repeat the blind test with a team outside the ring. Every bash block of the README (28 of them) was run in order against a fresh local copy and matched its printed reply, and `sh run.sh` was run from a fresh clone. **Not done:** the PowerShell blocks (no Windows computer), and the blind test, which needs a team outside the ring.

## Ring checks (all three repos, same day)

- [x] A runbook for this day is in `evidence/ring/LIVE_RUNBOOK.md`: deploy order, the read-only preview of the one-place data repair, the key wiring, the layered checks and the demo story. Nothing in it has been run against Render yet.
- [ ] Merge `uat` into `main` by pull request, then confirm the live API still answers every README command.

- [ ] `npm run ring:check` passes in Sherehe, Kazi Connect and Ujuzi.
- [ ] Ujuzi has re-run its partner tests against Kazi 1.3.0.
- [ ] The nine-step demo story runs on the live systems; screenshots in `evidence/ring/`.

## Week 9: API keys, rate limits and the security audit

- [x] API key check on every endpoint, 1 to 25, and on the Endpoint 6 WebSocket (a browser sends the key as the subprotocol `kazi-key.<key>`). Off unless `API_KEYS` is set, so the 156 original tests and the recorded Express answers pass untouched. Agreed with the project owner on 27 October 2026 (R4 allows closing Endpoints 1 to 9 when both sides agree); logged in `CONTRACT_DEVIATIONS.md`.
- [x] Rate limit per consumer (100 a minute by default; the `website` key per visitor), `429` with `Retry-After` and a JSON body; wrong keys limited per address. Demonstrated with a real `200 200 200 429 429`.
- [x] `openapi.yaml`: `ApiKey` security scheme, a `401` and a `429` on all 24 operations. The version stays 1.3.0 because 1.3.0 has not shipped.
- [x] `README.md` (new section, error table, settings), `.env.example`, `SECURITY_AUDIT.md` (a real review, with what was not fixed and why), new tests (`apiKeys`, `mailerLog`, and key support in the ring tools), all verified: every README command was re-run against a keys-on server.
- [x] A finding fixed: with no email service, the password-reset link was printed to the log. It is now printed only on your own computer.
- [ ] Humans: set `API_KEYS` (and `REQUIRE_API_KEY=true`) in Render, issue Ujuzi its key privately, tell Ujuzi before the live address starts asking for keys (R8), and record the dates in `CONTRACT_DEVIATIONS.md`.
- [ ] Ujuzi's client must send `X-API-Key` (and `kazi-key.<key>` is not needed: Ujuzi calls from a server) before the local ring can run with keys on.

## Reading Sherehe's events with their roles in one call

- [x] Sherehe added `GET /api/events?status=upcoming[&county=]&include=roles` (an additive part of its still-unhanded-off 0.1.0 draft; copied into `partner-tests/sherehe_openapi.yaml` with a dated note, types regenerated). Kazi now reads events and roles in ONE call instead of 1 + one per upcoming event (about 40 today, against Sherehe's per-key limit), and falls back to the two-step reads when a Sherehe does not have it (it answers 400 or ignores `include`). `scripts/lib/schemaCheck.ts` learned `anyOf` and `allOf`, which the new contract needs: it had been silently skipping such a reply, so `ring:status` and `ring:check` were no longer checking Sherehe's event list.
- [ ] Not done: honouring `Retry-After` on a 429 from Sherehe; an `include=roles` test in `partner-tests/sherehe.partner.js` for the real Sherehe.
