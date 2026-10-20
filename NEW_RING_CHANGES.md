# Kazi Connect: changes for the new ring

Every file in this repository that changes because Shamba Direct and SettleIn left, Sherehe and Ujuzi joined, and the team stack moved to Next.js, TypeScript, PostgreSQL and Tailwind CSS v4. Stages match CLAUDE.md. Tick each line when done.

**Branch:** all of this happens on `uat`, with one branch per stage cut from `uat` and merged back by pull request. `main` stays as deployed, because Ujuzi calls the live API, and receives `uat` only after the gate in Stage 2 and the ring checks below pass. Render keeps deploying `main`; deploy `uat` as a separate Render service if you want to test the ring before merging.

## Documents already updated in this starter folder (copy them into the repo)

- [ ] `TEAM_CHARTER.md`: new ring position (history kept), Event work added to the audit, new stack. Fill in the sub-team names.
- [ ] `API_NEEDS.md`: K1-K5 from Sherehe, U1-U6 for Ujuzi (mapped to SettleIn's old Statements 1-8), W7; the first ring kept as history. Rewrite from the real interviews and write the new reflection.
- [ ] `ENDPOINT_LIST.md`: endpoints 22-25 for Event work, the Sherehe endpoints Kazi consumes, and a peer-review table for the new rows.
- [ ] `CONTRACT_QUESTIONS.md`: three questions on Sherehe's draft contract, after the Shamba Direct ones.
- [ ] `CONTRACT_DEVIATIONS.md`: planned 1.2.1 to 1.3.0 entry. Complete it when 1.3.0 ships.
- [ ] `PARTNER_TEST_RESULTS.md`, `BLIND_TEST_REPORT.md`: new-ring sections left as TODO for real results.
- [ ] `CLAUDE.md`: standing instructions for the Kazi agent.
- [x] `.env.example`: new file.
- [x] `partner-tests/README.md`, `partner-tests/sherehe_openapi.yaml`: replace the Shamba Direct files.
- [ ] `evidence/ring/README.md`: new folder for the end-to-end demo.

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

- [ ] `package.json`: `"engines": { "node": ">=20.9" }` (current Next.js needs Node 20.9 or newer; today it says `>=18`); add next, react, react-dom, swagger-ui-react; dev deps typescript, tsx, @types/node, @types/pg, @types/ws, @types/jest, @types/supertest, openapi-typescript, tailwindcss, @tailwindcss/postcss; scripts dev, build, start, typecheck, types, test, verify, test:partner, ring:check, db:migrate. Remove express and swagger-ui-express only after parity.
- [ ] New: `tsconfig.json` (strict, allowJs for the untouched tests), `jest.config.mjs` (next/jest), `next.config.ts`, `postcss.config.mjs`, `proxy.ts`, `run.sh`, `types/`.
- [ ] Convert to `.ts` at the same root paths: `app`, `server`, `db`, `memoryStore`, `pgStore`, `seedData`, `auth`, `mailer`, `realtime`, `mappers`, `validation`, `verifyContract`.
- [ ] Route handlers in `app/api/**/route.ts` for endpoints 1-25 and the `[...path]` catch-all; then remove `jobsRoutes.js`, `applicationsRoutes.js`, `accountRoutes.js`.
- [ ] Website pages in `app/` with Tailwind; move `Images/` to `public/`; then remove `index.html`.
- [ ] `.gitignore`: add `.next/` and `.env`.
- [ ] `start_lab.bat`: add `call npm run build` before `call npm start`.
- [ ] Render settings (humans): build command `npm ci && npm run build`, start command `npm start`, Node 20.9 or newer, `SHEREHE_API_URL`, `SHEREHE_API_KEY`.
- [ ] Gate: the 156 existing tests pass with `__tests__/` untouched; `npm run typecheck` and `npm run verify` pass.

## Stage 3: README.md (Week 8 deliverable)

- [ ] Replace SettleIn with Ujuzi (22 mentions today). Keep "Statement N" references or switch them to U1-U6 consistently, matching API_NEEDS.md.
- [ ] Add the ring: Sherehe upstream with its URL, Ujuzi downstream with its URL.
- [ ] Add Event work (endpoints 22-25) to Part 2 with real requests and replies.
- [ ] "Run the API on your own computer": Node.js 20.9 or newer (lines 230 and 724 say 18); `npm install`, `npm run build`, `npm start`; the startup output after the move.
- [ ] Re-run every command from a clean terminal, then repeat the blind test with a team outside the ring.

## Ring checks (all three repos, same day)

- [ ] Merge `uat` into `main` by pull request, then confirm the live API still answers every README command.

- [ ] `npm run ring:check` passes in Sherehe, Kazi Connect and Ujuzi.
- [ ] Ujuzi has re-run its partner tests against Kazi 1.3.0.
- [ ] The nine-step demo story runs on the live systems; screenshots in `evidence/ring/`.
