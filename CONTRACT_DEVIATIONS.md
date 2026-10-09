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

These changes add the FundiLink website's own needs (Statements F1 to F5 in API_NEEDS.md) on top of what SettleIn needs. Endpoints 1 to 9 keep the same paths, methods, inputs and status codes, and SettleIn still needs no account to use them.

## Changes that affect SettleIn

These have been flagged to Team 1 directly.

**1. Job has three more fields, always present: `area`, `duration` and `urgent`**
What changed: every Job, from Endpoints 1, 2, 3 and 14, now also includes `area` (the estate, for example `Parklands`), `duration` (plain words, for example `About 2 hours`) and `urgent` (true or false). Nothing was removed or renamed.
Why: the FundiLink website shows the estate, how long the work takes and whether it is urgent, and SettleIn's students benefit from the same detail. A test that checks Job has no extra fields needs these three added to its list.

**2. Application status now changes through real employer decisions**
What changed: an employer can accept an application (Endpoint 18). That application becomes `accepted`, every other application still waiting for the same job becomes `filled`, and the job closes. Closing a job (Endpoint 17) also marks its waiting applications `filled`. Subscribers to Endpoint 6 receive each change live.
Why: Statement 5 asks for real time notice when a request is accepted or already filled. Before this change nothing in the API could cause those statuses.

**3. Data is now kept in a database**
What changed: the live API stores its data in PostgreSQL. Applications SettleIn creates are no longer wiped when the free server goes to sleep.
Why: accounts are useless if they disappear. The shapes of all requests and responses are unchanged by this.

## New endpoints

| # | Request | Who | Serves |
|---|---|---|---|
| 10 | `POST /api/auth/register` | anyone | F1 |
| 11 | `POST /api/auth/login` | anyone | F1 |
| 12 | `POST /api/auth/logout` | logged in | F1 |
| 13 | `GET /api/me` | logged in | F1 |
| 14 | `POST /api/jobs` | employers | F2 |
| 15 | `GET /api/me/jobs` | employers | F2 |
| 16 | `GET /api/jobs/{jobId}/applications` | the employer who posted the job | F3 |
| 17 | `PATCH /api/jobs/{jobId}` | the employer who posted the job | F4 |
| 18 | `PATCH /api/applications/{applicationId}` | the employer who posted the job | F3, Statement 5 |
| 19 | `GET /api/me/applications` | students | F5 |
| 20 | `POST /api/auth/password-resets` | anyone | F6 |
| 21 | `PUT /api/auth/password` | anyone with a reset link | F6 |

New schemas: `User`, `AuthResponse`, `NewUser`, `Credentials`, `NewJob`, `EmployerJob`, `Applicant`, `JobStatusUpdate`, `ApplicationDecision`, `PasswordResetRequest`, `NewPassword` and `Message`. `Applicant` is an Application plus `studentName`, used only by Endpoint 16 so an employer sees who applied; it is empty for applications SettleIn creates with its own student IDs, and Application itself is unchanged. New status codes: 401 when no valid login token is sent, and 403 when the account is not allowed to do something. New paths reuse existing ones where REST allows it: posting a job is `POST` on `/api/jobs`, and closing a job or accepting an application are `PATCH` on the resource itself, so no verbs appear in any path.

## Security decisions

1. Passwords are never stored. Each one is scrambled with scrypt and its own random salt.
2. Login tokens are 64 random characters, valid for 7 days or until logout. The database keeps only a hash of each token.
3. A wrong password and an unknown email get exactly the same 401 message, so the API never reveals which emails have accounts.
4. An employer can only see applicants for, close, or accept applications on jobs they posted. Anything else gets 403.
5. "Forgot password?" (Endpoints 20 and 21) always gives the same 202 reply, whether or not the email has an account. Reset links work once, for 30 minutes, and only a hash of each is stored. Setting a new password cancels the account's other reset links and logs it out everywhere. At most 3 reset emails are sent per account per hour.
6. Reset links always use the site's own address from its settings, never the Host header of the incoming request, which an attacker could fake to receive someone else's reset link.
