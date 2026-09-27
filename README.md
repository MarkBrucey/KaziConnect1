# Kazi Connect API

Kazi Connect serves FundiLink job listings and job applications to our downstream ring partner, Team 1 (SettleIn), so their students can find and request nearby casual work. Every endpoint below is numbered as in ENDPOINT_LIST.md, traces back to one of SettleIn's need statements in API_NEEDS.md, is described in `openapi.yaml`, and is verified against it.

* **Week 5:** the GET endpoints, implemented and verified field by field.
* **Week 6:** the write endpoints, with validation first and tested with bad input as well as good.

## Run it

On Windows, the shortcut is to double click **start_lab.bat**. It installs the packages, runs the full contract check, starts the server and opens Swagger UI.

Or by hand. You need Node.js 18 or newer.

```
npm install
npm start
```

Then open **http://localhost:3000/docs** for Swagger UI. Pick an endpoint, click **Try it out**, then **Execute**.

## Verify it against the contract

```
npm run verify
```

This starts the server and sends 44 real requests: every GET endpoint, and every write endpoint with good input and deliberately bad input (missing fields, wrong types, unusable values, unknown IDs). Each real response is checked against `openapi.yaml`, and every rejected request is checked to confirm it left the data untouched. Results are written to `VERIFICATION.md`. Swagger UI screenshots are in the `evidence` folder.

## Endpoints and the needs they serve

Numbered exactly as in ENDPOINT_LIST.md.

| # | Request | Maps to need | Success | Failure cases |
|---|---|---|---|---|
| 1 | `GET /api/jobs?status=active` | Statement 1 | 200, list of Job | 400 status missing |
| 2 | `GET /api/jobs?county={county}&category={category}&status=active` | Statement 2 | 200, list of Job | 400 status missing or filter empty |
| 3 | `GET /api/jobs/{jobId}` | Statements 3, 4 | 200, Job | 404 |
| 4 | `GET /api/jobs/{jobId}/status` | Statement 3 | 200, JobStatus | 404 |
| 5 | `GET /api/applications/{applicationId}/status` | Statement 5 | 200, ApplicationStatus | 404 |
| 6 | `GET /api/applications/{applicationId}/subscribe` (WebSocket) | Statement 5 | 101, then messages | 404, 426 plain HTTP |
| 7 | `POST /api/applications` | Statement 6 | 201, Application | 400 invalid, 409 job closed |
| 8 | `PUT /api/applications/{applicationId}` | Statement 7 | 200, Application | 400, 404, 409 not pending |
| 9 | `DELETE /api/applications/{applicationId}` | Statement 8 | 204, no body | 404, 409 not pending |

Endpoints 1 and 2 are the same route, `GET /api/jobs`; Endpoint 2 simply adds the `county` and `category` filters.

Sample IDs: jobs `job_12345` to `job_12352` (`job_12350` and `job_12352` are closed). Applications `app_1001` to `app_1004`: `app_1002` is accepted and `app_1003` is filled, so neither can be changed or cancelled. New applications get IDs from `app_1005` upward. The sample data resets every time the server restarts.

## Trying the write endpoints in Swagger UI

**POST /api/applications** with this body gives 201:

```json
{ "jobId": "job_12345", "studentId": "stu_0042", "preferredDate": "2027-01-15T09:00:00Z", "note": "Available after 2pm" }
```

Remove `preferredDate`, change `studentId` to a number, or use `2027-02-30T09:00:00Z`, and you get 400 with a message explaining why.

**PUT /api/applications/app_1005** with `{ "preferredDate": "2027-01-22T14:00:00Z" }` gives 200. Try `app_9999` for 404, or `app_1002` (accepted) or `app_1003` (filled) for 409.

**DELETE /api/applications/app_1005** gives 204. Do it again for 404, then check `GET /api/applications/app_1005/status`, which now gives 404 too.

## Testing the WebSocket (Endpoint 6)

Swagger UI cannot open WebSockets. With the server running, open http://localhost:3000/docs, press F12, go to the Console tab and paste:

```js
const ws = new WebSocket('ws://localhost:3000/api/applications/app_1004/subscribe');
ws.onmessage = (e) => console.log(e.data);
```

You see the current status straight away. Then DELETE `app_1004` in Swagger UI, and a final message with status `cancelled` arrives before the connection closes.

## How the code is organised

The rows in `db.js` are shaped like real database rows: `_id`, snake_case names, decimals as strings, dates as Date objects, and internal columns. Every response goes through `mappers.js`, the translation layer that turns a row into the exact shape in `openapi.yaml`. This keeps how we store data separate from what SettleIn reads. Every write goes through `validation.js` first, so invalid data never reaches the data store.

```
openapi.yaml             the contract
CONTRACT_DEVIATIONS.md   every change to the contract, week by week, and why
VERIFICATION.md          results of npm run verify
evidence/                Swagger UI Try it out screenshots, named by endpoint number
start_lab.bat            Windows shortcut: install, verify, start, open Swagger UI
server.js                starts the server on port 3000
app.js                   Express app, JSON bodies, Swagger UI at /docs, error handling
jobsRoutes.js            Endpoints 1, 2, 3 and 4
applicationsRoutes.js    Endpoints 5 to 9
realtime.js              Endpoint 6 WebSocket
validation.js            Week 6 validation, run before every write
mappers.js               database row to contract shape
db.js                    sample data and the write operations
verifyContract.js        the contract checker
API_NEEDS.md, ENDPOINT_LIST.md, TEAM_CHARTER.md, CONTRACT_QUESTIONS.md   earlier weeks
```
