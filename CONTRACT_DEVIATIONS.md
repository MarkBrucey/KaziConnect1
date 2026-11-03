# Kazi Connect API: Contract Deviations

Every change made to `openapi.yaml` after the Week 4 handoff, what changed, and why the original did not hold up. Endpoint numbers match ENDPOINT_LIST.md. Every change that affects a client has been flagged to our downstream ring partner, Team 1 (SettleIn).

# Week 5: GET endpoints (version 1.0.0 to 1.0.1)

## Changes that affect SettleIn

**Endpoint 1, `GET /api/jobs?status=active` (Statement 1)**
Added a 400 response for when the required `status` query parameter is missing. The original marked it as required but did not say what happens when it is left out.

**Endpoint 2, `GET /api/jobs?county={county}&category={category}&status=active` (Statement 2)**
1. Moved from `GET /api/jobs/search` to query parameters on `GET /api/jobs`, as ENDPOINT_LIST.md specifies. Our Week 3 peer review settled that county and category are filters on the jobs resource, so they belong in the query string, and "search" in a path is a verb. The Week 4 contract drifted from the endpoint list here. `/api/jobs/search` no longer exists.
2. The query parameter `statuts` is now `status`. It was a typo, and Endpoints 1 and 2 now share the same `status` parameter.
3. Added a 400 response for when `status` is missing or `county` or `category` is sent empty.
4. The example category is spelled `accommodation` instead of `accomodation`, to match the stored data.

**Endpoint 4, `GET /api/jobs/{jobId}/status` (Statement 3), added**
This endpoint is in ENDPOINT_LIST.md, but the Week 4 contract left it out. It returns `JobStatus`: `{ "jobId": string, "status": "active" | "closed" }`, or 404 for an unknown job. It is the lightweight availability check SettleIn polls often without pulling the full job.

**Endpoint 5, `GET /api/applications/{applicationId}/status` (Statement 5)**
1. Defined the 200 response body as `ApplicationStatus`: `{ "applicationId": string, "status": string }`. The original promised a response containing the status but gave no shape, so there was nothing to verify against.
2. Added a 404 response for an unknown `applicationId`.
3. The path placeholder `{applicatrionId}` is corrected to `{applicationId}` to match the declared parameter. The URL clients call is unchanged.

**Endpoint 6, `GET /api/applications/{applicationId}/subscribe` (Statement 5)**
1. The success response changed from 200 to 101 Switching Protocols, because a successful WebSocket handshake always answers 101, never 200.
2. Added 404 for an unknown `applicationId`, and 426 Upgrade Required for a plain HTTP request such as Swagger UI's Try it out.
3. Defined the message format. Every message is an `ApplicationStatus` object, sent once on connect and again on every status change. Swagger UI cannot open WebSockets, so this endpoint is verified with a WebSocket client (`npm run verify`).
4. Same placeholder fix as Endpoint 5.

**All GET schemas made precise**
1. `Job`, `JobStatus` and `ApplicationStatus` now list their `required` fields, and every field has a realistic example. The Week 4 standard asks for both, and the original had neither.
2. Job `status` has an enum, `active` or `closed`, and a description saying `active` means the job can still be requested. This keeps what SettleIn reads separate from how the status is stored internally, which was the lesson from our Week 3 peer review.
3. Application `status` has an enum: `pending`, `accepted`, `filled` or `cancelled`. `accepted` and `filled` come from the wording of Statement 5.

## Changes that fix the file only (no effect on clients)

1. Made the file valid so Swagger UI can load it; the original failed to parse. Added `openapi: 3.0.0`, `info` with the title Kazi Connect API, `paths`, and a `servers` entry for `http://localhost:3000`. Renamed `response` to `responses` on every endpoint, because OpenAPI only reads the plural. Moved `components` to the end, because it had cut the application endpoints out of `paths`. Fixed indentation, including the 404 on Endpoint 3, and fixed spelling in summaries.
2. Endpoint 9 is merged into Endpoint 8's path as a `delete` operation, with the same placeholder fix. The original path text `/api/applications/{applicatrionId} (DELETE)` is not a valid path. URLs and methods are unchanged.
3. The comments in the file now use the ENDPOINT_LIST.md numbering, and each endpoint names the need statement it serves.

## Changes to write endpoints made in Week 5

Endpoint 7, `/api/applications`, changed from GET to POST. It creates an application, and a GET must never change data. ENDPOINT_LIST.md already lists it as POST, so the Week 4 contract had drifted.

# Week 6: write endpoints (version 1.0.1 to 1.1.0)

The Week 4 contract gave Endpoints 7, 8 and 9 no request bodies and only a 200 response each, so there was nothing to validate against and no way to report a failure.

**Endpoint 7, `POST /api/applications` (Statement 6)**
1. Added the `NewApplication` request body. `jobId`, `studentId` and `preferredDate` are required, `note` is optional, and no other fields are allowed. Without a body schema there was no validation checklist.
2. `preferredDate` is a `date-time` that must be a real date in the future. Statement 7 is about rescheduling, which only makes sense if an application has a date.
3. The success response changed from 200 to **201 Created**, returning the new `Application` with a Location header.
4. Added **400** with an `Error` message for missing fields, wrong types, unusable values, unknown fields, or a `jobId` that matches no job.
5. Added **409** when the job is closed. This answers Statement 3's question of whether the service is still available to request.

**Endpoint 8, `PUT /api/applications/{applicationId}` (Statement 7)**
1. Added the `ApplicationUpdate` request body: `preferredDate` is required and `note` is optional. A PUT sets an absolute state, so leaving `note` out clears it, and sending the same body twice gives the same result.
2. `jobId`, `studentId` and `status` cannot be changed through PUT; changing the job would really be a new application.
3. The success response now returns the updated `Application`.
4. Added **400** for validation failures, **404** for an unknown ID (a PUT never creates anything), and **409** when the application is accepted or filled, because Statement 7 only allows changes before it is accepted.

**Endpoint 9, `DELETE /api/applications/{applicationId}` (Statement 8)**
1. The success response changed from 200 to **204 No Content**.
2. The application is really deleted, so Endpoint 5 returns 404 for it afterwards.
3. Added **404** for an unknown or already cancelled ID, and **409** when the application is accepted or filled, because Statement 8 only allows withdrawing a pending request.

**Endpoint 6, WebSocket (Statement 5)**
After a DELETE, subscribers receive a final message with status `cancelled`, and the connection closes, so SettleIn can notify the student in real time.

**New schemas:** `Application`, `NewApplication`, `ApplicationUpdate` and `Error`.

# After Week 7: accounts, employer tools and job details (version 1.1.0 to 1.2.0)

These changes add the Kazi Connect website's own needs (W1 to W6 in API_NEEDS.md) on top of what SettleIn needs. Endpoints 1 to 9 keep the same paths, methods, inputs and status codes, and SettleIn still needs no account to use them.

## Changes that affect SettleIn

These have been flagged to Team 1 directly.

**1. Job has three more fields, always present: `area`, `duration` and `urgent`**
What changed: every Job, from Endpoints 1, 2, 3 and 14, now also includes `area` (the estate, for example `Parklands`), `duration` (plain words, for example `About 2 hours`) and `urgent` (true or false). Nothing was removed or renamed.
Why: the Kazi Connect website shows the estate, how long the work takes and whether it is urgent, and SettleIn's students benefit from the same detail. A test that checks Job has no extra fields needs these three added to its list.

**2. Application status now changes through real employer decisions**
What changed: an employer can accept an application (Endpoint 18). That application becomes `accepted`, every other application still waiting for the same job becomes `filled`, and the job closes. Closing a job (Endpoint 17) also marks its waiting applications `filled`. Subscribers to Endpoint 6 receive each change live.
Why: Statement 5 asks for real time notice when a request is accepted or already filled. Before this change nothing in the API could cause those statuses.

**3. Data is now kept in a database**
What changed: the live API stores its data in PostgreSQL. Applications SettleIn creates are no longer wiped when the free server goes to sleep.
Why: accounts are useless if they disappear. The shapes of all requests and responses are unchanged by this.

## New endpoints

| # | Request | Who | Serves |
|---|---|---|---|
| 10 | `POST /api/auth/register` | anyone | W1 |
| 11 | `POST /api/auth/login` | anyone | W1 |
| 12 | `POST /api/auth/logout` | logged in | W1 |
| 13 | `GET /api/me` | logged in | W1 |
| 14 | `POST /api/jobs` | employers | W2 |
| 15 | `GET /api/me/jobs` | employers | W2 |
| 16 | `GET /api/jobs/{jobId}/applications` | the employer who posted the job | W3 |
| 17 | `PATCH /api/jobs/{jobId}` | the employer who posted the job | W4 |
| 18 | `PATCH /api/applications/{applicationId}` | the employer who posted the job | W3, Statement 5 |
| 19 | `GET /api/me/applications` | students | W5 |
| 20 | `POST /api/auth/password-resets` | anyone | W6 |
| 21 | `PUT /api/auth/password` | anyone with a reset link | W6 |

New schemas: `User`, `AuthResponse`, `NewUser`, `Credentials`, `NewJob`, `EmployerJob`, `Applicant`, `JobStatusUpdate`, `ApplicationDecision`, `PasswordResetRequest`, `NewPassword` and `Message`. `Applicant` is an Application plus `studentName`, used only by Endpoint 16 so an employer sees who applied; it is empty for applications SettleIn creates with its own student IDs, and Application itself is unchanged. New status codes: 401 when no valid login token is sent, and 403 when the account is not allowed to do something. New paths reuse existing ones where REST allows it: posting a job is `POST` on `/api/jobs`, and closing a job or accepting an application are `PATCH` on the resource itself, so no verbs appear in any path.

## Security decisions

1. Passwords are never stored. Each one is scrambled with scrypt and its own random salt.
2. Login tokens are 64 random characters, valid for 7 days or until logout. The database keeps only a hash of each token.
3. A wrong password and an unknown email get exactly the same 401 message, so the API never reveals which emails have accounts.
4. An employer can only see applicants for, close, or accept applications on jobs they posted. Anything else gets 403.
5. "Forgot password?" (Endpoints 20 and 21) always gives the same 202 reply, whether or not the email has an account. Reset links work once, for 30 minutes, and only a hash of each is stored. Setting a new password cancels the account's other reset links and logs it out everywhere. At most 3 reset emails are sent per account per hour.
6. Reset links always use the site's own address from its settings, never the Host header of the incoming request, which an attacker could fake to receive someone else's reset link.

# Week 8: documentation only (version 1.2.0 to 1.2.1)

Nothing a client sends or receives has changed: every path, method, field and status code is the same.

1. **Endpoint 6 now shows its message shape.** Its `101` response lists the `ApplicationStatus` object every message carries, with an example, so the docs page shows a response shape for every endpoint, as Week 8 Part A asks.
2. **The login token description is complete.** It read `Bearer <token>`, and the docs page hid `<token>` as if it were code, leaving "Bearer ." It now reads `Bearer YOUR_TOKEN` and says to paste only the token.
3. **One name for the website.** Descriptions now say "Kazi Connect website" instead of the old name FundiLink, and the website's needs are labelled W1 to W6 instead of F1 to F6, matching API_NEEDS.md and ENDPOINT_LIST.md.

# New ring: version 1.2.1 to 1.3.0 (Stage 1 done; complete when 1.3.0 ships)

Nothing a client sends to or receives from Endpoints 1 to 21 changes. Ujuzi, which replaces SettleIn, uses Endpoints 1 to 9 exactly as SettleIn did. Every change in 1.3.0 is an addition.

## Changes that affect Ujuzi

No request, response, field or status code of Endpoints 1 to 9 changes. One thing Ujuzi will notice, and no more: when a Sherehe organiser accepts an offer from one of our employers, Kazi Connect opens a job for that employer, and that job appears in Endpoints 1, 2 and 3 like any other. It has exactly the same fields as every other Job. Its `category` is one of the shared categories (for example `catering`, `security` or `events`), its `county` is spelled as in the shared list of 47 counties, and its `payRange` has the same `min` and `max`, because Sherehe pays one amount per shift. Where the job came from is never shown. Ujuzi can apply to it with Endpoint 7 like any other job.

TODO: record the date Ujuzi's sub-team was told, before 1.3.0 is deployed.

## New endpoints

| # | Request | Who | Serves |
|---|---|---|---|
| 22 | `GET /api/event-openings` | employers | W7 (K1, K2) |
| 23 | `POST /api/staffing-offers` | employers | W7 (K3) |
| 24 | `GET /api/me/staffing-offers` | employers | W7 (K4) |
| 25 | `DELETE /api/staffing-offers/{offerId}` | the employer who made the offer | W7 (K5) |

New schemas: `EventOpening`, `NewStaffingOffer`, `StaffingOffer`. New response: `PartnerUnavailable` (502), used when Sherehe does not answer.

How they behave, inside the contract:

1. **Sherehe failures are a 502 with our own message.** Endpoints 22, 23 and 25 answer `502` with `{ "message": "Event information is unavailable right now. Try again in a minute." }` whenever Sherehe cannot be used: it is down, too slow (10 seconds when a person is waiting), refuses our key, redirects, sends something that is not JSON, or sends a shape its contract does not promise. What Sherehe said is never passed on. When Sherehe is down, Endpoints 1 to 21 are not affected, and Endpoint 24 still works because it reads only our own database.
2. **A withdrawn offer is deleted.** Endpoint 25 withdraws the offer at Sherehe and deletes it here, so `StaffingOffer.status` only ever has `pending`, `accepted` or `declined`.
3. **One waiting offer per role.** Endpoint 23 answers `409` if the role is full at Sherehe, or if Kazi already has a pending offer on it (from any employer). Once that offer is accepted, declined or withdrawn, a new offer is possible.
4. **Status changes arrive by polling.** Sherehe cannot call us, so Kazi Connect asks Sherehe about each pending offer every 3 minutes (and shortly after the server starts). When the organiser accepts, the job opens and the offer's `jobId` is filled in, within about 3 minutes. On the free host the check only runs while the server is awake.
5. **Dates** in the new schemas are whole seconds, like every other date in the API (`2026-12-05T13:00:00Z`).

## Changes to the data store (no effect on clients)

PostgreSQL gets a new table, `staffing_offers`, and an internal column, `jobs.source_role_id`, created by an additive migration when the server starts. Nothing existing is changed or dropped. `source_role_id` is never part of any response.

## API keys and rate limits (Week 9; a change for every caller once switched on)

Every endpoint, 1 to 25, can now require an API key, and every consumer has a rate limit. This changes what a caller must send, so it is logged here before it ships (R8), and it touches Endpoints 1 to 9, which R4 keeps open for Ujuzi unless both sides agree. It was agreed on 27 October 2026 by the person who runs all three systems of the ring, and recorded here; TODO: Ujuzi's sub-team to confirm, and the date it was told (R8).

- **What a caller sends:** the header `X-API-Key: <key>` on every call (a browser WebSocket sends it as the subprotocol `kazi-key.<key>`, because a browser cannot set headers on a WebSocket). A login token is still sent on top of it where an endpoint already asked for one.
- **What a caller gets without it:** `401 { "message": "Missing or invalid API key" }`, and nothing is done. Past the rate limit (100 calls a minute for each consumer by default): `429 { "message": "Too many requests", "retryAfter": <seconds> }` with a `Retry-After` header. Both are declared on all 24 operations in `openapi.yaml`, with an `ApiKey` security scheme.
- **It is a setting, off by default.** With no `API_KEYS` set, nothing changes: every request and response of Endpoints 1 to 25 is exactly as before, which is why the 156 original tests, the 151 recorded Express answers and `npm run verify` pass untouched. Setting `API_KEYS` turns on the key check and the rate limit together; `REQUIRE_API_KEY=true` makes a deployment that forgot `API_KEYS` refuse everything instead of staying open.
- **Who needs a key:** Ujuzi (its own key), the Kazi Connect website (a key named `website`, carried in its pages; every visitor can see it, so it only identifies the website and gives each visitor their own allowance), and our own team. TODO: issue Ujuzi's key privately, and record the date Kazi Connect starts requiring keys on the live address.
- **Left open on purpose:** `/openapi.yaml`, the docs page and the website's pages (documentation, no data), and the browser's `OPTIONS` preflight (it cannot carry a key). The CORS headers are unchanged, so a browser app on another site cannot send the key; keys are for systems that call from a server.
- **The version stays 1.3.0,** because 1.3.0 has not shipped; the first deployed version that has keys is the one Ujuzi's frozen copy must be refreshed from. `SECURITY_AUDIT.md` has the review behind this change and what it did not fix.

## A job has one place (Endpoints 7, 17 and 18; a fix that Ujuzi can notice on Endpoint 7)

This fixes a fault found while testing the website: an employer could accept one applicant, reopen the job, and accept a second, which left two "Accepted" applicants on one job. Statement 5 and Endpoint 18 already said that accepting one application fills the others, so two accepted applicants on one job was never meant to be possible. Now:

1. **Endpoint 17: a job with an accepted applicant cannot be reopened.** Setting its status to `active` answers `409` (new on this endpoint) and the job stays closed, with `{ "message": "Job job_12345 is already filled: application app_1005 was accepted, so it cannot be reopened. Post a new job if you need someone else." }`. Closing a job works as before.
2. **Endpoint 18: a second applicant cannot be accepted.** It answers `409` (a status this endpoint already had) naming the applicant already accepted: `Job ... is already filled: application ... was accepted. Only one applicant can be accepted for a job.`
3. **Endpoint 7: an open job that already has an accepted applicant takes no new requests.** It answers `409` (a status this endpoint already had) with `Job ... is already filled: another applicant was accepted, so it is not accepting applications.` A closed job keeps its old message word for word, so the 151 recorded Express answers still match. In the sample data only `job_12348` is in this state, and `npm run verify` now checks it (82 checks).
4. **The data store enforces it as it writes,** so two requests arriving at the same moment cannot both win. In PostgreSQL a unique index allows at most one accepted request per job. When the server starts it repairs any older data that breaks the rule: the request accepted first keeps the place, the others and anything still waiting on that job become `filled`, and it says in the log what it changed. Nothing is dropped and no column is added.

Nothing a client sends changes, no field is added or removed, and the only new status code is the `409` on Endpoint 17, which is a website endpoint. Ujuzi can see one difference: the message on Endpoint 7 for a job that is open but already filled. `openapi.yaml` shows the new `409` on Endpoint 17 and both messages on Endpoint 7, and `types/api.d.ts` was regenerated with `npm run types`. The version stays 1.3.0, because 1.3.0 has not shipped. `__tests__/onePlacePerJob.test.js` holds the rule with 11 tests. TODO: tell Ujuzi's sub-team about the Endpoint 7 message, and record the date here (R8).

## Wording changes (no effect on clients)

Five descriptions in `openapi.yaml` still named SettleIn, which has left the ring. They now name Ujuzi, which uses the same endpoints: the file's overall description, the description of Endpoint 4, the summary of Endpoint 7 ("on behalf of a graduate"), the description of Endpoint 18 (it now points to Ujuzi's need U5, SettleIn's old Statement 5) and the description of `studentName`. Nothing but text changed: no path, method, field, type, enum, status code or example, so Ujuzi's frozen copy of the contract is not affected, and the version stays 1.3.0 because 1.3.0 has not shipped. The generated `types/api.d.ts` changed in the same four comment lines and nowhere else. The "Statement N" references in the file are left as they were: `ENDPOINT_LIST.md` and the README map them to Ujuzi's U1 to U6.

## Implementation changes with no effect on clients

**The move from Express and JavaScript to Next.js route handlers in strict TypeScript changed no request and no response of Endpoints 1 to 21.** Every path, method, input, output, status code and header is the same; Ujuzi can keep calling Endpoints 1 to 9 exactly as before. What stayed the same on purpose: the empty-body 400 and 404 answers on the read endpoints, `400 { message }` for bad JSON, `413` over 20 KB, the CORS headers and `OPTIONS` answering 204, no `X-Powered-By`, no `ETag`, and unknown `/api` paths answering 404 with no body.

Evidence, from 21 October 2026:

1. **The 156 existing tests** (`__tests__/jobs`, `applications`, `accounts`, `employer` and `passwordReset`) are the same files as on `main`, byte for byte, and all pass.
2. **`npm run verify`** passes all 81 checks: the original 44 for Endpoints 1 to 9 (Week 5: 16, Week 6: 28), unchanged, and 37 new ones for Endpoints 22 to 25 against the Sherehe stand-in.
3. **A replay of recorded Express answers.** `__tests__/parityWithExpress.test.js` sends 151 requests (happy paths, every error path, wrong methods, `HEAD` and `OPTIONS`, trailing slashes and upper-case paths, malformed and compressed bodies, the exact 20 KB limit, malformed ids) and compares every status, every header except `Date`, and every body with what the real Express app on `main` answered. All 151 match.
4. **A live side-by-side run.** The same 154 HTTP requests and 3 WebSocket connections were sent to the Express app from `main` and to this branch, both running for real with fresh data. The only answers that differ are the four new endpoints, 22 to 25, which Express answers with 404 (they do not exist there) and the new app answers with 401 until an employer logs in.

Two things change for people who run the server themselves, not for any client of the API: it needs **Node.js 20.9 or newer** (it was 18; current Next.js requires 20.9), and it must be built once before it starts (`npm run build`, then `npm start`; `npm test` and `start_lab.bat` and `run.sh` do this for you). `NODE_ENV` no longer has to be set by hand.

TODO: the humans change Render's build command to `npm ci && npm run build`, its start command to `npm start`, and its Node.js version to 20.9 or newer, and add `SHEREHE_API_URL` and `SHEREHE_API_KEY`. Record the date here once it is deployed and the live API has been checked again.
