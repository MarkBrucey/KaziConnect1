# Live ring runbook: testing Kazi Connect, Sherehe and Ujuzi on Render

For the day the three systems are live together. Everything here was checked against the local ring first
(`npm run ring:status`, `npm run ring:check`, the partner tests); what has NOT been run is any of it against Render.
Never paste a real key into a chat, a file in git, or this document: keys live only in Render's settings and your `.env`
(which git ignores). Placeholders below look like `<kazi-key>`.

## 0. Where things stand (checked 28 October 2026)

- The live Kazi Connect on Render is still **version 1.2.1**, the old Express code: Event work answers 404, there are no
  API keys, and none of the one-place rule or the one-call Sherehe read exists there. `main` on GitHub has not changed
  since 13 October; everything new is on `uat`. **So deploying Kazi 1.3.0 comes before any ring test on Render.**
- Sherehe and Ujuzi have no Render address yet (`sherehe-TODO` and `ujuzi-TODO` in `.env.example`).

## 1. Before Kazi is deployed

1. **Preview what the new start-up repair will change in production data.** The first start of 1.3.0 against the production
   database enforces "a job has one place": it marks extra accepted applications for one job `filled`, marks applications
   still `pending` on an already-filled job `filled`, then adds a unique index. That can change statuses Ujuzi is following,
   so look first. Take a snapshot or branch of the Neon database, then run these two read-only queries (they change nothing):

   ```sql
   -- A. jobs with more than one accepted application (the repair keeps the one accepted first, marks the rest filled)
   SELECT job_ref, array_agg(_id ORDER BY updated_at, _id) AS accepted_applications
   FROM applications WHERE application_status = 'accepted'
   GROUP BY job_ref HAVING count(*) > 1;

   -- B. applications still pending on a job that already has an accepted one (the repair marks them filled)
   SELECT a._id, a.job_ref, a.student_id, a.created_at
   FROM applications a
   WHERE a.application_status = 'pending'
     AND a.job_ref IN (SELECT job_ref FROM applications WHERE application_status = 'accepted');
   ```

   No rows from either means the repair changes nothing. Rows mean real people's statuses will change: decide first, and tell
   Ujuzi. The server prints each change at start-up as `[data] ...`.
2. **Render settings for Kazi:** build command `npm ci && npm run build`, start command `npm start`, Node 20.9 or newer,
   `SHEREHE_API_URL` and `SHEREHE_API_KEY` (once Sherehe exists). **Leave `API_KEYS` and `REQUIRE_API_KEY` unset for now**, so
   Ujuzi's tests keep working. The first build may run out of memory on the free tier (about 1 GB measured on a Mac for a cold
   build; the running server needs 145 to 190 MB): watch it, and if it fails with an out-of-memory message the options are a
   paid instance for the build or building elsewhere.
3. **Tell Ujuzi before the deploy** (requirement R8) and write the date in `CONTRACT_DEVIATIONS.md`.
4. Merge `uat` into `main` by pull request. Render deploys from `main`.

## 2. Check Kazi 1.3.0 on its own (read-only, repeat freely)

Put these in `.env` in the Kazi repo (it is read by the tools; git ignores it):

```text
KAZI_URL=https://kaziconnect1-1xmu.onrender.com
```

```bash
npm run ring:status        # Kazi should say CURRENT (1.3.0) and "Endpoint 22 exists [401]"
```

Then run the README's command blocks against the live address, as the Part 1 to 3 walkthrough says. A service that has been idle
takes about a minute to wake: the first request is slow, so wait for it (`ring:status` waits up to `RING_TIMEOUT_MS`, 60 seconds
by default).

## 3. Bring up Sherehe and Ujuzi, then connect them (keys one direction at a time)

Each system keeps only the hash of the keys it issues, and the system that calls sends the raw key as `X-API-Key`. Make each
key with that system's own script (`npm run partner:key` in Sherehe, `npm run key:issue -- sherehe` in Ujuzi); for Kazi:
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.

| Direction | Raw key goes to | Hash or entry goes to |
|---|---|---|
| Kazi calls Sherehe | Kazi: `SHEREHE_API_KEY` | Sherehe: `PARTNER_KEYS=kazi:<hash>` |
| Sherehe calls Ujuzi | Sherehe: `UJUZI_API_KEY` | Ujuzi: `PARTNER_KEYS=<name>:<hash>` |
| Ujuzi calls Kazi | Ujuzi: `KAZI_API_KEY` | Kazi: `API_KEYS=ujuzi:<key>,website:<key>,team:<key>` |

Switch Kazi's keys on **last**: set `KAZI_API_KEY` on Ujuzi first, confirm a check passes, then add `API_KEYS` (and
`REQUIRE_API_KEY=true`, so a missing setting closes the API instead of leaving it open) on Kazi and restart it. Add Kazi's own
copy of the team key to your `.env` as `KAZI_API_KEY` for the tools. Record the date in `CONTRACT_DEVIATIONS.md`.

Your `.env` for the checks:

```text
KAZI_URL=https://kaziconnect1-1xmu.onrender.com
KAZI_API_KEY=<team key, once Kazi asks for keys>
SHEREHE_URL=<Sherehe's Render address>
SHEREHE_API_KEY=<the key Sherehe issued to Kazi>
UJUZI_URL=<Ujuzi's Render address>
```

## 4. Test in layers, smallest first

| Layer | Command | What it does to live data |
|---|---|---|
| A. Look | `npm run ring:status` (or the watcher below) | Nothing: only reads |
| B. One throwaway record | `npm run ring:check` | One application on Kazi, cancelled again; one read from Sherehe |
| B. One throwaway record | `npm run ring:status -- --write` | One offer at Sherehe, withdrawn again |
| B. No writes at all | `npm run ring:check -- --read-only` with `RING_APPLICATION_ID=<an existing application>` | Nothing |
| C. Partner tests | `SHEREHE_URL=... SHEREHE_API_KEY=... npm run test:partner` | Offers made and withdrawn at Sherehe |
| D. The story | The demo below | A real job from an accepted offer |

The watcher waits until all three systems are ready, printing only when something changes, and stops by itself:

```bash
npm run ring:status -- --watch --until-ready --interval 600 --log .ring-status.log
```

Sherehe and Ujuzi each have their own `ring:check`; run those from their repositories with their own settings (Sherehe reads
Ujuzi; Ujuzi reads Kazi). Ujuzi's tests of Kazi's contract are theirs to run; ask for the result and record it.

**The demo story (once, with screenshots in this folder; steps 1 to 6 involve Kazi).** Wake all three systems first by opening
each address, and keep Kazi awake throughout: its poller only runs while the server is awake, and by default it checks Sherehe
every 3 minutes (`OFFER_POLL_MS`, 180000), so after the organiser accepts, the job appears within about 3 minutes.

1. As an employer on Kazi, open Event work and see Sherehe's open roles (Endpoint 22).
2. Offer workers for one role (Endpoint 23): the offer is `pending`.
3. As the organiser on Sherehe, accept that offer.
4. Wait for Kazi's poller: the offer shows `accepted` with a `jobId` (Endpoint 24) and the job is in the listings.
5. Through Ujuzi, read job matches for a graduate and apply for that job (Kazi Endpoint 7 with the graduate's own id).
6. As the employer, accept that application on Kazi: the graduate's Ujuzi feed receives `accepted` over the WebSocket.

Afterwards close the job on Kazi so it does not stay in the public listings.

## 5. Reading the results

`ring:status` gives each check a verdict. `not-built`, `not-configured`, `unreachable`, `pending-deploy` and `key-problem`
are **holds**: a part that is missing or not set up yet, not a bug (write them in `HELD_ISSUES.md`). `genuine-error` (a 5xx)
and `drift` (an answer that does not match its contract) are **faults to fix or raise**. Write real results only, where they
belong: `PARTNER_TEST_RESULTS.md`, `INTEGRATION_LOG.md` (the "To fill in" cells), the `HELD_ISSUES.md` rows H-1 to H-6 as each
closes, and the screenshots here. Never fill in a result that was not run.

## 6. Do not run these on the live systems

- The local ring's end-to-end and seed scripts (`ring-local/e2e-kazi-sherehe.js`, `e2e-ujuzi-kazi.js`, `seed-kazi.js`): they
  leave events behind (Sherehe has no delete-event), accepted jobs, and 42 demo jobs in the public listings.
- Anything that prints a key into a log, a chat or a file in git.

## 7. If the live site breaks

- Render, Deploys: redeploy the previous build. (The data repair in section 1 is not undone by a rollback: that is why it is
  previewed first.)
- If the keys are the cause, remove `API_KEYS` (and `REQUIRE_API_KEY`) in Render and restart: the API opens again. Tell
  Ujuzi and Sherehe what happened.
