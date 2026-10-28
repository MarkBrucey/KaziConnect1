# Security audit: Kazi Connect (Week 9)

Reviewed on 27 October 2026, on the code of the `uat-week9-security` branch, by running every check below against a real running server (in-memory data, with the Sherehe stand-in for Event work) and reading its replies the way an attacker would. Nothing here is copied from a template: each line says what was done and what came back.

## What was added this week

1. **API keys on every endpoint** (Endpoints 1 to 25, and the WebSocket of Endpoint 6). One key per consumer: Ujuzi, the Kazi Connect website, our own team. A call without a valid `X-API-Key` answers `401 { "message": "Missing or invalid API key" }` before any handler runs. Keys are read from the environment (`API_KEYS`), never from source code, compared by their SHA-256 with no early exit, and never printed: the server logs only how many are loaded and the consumers' names. `.env` is in `.gitignore`; `.env.example` has placeholders.
2. **A rate limit per consumer:** 100 calls a minute by default, `429` with a `Retry-After` header and a JSON body past it. Wrong keys are limited per address (20 a minute), so a key cannot be guessed quickly.
3. **It is switched on by a setting** (`API_KEYS`, or `REQUIRE_API_KEY=true` to fail closed). With neither set the API stays open, which is how the 156 original tests, the 151 recorded Express answers and `npm run verify` still pass untouched. A deployment must set it: **TODO for the humans, in Render's settings, before the live address is switched over.**

## The rate limit, demonstrated

Run with the limit lowered to 3 (`API_RATE_LIMIT=3`) and a real key, five calls in a row, then the sixth call's full reply. The real run, copied from the terminal:

```text
1) no key:
HTTP/1.1 401 Unauthorized
{"message":"Missing or invalid API key"}
2) wrong key:
HTTP/1.1 401 Unauthorized
{"message":"Missing or invalid API key"}
3) real key (team):
HTTP 200

--- rate limit demo (limit is 3 per minute): five calls with the same key
200 200 200 429 429

--- the 429 itself:
HTTP/1.1 429 Too Many Requests
access-control-allow-origin: *
retry-after: 60
{"message":"Too many requests","retryAfter":60}

--- another consumer is not affected (ujuzi key):
HTTP 200
--- OPTIONS preflight, no key:
HTTP 204
--- /openapi.yaml and /docs, no key:
openapi 200  docs 200
```

The same behaviour is in the automated tests (`__tests__/apiKeys.test.ts`, 58 tests): one request per operation listed in `openapi.yaml` proves each answers 401 without a key, so an endpoint added later cannot be left open; `200 200 200 429 429`, the `Retry-After` header and JSON body, one consumer not affecting another, the window starting again, per-visitor allowance for the website key, key guessing slowed down, the WebSocket (header, browser subprotocol, 401, 429), and the website pages carrying only the website key. The breaks that matter were tried on purpose (the proxy check removed, the WebSocket check removed, the per-visitor allowance removed, the wrong-key limit removed): the tests failed each time.

## The threshold, and why

**100 calls a minute for each consumer** (about 1.7 a second, sustained). Chosen from what the consumers really do, not guessed:

- **Ujuzi** follows each pending application over one WebSocket (one connection, one call to open it) and polls every 2 minutes as a fallback, and reads job matches through a 5-minute cache of its own. That is a few calls a minute even with many graduates.
- **A person using the website** stays far below it. The whole README walkthrough (30 command blocks, dozens of calls, run in a row by a script as fast as it can) ran **without one 429** at the default limit, with keys switched on.
- **A buggy loop** (five calls a second, say) hits it within 20 seconds and gets `429` with a `Retry-After` it can obey, instead of taking the server down.
- **The website's key is shared by every visitor**, so one limit for the key would let one visitor lock out everyone. The `website` consumer is therefore counted per visitor address (from the host's `X-Forwarded-For`), each with its own 100.
- It can be changed without code: `API_RATE_LIMIT`, `API_RATE_WINDOW_MS` (`0` turns it off).

**Honest limits of the limiter:** it lives in the server's memory, so it starts again when the server restarts and does not add up across several copies of the server (a production service would keep the counts in a shared store such as Redis). On the free Render server, which sleeps and wakes, that means the counts reset when it wakes. The address behind `X-Forwarded-For` can be set to anything by a caller who reaches the server directly; behind Render it is the real address. Keys are rate limited per consumer, not per student.

## The checklist (Part D)

### 1. Sensitive fields

**Looked at:** every field name in every kind of reply: register, login, me, post a job, list jobs, one job, job status, apply, application status, applicants of a job, my jobs, my applications, event openings, make an offer, list offers, password reset, accept an application (18 replies in all), flagging any name that looks like a password, hash, salt, secret, key, internal or reviewer note, owner id, Sherehe id, draft or token.
**Found:** nothing wrong. No password hash, internal notes, reviewer notes, employer id, creator id, Sherehe offer id, job draft or role id ever appears. The only field that matched is `token`, in the register and login replies, which is the login token the caller is meant to receive (it is stored only as a hash on our side). An employer sees an applicant's `studentName` and `studentId` (needed to decide on an application) and never their email; a person sees only their own email, in `GET /api/me`. Every reply is built from an explicit list of fields (the mappers), not from a raw database row, and the existing tests assert the exact field set of each reply.
**Fixed:** nothing needed.

### 2. Other people's data

**Looked at:** logged in as two employers and two students, tried each thing across the line. Employer two reading employer one's applicants: `403`. Closing employer one's job: `403`. Accepting an application on it: `403`. Withdrawing employer one's staffing offer: `403 "You can only withdraw offers you made."`. Employer two's offer list is empty, and so is student two's application list. A student posting a job or reading Event work: `403`. A logged-out token: `401`.
**Found:** the login-protected endpoints (10 to 21, 22 to 25) are correct. **One real weakness, by design and not fixed:** Endpoints 1 to 9 have no login, because Ujuzi calls them on a graduate's behalf. Anyone holding a valid API key who knows or guesses an application's id can read its status, and reschedule or withdraw it (real example: `PUT /api/applications/app_1006` from a caller with no login answered `200` and changed the date). Ids count up from `app_1001`, so they can be guessed. A key says which system is calling, not which student the application belongs to.
**Fixed:** the key requirement narrows who can do this from "the whole internet" to "a holder of one of our keys". **Not fixed:** binding each application to the consumer that created it, so that Ujuzi can only touch Ujuzi's applications. It is a real improvement worth doing next, but it changes the behaviour of Endpoints 7 to 9 for the website (whose applications are created under the website key), so it needs Ujuzi's agreement first. Recorded here and in the README's known limits.

### 3. Error messages

**Looked at:** a malformed percent escape in an id, a body that is not JSON, a JSON array where an object is expected, a body over 20 KB, an unknown path, a wrong method, a SQL-looking id, a 5,000-character id, a password reset for an unknown email, login with a wrong password and with an unknown email.
**Found:** no stack trace, file path, query or table name in any reply. Malformed JSON is `400 "Request body is not valid JSON"`, too large is `413`, an unknown path is a bare `404`, login gives the same `401 "Email or password is incorrect."` for a wrong password and an unknown email, and a password reset gives the same `202` whether or not the account exists. The server's own mistakes are `500 "Internal server error"` and Sherehe's are `502` with a fixed message; neither passes on anything the failing system said. Two small findings: **a malformed percent escape in an id answers `500`** (an error the caller caused should be a `400` or `404`; left as it is because Endpoints 1 to 21 must answer exactly as they did before the move to Next.js, and it leaks nothing); and **registering with an email that already exists answers `409 "An account with this email already exists. Log in instead."`, which tells a stranger the email has an account.** Kept on purpose: sign-up has no email verification, so a neutral answer would need an email flow we do not have, and people need the hint. The cost is accepted and limited by the rate limit; password reset and login do not reveal it.
**Fixed:** nothing needed beyond the above.

### 4. Write endpoints and extra fields

**Looked at:** `POST /api/jobs` with `id`, `employer_id` and `status`, then with `isAdmin`; `POST /api/auth/register` with `role: "admin"`, then with `isAdmin` and `id`; `POST /api/applications` with `status: "accepted"`; `PUT /api/applications/{id}` changing `jobId`; `PATCH /api/jobs/{id}` adding `title`; `PATCH /api/applications/{id}` adding `studentId`; `POST /api/staffing-offers` with `status` and `jobId`.
**Found:** every one answered `400 "Unknown field(s): ... Allowed fields: ..."` (and `role must be student or employer`), and nothing was saved. Each write endpoint accepts an explicit list of fields and refuses the rest.
**Fixed:** nothing needed.

### 5. Keys in the wrong place

**Looked at:** the files git tracks (only `.env.example`; `.env` is ignored and absent from the folder); every line ever added on any branch, matching Brevo keys, private-key blocks, AWS and GitHub token shapes, `sk-` keys and `postgres://user:password@` addresses; every assignment of a long value to a name containing KEY, SECRET, PASSWORD or TOKEN in a tracked file; every `console` call in the server's code; and what the server actually printed during this audit.
**Found:** no real key or password in the files or the history. One match, a fake password in a test fixture (`__tests__/migrate.test.ts`), which exists to prove the migration tool never prints a password. The demo accounts' password (`KaziDemo2026`) is in the README on purpose; it is public sample data. The README shows only `<your-api-key>`. **One real leak, fixed:** with no email service configured, the mailer printed the whole password-reset email, including a working reset link, to the server log. On your own computer that is the point (the README says the link is printed), but on a deployment anyone who can read the logs could take over an account. Now, once API keys are switched on (which is what a deployment is), the log gets only a note ("Not emailed to ...; set BREVO_API_KEY and MAIL_FROM") and never the link; a test (`__tests__/mailerLog.test.ts`) proves it and fails if the link comes back. The Sherehe key is sent only in a request header and never logged.
**Also checked:** the startup log says how many keys are loaded and their consumers' names, never a key (tested); a key shorter than 16 characters is ignored with a warning that does not print it.

## What was not fixed, and why

| Finding | Why it stays | What would fix it |
|---|---|---|
| Endpoints 1 to 9 can be used on any application by anyone holding a key | Ujuzi must call them without a login; the key narrows who, not which application | Bind each application to the consumer that made it; needs Ujuzi's agreement |
| A malformed `%` in an id answers `500` | Endpoints 1 to 21 must answer byte for byte as before the move | A `400`, with Ujuzi told first |
| The registration `409` reveals which emails have accounts | No email verification to hide it behind | An email verification flow |
| The website's key is public | A browser cannot keep a secret; it only identifies the website and gives each visitor an allowance | Nothing: a person's data is protected by their login token, not by this key |
| The limiter is in memory | Honest limit for this course | A shared store such as Redis |
| CORS allows any origin (`*`) | Needed for Swagger Editor and browser tools; keys are not sent from other sites (the preflight does not allow the header) | Narrow it when the list of browser clients is known |
| `swagger-ui-react` has 4 moderate `npm audit` advisories | No fixed version exists, and it only runs in a visitor's browser on `/docs` reading our own contract (see the README) | Re-check when `sprintf-js` or `swagger-ui-react` publishes a fix |
| A leaked key stays valid until it is removed from `API_KEYS` and the server restarts | No key store or revoke endpoint | Hashed keys in the database with a revoke call |

## How to check it again

```bash
npm test            # 691 tests, including __tests__/apiKeys.test.ts and __tests__/mailerLog.test.ts
npm run verify      # the 82 contract checks (run open, as always)
API_KEYS="team:$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")" npm start   # then call it without a key: 401
```

Nothing in this file is a real key.
