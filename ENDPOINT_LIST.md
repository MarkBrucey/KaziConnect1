# ENDPOINT_LIST.md: Kazi Connect (Team 15)

## Downstream endpoints: Kazi Connect provides to Ujuzi (formerly SettleIn)

These nine endpoints are unchanged. They were designed for SettleIn's Statements 1 to 8; Ujuzi uses them exactly the same way. Statement 1 is now U1, 2 is U2, 3 and 4 are U3, 5 is U5, 6 is U4, and 7 and 8 are U6 (see API_NEEDS.md).

| # | Method | Path/Endpoint | Purpose | Maps to Need |
|---|--------|----------|---------|---------------|
| 1 | GET | `/api/jobs?status=active` | Returns all currently active job/service listings | Statement 1 |
| 2 | GET | `/api/jobs?county={county}&category={category}&status=active` | Filters active listings by location and category near a student's accommodation | Statement 2 |
| 3 | GET | `/api/jobs/{jobId}` | Returns a single job's full details, including status and pay range | Statements 3, 4 |
| 4 | GET | `/api/jobs/{jobId}/status` | Returns just the availability status of a job (lightweight: SettleIn polls this often without pulling the full job payload) | Statement 3 |
| 5 | GET | `/api/applications/{applicationId}/status` | Returns the current status of an application/service request | Statement 5 |
| 6 | GET | `/api/applications/{applicationId}/subscribe` | Opens a WebSocket/SSE stream that pushes status changes in real time (accepted / filled) | Statement 5 |
| 7 | POST | `/api/applications` | Creates a new application/service request from a SettleIn student | Statement 6 |
| 8 | PUT | `/api/applications/{applicationId}` | Updates an existing pending application (e.g., reschedule, edit details) | Statement 7 |
| 9 | DELETE | `/api/applications/{applicationId}` | Cancels a pending application/service request | Statement 8 |

## Notes on changes from the first draft

- **#1**: `active` moved from a path segment to a query parameter; it's a filter on the `jobs` resource, not a distinct resource itself.
- **#3/#4**: Kept `pay-range` and `status` split out only where there's a real reason. A single `GET /jobs/{jobId}` now covers pay range as part of the full resource (folded `pay-range` into it; a separate endpoint for one field wasn't earning its keep). `status` stays split out as a lighter-weight endpoint since SettleIn is expected to poll it frequently.
- **#6**: Flattened from three levels of nesting (`/applications/{id}/status/subscribe`) to two, and replaced the non-standard "GET/WebSocket" method with a plain `GET` that upgrades to a WebSocket/SSE stream, noted explicitly in the Purpose column since strict REST doesn't have a clean verb for "subscribe."
- **#7, #8, #9**: Previously had no needs statement to justify them. Added Statements 6 to 8 to API_NEEDS.md to close that gap; each write endpoint now traces to something SettleIn actually needs, not something invented while designing.

## Endpoints for the Kazi Connect website (added after Week 7)

These serve the website's own needs, W1 to W6 in API_NEEDS.md. They come on top of Endpoints 1 to 9, which are unchanged and still need no login.

| # | Method | Path/Endpoint | Purpose | Maps to Need |
|---|--------|----------|---------|---------------|
| 10 | POST | `/api/auth/register` | Creates a student or employer account and logs it in | W1 |
| 11 | POST | `/api/auth/login` | Logs in with email and password and returns a token | W1 |
| 12 | POST | `/api/auth/logout` | Logs out, so the token stops working | W1 |
| 13 | GET | `/api/me` | Returns the logged in user | W1 |
| 14 | POST | `/api/jobs` | Posts a new job (employers only) | W2 |
| 15 | GET | `/api/me/jobs` | Lists the jobs the logged in employer posted, with waiting applications | W2 |
| 16 | GET | `/api/jobs/{jobId}/applications` | Lists the applications for a job (the employer who posted it) | W3 |
| 17 | PATCH | `/api/jobs/{jobId}` | Closes or reopens a job (the employer who posted it) | W4 |
| 18 | PATCH | `/api/applications/{applicationId}` | Accepts an application; others for the job become filled | W3, Statement 5 |
| 19 | GET | `/api/me/applications` | Lists the logged in student's applications | W5 |
| 20 | POST | `/api/auth/password-resets` | Asks for a password reset email (Forgot password?) | W6 |
| 21 | PUT | `/api/auth/password` | Sets a new password using the token from the reset email | W6 |

Notes, following the same REST rules as rows 1 to 9:

- Paths are nouns. Logging in and out use the `auth` resource, and `me` stands for the logged in user. A reset is a `password-resets` resource that is created, and setting the password replaces the `password` resource with PUT.
- Posting a job reuses `/api/jobs` with POST, and closing a job or accepting an application use PATCH on the resource itself, so no verbs appear in paths.
- No path nests more than one level below its parent resource.

## Endpoints for Event work (added October 2026, version 1.3.0)

These serve website need W7 and are the only place Kazi Connect calls its upstream partner, Sherehe. Endpoints 1 to 21 are unchanged.

| # | Method | Path/Endpoint | Purpose | Maps to Need |
|---|--------|----------|---------|---------------|
| 22 | GET | `/api/event-openings?county={county}` | Lists open staffing roles on upcoming Sherehe events, as Kazi event openings (employers) | W7 (K1, K2) |
| 23 | POST | `/api/staffing-offers` | Offers Kazi workers for a Sherehe role; a job opens when the organiser accepts (employers) | W7 (K3) |
| 24 | GET | `/api/me/staffing-offers` | Lists the logged in employer's offers and their status (optional) | W7 (K4) |
| 25 | DELETE | `/api/staffing-offers/{offerId}` | Withdraws a pending offer at Sherehe and deletes it here (the employer who made it) | W7 (K5) |

Notes, following the same REST rules:

- `event-openings` and `staffing-offers` are Kazi's own resources, named in Kazi's words; Sherehe's own names (events, roles, offers) stay inside `shereheClient`.
- Status changes arrive by polling Sherehe (K4), so no verb such as `/sync` appears in a path.

## Endpoints Kazi Connect consumes from Sherehe (for reference)

| Method | Sherehe path | Need |
|---|---|---|
| GET | `/api/events?status=upcoming&county={county}` | K1 |
| GET | `/api/events/{eventId}` | K1 |
| GET | `/api/events/{eventId}/roles` | K2 |
| POST | `/api/offers` | K3 |
| GET | `/api/offers/{offerId}` | K4 |
| DELETE | `/api/offers/{offerId}` | K5 |

## Peer review of rows 22 to 25

Reviewed by: TODO (a team outside the ring of Sherehe, Kazi Connect and Ujuzi)

| Reviewer comment | Row | Our response: fixed, or why we kept it |
|---|---|---|
| TODO | | |
