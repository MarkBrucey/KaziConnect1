# Kazi Connect API

Kazi Connect is a REST API of casual jobs and services in Kenya, such as campus work, catering, tutoring, plumbing and other skilled work. It sits in the middle of a ring of three systems: **Sherehe** (events) is upstream, and Kazi Connect reads the open staffing roles on its events; **Ujuzi** (skills training) is downstream, and uses this API to show graduates the jobs near them with their pay ranges, to request a job on a graduate's behalf, to change or withdraw that request, and to tell the graduate the moment it is accepted or already filled. Ujuzi calls the API with no login at all. The same API also powers our own **Kazi Connect website**, where employers post jobs, decide on requests and offer workers for Sherehe events, and where students can keep an account. It is built with Next.js and TypeScript, and keeps its data in PostgreSQL.

| What | Where |
|---|---|
| Live API | https://kaziconnect1-1xmu.onrender.com |
| Interactive docs (Swagger UI, every endpoint) | https://kaziconnect1-1xmu.onrender.com/docs |
| The contract itself | https://kaziconnect1-1xmu.onrender.com/openapi.yaml |
| Kazi Connect website, built on this API | https://kaziconnect1-1xmu.onrender.com |
| Sherehe, our upstream partner (events) | TODO: Sherehe's live address, once its sub-team has deployed it |
| Ujuzi, our downstream partner (skills training) | TODO: Ujuzi's live address, once its sub-team has deployed it |

> **Which version this describes:** 1.3.0. Endpoints 22 to 25 (Event work, Part 3) reach the live address when `uat` is merged into `main` and deployed (TODO: record the date). The live address is on version 1.2.1 until then. Everything else in this README is unchanged and works on the live address today.

> **Before your first request:** the API runs on a free server that goes to sleep after 15 minutes without visitors. The first request after a quiet spell can take **up to a minute** to answer. That is normal: wait for it, don't cancel. Every request after that is fast.

## Quickstart: one command

Open this link in any browser:

https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active

Or run this in a terminal (macOS, Linux, Git Bash, or Windows Command Prompt):

```bash
curl -s -w "\nHTTP %{http_code}\n" "https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active"
```

You get back a JSON list of open jobs and `HTTP 200`. This is the real reply, formatted for reading and trimmed to the first two jobs:

```json
[
  {
    "id": "job_12345",
    "title": "Campus Housing Assistant",
    "category": "accommodation",
    "county": "Nairobi",
    "area": "Parklands",
    "duration": "Part time, 3 months",
    "urgent": true,
    "status": "active",
    "payRange": {
      "min": 15000,
      "max": 22000
    }
  },
  {
    "id": "job_12346",
    "title": "Hostel Front Desk Attendant",
    "category": "accommodation",
    "county": "Nairobi",
    "area": "Kilimani",
    "duration": "Evening shifts",
    "urgent": false,
    "status": "active",
    "payRange": {
      "min": 12000,
      "max": 18000
    }
  }
]
HTTP 200
```

## How this README is organised

| Part | Who it's for | Login |
|---|---|---|
| [Part 1: Finding and requesting jobs](#part-1-finding-and-requesting-jobs-ujuzi) | **Ujuzi**, and any app that lists jobs and requests them for graduates or students. Endpoints 1 to 9 | Never needed |
| [Part 2: Accounts and employer tools](#part-2-accounts-and-employer-tools-kazi-connect-website) | The **Kazi Connect website**: employers posting jobs and accepting requests, students with accounts. Endpoints 10 to 21 | Needed for most |
| [Part 3: Event work](#part-3-event-work-sherehe) | Employers on the website, offering workers for staffing roles on **Sherehe** events. Endpoints 22 to 25 | Employer login |

Parts 1 and 2 meet in one place: when an employer accepts a request in Part 2, every app watching that request live, as Ujuzi does in Part 1, is told straight away. That is Ujuzi's need U5. Parts 2 and 3 meet in another: when a Sherehe organiser accepts an offer from Part 3, a job opens in the listings of Part 1.

Ujuzi's needs are numbered U1 to U6 in `API_NEEDS.md`, and this README uses those numbers. Ujuzi replaced SettleIn as our downstream partner and uses the same endpoints SettleIn did; U1 to U6 replace SettleIn's eight statements:

| Need | Endpoints | SettleIn's old statements |
|---|---|---|
| U1 | 1 | Statement 1 |
| U2 | 2 | Statement 2 |
| U3 | 3, 4 | Statements 3 and 4 |
| U4 | 7 | Statement 6 |
| U5 | 5, 6 | Statement 5 |
| U6 | 8, 9 | Statements 7 and 8 |

## The ring

Sherehe (events) -> Kazi Connect (casual jobs) -> Ujuzi (skills training) -> Sherehe.

| Partner | Direction | What passes between us | Address |
|---|---|---|---|
| **Sherehe** | Upstream: Kazi Connect calls it | K1 to K5: read upcoming events and their open staffing roles, offer workers for a role, read an offer's status, withdraw an offer. Every call carries Sherehe's partner key in `X-API-Key`; the key lives in the server's settings and never in git | TODO |
| **Ujuzi** | Downstream: it calls Kazi Connect | U1 to U6: Endpoints 1 to 9 of Part 1, with no login | TODO |

Sherehe's own words (events, roles, offers) stay inside one module of Kazi Connect and never reach its API: Part 3 uses Kazi Connect's own names, `event-openings` and `staffing-offers`. Sherehe's contract is kept as `partner-tests/sherehe_openapi.yaml`; it is still a draft (version 0.1.0).

## Which terminal to use

| Your computer | Use |
|---|---|
| macOS, Linux, or Windows with **Git Bash** or WSL | The bash commands in Parts 1 to 3 |
| Windows **PowerShell** | [The PowerShell version](#the-same-in-windows-powershell) of Parts 1 and 2 |
| Windows **Command Prompt** (cmd) | Only the quickstart works there. For the rest, open PowerShell instead |
| No terminal at all | The docs page: open https://kaziconnect1-1xmu.onrender.com/docs, pick an endpoint, click **Try it out**, then **Execute** |

Every command is complete: copy it, paste it, press Enter. Run them **in order, in the same window**, because later steps reuse values that earlier steps save, such as `JOB_ID` and `APP_ID`. Text inside JSON that looks like `'"$JOB_ID"'` is how bash puts a saved value into a request; copy it exactly as it is.

Each response shown is the real reply from the live API, formatted for reading, except where Part 3 says otherwise. Your IDs, emails and tokens will be different, and so may the list of jobs, because other people add and close jobs on the live site.

## Part 1: Finding and requesting jobs (Ujuzi)

No account and no token are needed for anything in this part. The steps follow Ujuzi's needs U1 to U6 in `API_NEEDS.md`, and leave nothing behind: the request made in step 5 is withdrawn in step 9.

**Step 1. List the open jobs and services** (U1, Endpoint 1). This is the quickstart command above. `status=active` is required, and returns only jobs that can still be requested.

**Step 2. Find jobs for a skill near a graduate** (U2, Endpoint 2). Add `county`, `category`, or both. Matching ignores upper and lower case, and leaving a filter out means "any".

```bash
curl -s -w "\nHTTP %{http_code}\n" "https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active&county=Nairobi&category=accommodation"
```

```json
[
  {
    "id": "job_12345",
    "title": "Campus Housing Assistant",
    "category": "accommodation",
    "county": "Nairobi",
    "area": "Parklands",
    "duration": "Part time, 3 months",
    "urgent": true,
    "status": "active",
    "payRange": {
      "min": 15000,
      "max": 22000
    }
  },
  {
    "id": "job_12346",
    "title": "Hostel Front Desk Attendant",
    "category": "accommodation",
    "county": "Nairobi",
    "area": "Kilimani",
    "duration": "Evening shifts",
    "urgent": false,
    "status": "active",
    "payRange": {
      "min": 12000,
      "max": 18000
    }
  },
  {
    "id": "job_12350",
    "title": "Bedsitter Caretaker",
    "category": "accommodation",
    "county": "Nairobi",
    "area": "Kasarani",
    "duration": "Ongoing",
    "urgent": false,
    "status": "active",
    "payRange": {
      "min": 8000,
      "max": 10000
    }
  }
]
HTTP 200
```

Every job carries its `payRange` in Kenyan shillings, which is what Ujuzi shows a graduate as expected earnings (U3).

**Step 3. Pick a job and read its details** (U3, Endpoint 3). The first line saves the first open job's ID as `JOB_ID`; the second reads that job.

```bash
JOB_ID=$(curl -s "https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active" | sed -nE 's/^\[\{"id":"([^"]+)".*/\1/p')
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID
```

```json
{
  "id": "job_12345",
  "title": "Campus Housing Assistant",
  "category": "accommodation",
  "county": "Nairobi",
  "area": "Parklands",
  "duration": "Part time, 3 months",
  "urgent": true,
  "status": "active",
  "payRange": {
    "min": 15000,
    "max": 22000
  }
}
HTTP 200
```

**Step 4. Check whether the job can still be requested** (U3, Endpoint 4). A small reply made for checking often: `active` means it can be requested, `closed` means it is filled or withdrawn.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID/status
```

```json
{
  "jobId": "job_12345",
  "status": "active"
}
HTTP 200
```

**Step 5. Request the job for a graduate** (U4, Endpoint 7). `studentId` is Ujuzi's own ID for the graduate (Ujuzi's look like `grd_0101`; the examples here use `stu_0042`). `preferredDate` is when the student can start: a date and time in the future, written like `2027-06-01T09:00:00Z`. `note` is optional, up to 500 characters. The reply is `201`, and the last line saves the request's ID as `APP_ID`.

```bash
APP=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","studentId":"stu_0042","preferredDate":"2027-06-01T09:00:00Z","note":"Available after 2pm on weekdays"}')
echo "$APP"
APP_ID=$(echo "$APP" | sed -nE 's/.*"applicationId":"([^"]+)".*/\1/p')
```

```json
{
  "applicationId": "app_1018",
  "jobId": "job_12345",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-01T09:00:00Z",
  "note": "Available after 2pm on weekdays",
  "status": "pending"
}
```

**Step 6. Check the request's status** (U5, Endpoint 5). `pending` means waiting for the employer. It becomes `accepted` when the employer accepts it, or `filled` when the job goes to someone else.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID/status
```

```json
{
  "applicationId": "app_1018",
  "status": "pending"
}
HTTP 200
```

**Step 7. Get told the moment the status changes** (U5, Endpoint 6). This is a WebSocket, so the graduate is notified without Ujuzi asking again and again. It needs a WebSocket client rather than curl, and runs in a **second** terminal. First, this prints the exact command to run there, with your request's ID already in it:

```bash
echo "npx --yes wscat -c wss://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID/subscribe"
```

```text
npx --yes wscat -c wss://kaziconnect1-1xmu.onrender.com/api/applications/app_1018/subscribe
```

Open a second terminal, paste that printed line and press Enter (it needs Node.js 20.9 or newer). It shows the current status straight away, then one new line every time the status changes. Leave it open and carry on in the first terminal. Here is what the second terminal showed by the end of step 9:

```text
Connected (press CTRL+C to quit)
< {"applicationId":"app_1018","status":"pending"}
< {"applicationId":"app_1018","status":"cancelled"}
```

Each message is one JSON object with `applicationId` and `status`. An employer accepting the request sends `accepted`, the job going to someone else sends `filled`, and withdrawing the request (step 9) sends `cancelled`, after which the server closes the connection.

**Step 8. Change the start date** (U6, Endpoint 8). `PUT` replaces both the date and the note, so leaving `note` out clears it, and sending the same request twice gives the same result. Only `pending` requests can be changed.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PUT https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID \
  -H "Content-Type: application/json" \
  -d '{"preferredDate":"2027-06-08T14:00:00Z","note":"Can start a week later"}'
```

```json
{
  "applicationId": "app_1018",
  "jobId": "job_12345",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-08T14:00:00Z",
  "note": "Can start a week later",
  "status": "pending"
}
HTTP 200
```

**Step 9. Withdraw the request** (U6, Endpoint 9). A successful withdrawal answers `204` with no body, and the request is deleted, so asking for its status afterwards answers `404`, as the second command shows. Only `pending` requests can be withdrawn.

```bash
curl -s -w "HTTP %{http_code}\n" -X DELETE https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID
curl -s -w "HTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID/status
```

```text
HTTP 204
HTTP 404
```

That is everything Ujuzi needs. Part 2 shows the other side: who posts these jobs, and what makes a request become `accepted` or `filled`. Part 3 shows where some of those jobs come from.

## Part 2: Accounts and employer tools (Kazi Connect website)

### Logging in

The website's endpoints need a login token:

1. Get a token by registering (step 10) or logging in (step 11). Both answer with a 64 character `token`.
2. Send it on every request that needs it, in this header:

```text
Authorization: Bearer YOUR_TOKEN
```

3. A token lasts **7 days**, or until you log out (step 21). After that the API answers `401`, and you log in again.

Employers can post, close and reopen jobs, see who requested them, and accept one request, but only for **their own** jobs; anything else answers `403`. Students with an account can list their own requests. Registering, logging in and "Forgot password?" need no token.

**Demo accounts**, if you'd rather not register: `employer@kaziconnect.demo` and `student@kaziconnect.demo`, both with the password `KaziDemo2026`. Other testers use them too, so their data changes all the time. The steps below create fresh accounts of your own instead.

### Employers

**Step 10. Register as an employer** (W1, Endpoint 10). The first line makes a new email address each time, so this works however many times it is run. The reply is `201` with your token, which the last line saves as `TOKEN`. `role` is `employer` or `student`, and passwords need at least 8 characters.

```bash
EMAIL="employer$(date +%s)@example.com"
REG=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Employer","email":"'"$EMAIL"'","password":"choose-a-password-1","role":"employer"}')
echo "$REG"
TOKEN=$(echo "$REG" | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
```

```json
{
  "token": "f0d3a9cd399bad62b0ad8aded3a6052695e69443e7bf89472c1357b1dadc1ca6",
  "user": {
    "id": "usr_1011",
    "name": "Test Employer",
    "email": "employer1791910495@example.com",
    "role": "employer"
  }
}
```

**Step 11. Log in** (W1, Endpoint 11). The reply is `200` with a new token, saved as `TOKEN` again. A wrong password and an unknown email both answer `401` with the same message.

```bash
LOGIN=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"choose-a-password-1"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
```

```json
{
  "token": "c024d100b60e353b2e56c0a854dca8a1fcc5b826c6ce939db23d547e6916fea5",
  "user": {
    "id": "usr_1011",
    "name": "Test Employer",
    "email": "employer1791910495@example.com",
    "role": "employer"
  }
}
```

**Step 12. See who you are logged in as** (W1, Endpoint 13).

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "id": "usr_1011",
  "name": "Test Employer",
  "email": "employer1791910495@example.com",
  "role": "employer"
}
HTTP 200
```

**Step 13. Post a job** (W2, Endpoint 14). It appears in the listings from Part 1 straight away. The reply is `201`, and the last line saves the new job's ID as `JOB_ID`. Leave out `urgent` for a job that isn't urgent; `min` may equal `max` for a fixed price.

```bash
JOB=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix leaking kitchen sink","category":"plumbing","county":"Nairobi","area":"Westlands","duration":"About 2 hours","urgent":true,"payRange":{"min":1500,"max":1500}}')
echo "$JOB"
JOB_ID=$(echo "$JOB" | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
```

```json
{
  "id": "job_12358",
  "title": "Fix leaking kitchen sink",
  "category": "plumbing",
  "county": "Nairobi",
  "area": "Westlands",
  "duration": "About 2 hours",
  "urgent": true,
  "status": "active",
  "payRange": {
    "min": 1500,
    "max": 1500
  }
}
```

**Step 14. A student requests it** (Endpoint 7, exactly as Ujuzi does in step 5). This saves the request's ID as `APP_ID`. To watch it change live, run step 7 again in a second terminal.

```bash
APP_ID=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","studentId":"stu_0042","preferredDate":"2027-06-01T09:00:00Z","note":"Available after 2pm on weekdays"}' \
  | sed -nE 's/.*"applicationId":"([^"]+)".*/\1/p')
echo "$APP_ID"
```

```text
app_1019
```

**Step 15. See who requested your job** (W3, Endpoint 16). Only the employer who posted the job can see this. `studentName` is filled in when the student applied from a Kazi Connect account, and empty otherwise, as here.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID/applications \
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "applicationId": "app_1019",
    "jobId": "job_12358",
    "studentId": "stu_0042",
    "preferredDate": "2027-06-01T09:00:00Z",
    "note": "Available after 2pm on weekdays",
    "status": "pending",
    "studentName": ""
  }
]
HTTP 200
```

**Step 16. Accept a request** (W3 and Ujuzi's U5, Endpoint 18). The request becomes `accepted`, every other request still waiting for this job becomes `filled`, the job closes, and anyone watching those requests live is told straight away.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"accepted"}'
```

```json
{
  "applicationId": "app_1019",
  "jobId": "job_12358",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-01T09:00:00Z",
  "note": "Available after 2pm on weekdays",
  "status": "accepted"
}
HTTP 200
```

**Step 17. List your jobs** (W2, Endpoint 15), newest first, with how many requests are still waiting on each.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me/jobs \
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": "job_12358",
    "title": "Fix leaking kitchen sink",
    "category": "plumbing",
    "county": "Nairobi",
    "area": "Westlands",
    "duration": "About 2 hours",
    "urgent": true,
    "status": "closed",
    "payRange": {
      "min": 1500,
      "max": 1500
    },
    "pendingApplications": 0
  }
]
HTTP 200
```

**Step 18. Reopen or close a job** (W4, Endpoint 17). `status` is `active` or `closed`. Closing a job marks every request still waiting on it as `filled`. This reopens the job for the next step.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}'
```

```json
{
  "id": "job_12358",
  "title": "Fix leaking kitchen sink",
  "category": "plumbing",
  "county": "Nairobi",
  "area": "Westlands",
  "duration": "About 2 hours",
  "urgent": true,
  "status": "active",
  "payRange": {
    "min": 1500,
    "max": 1500
  }
}
HTTP 200
```

### Students with an account

**Step 19. Register a student, request the job, and list their requests** (W1 and W5, Endpoints 10, 7 and 19). When a student requests a job with their account ID as `studentId`, the request appears in their own list.

```bash
STUDENT=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Student","email":"student'"$(date +%s)"'@example.com","password":"choose-a-password-1","role":"student"}')
STUDENT_TOKEN=$(echo "$STUDENT" | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
STUDENT_ID=$(echo "$STUDENT" | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
curl -s -o /dev/null -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","studentId":"'"$STUDENT_ID"'","preferredDate":"2027-06-03T09:00:00Z"}'
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me/applications \
  -H "Authorization: Bearer $STUDENT_TOKEN"
```

```json
[
  {
    "applicationId": "app_1020",
    "jobId": "job_12358",
    "studentId": "usr_1012",
    "preferredDate": "2027-06-03T09:00:00Z",
    "note": "",
    "status": "pending"
  }
]
HTTP 200
```

### Forgot password, and finishing

**Step 20. Forgot password** (W6, Endpoints 20 and 21). The first command asks for a reset email. Its reply is always the same `202`, whether or not the email has an account, so nobody can use it to find out who is registered; if the account exists, it receives a link that works once, for 30 minutes. This example uses an address with no account, so no email is sent. The second command sets a new password with the token from that link (the part after `#reset=`); success answers `204`, and this made up token shows the failure reply.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/password-resets \
  -H "Content-Type: application/json" \
  -d '{"email":"no-account@example.invalid"}'
curl -s -w "\nHTTP %{http_code}\n" -X PUT https://kaziconnect1-1xmu.onrender.com/api/auth/password \
  -H "Content-Type: application/json" \
  -d '{"token":"0000000000000000000000000000000000000000000000000000000000000000","password":"a-new-password-2"}'
```

```json
{
  "message": "If an account exists for that email, we have sent a link to reset its password. The link works for 30 minutes."
}
HTTP 202
{
  "message": "This reset link is not valid or has expired. Ask for a new one."
}
HTTP 400
```

**Step 21. Close your job and log out** (W4 and W1, Endpoints 17 and 12). Closing the job you posted keeps the public listings tidy for the next reader, and the student's waiting request from step 19 becomes `filled`. Logging out answers `204`, and the token stops working straight away, as the last command shows.

```bash
curl -s -o /dev/null -w "Close job: HTTP %{http_code}\n" -X PATCH https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"closed"}'
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me/applications \
  -H "Authorization: Bearer $STUDENT_TOKEN"
curl -s -w "Log out: HTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me \
  -H "Authorization: Bearer $TOKEN"
```

```text
Close job: HTTP 200
[
  {
    "applicationId": "app_1020",
    "jobId": "job_12358",
    "studentId": "usr_1012",
    "preferredDate": "2027-06-03T09:00:00Z",
    "note": "",
    "status": "filled"
  }
]
HTTP 200
Log out: HTTP 204
{
  "message": "Your session has expired or is not valid. Log in again."
}
HTTP 401
```

## Part 3: Event work (Sherehe)

Employers can see staffing roles on upcoming Sherehe events and offer Kazi Connect workers for them (need W7, Endpoints 22 to 25). When the organiser accepts an offer, a job opens for that employer and appears in the listings of Part 1. This is the one place Kazi Connect calls another team's API from code.

> **Read this before running Part 3.** Endpoints 22 to 25 are new in version 1.3.0, so they are not on the live address yet. Sherehe's own address and key are also not shared yet (TODO). Until both are in place, run Part 3 on your own computer against a **stand-in for Sherehe** (`helpers/shereheStub.ts`, the same one the automated tests use). It is not Sherehe: it answers from the examples in Sherehe's draft contract. The replies below were captured from that stand-in, and the data in them (the wedding, its roles and pay) is the stand-in's sample data. TODO: capture them again against the real Sherehe once it is live.

First start the stand-in and Kazi Connect on your own computer (see [Run the API on your own computer](#run-the-api-on-your-own-computer)). In one terminal, run this, which leaves the stand-in running on port 4000:

```text
npx tsx helpers/shereheStub.ts
```

In a second terminal, start Kazi Connect and tell it where Sherehe is. In bash:

```text
SHEREHE_API_URL=http://127.0.0.1:4000 SHEREHE_API_KEY=stub-partner-key npm start
```

In PowerShell:

```text
$env:SHEREHE_API_URL="http://127.0.0.1:4000"; $env:SHEREHE_API_KEY="stub-partner-key"; npm start
```

Then, in a third terminal, register an employer on your own computer. The commands below use `API` for the address, so only this first command names it:

```bash
API=http://localhost:3000
EMAIL="eventwork$(date +%s)@example.com"
TOKEN=$(curl -s -X POST $API/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Employer","email":"'"$EMAIL"'","password":"choose-a-password-1","role":"employer"}' \
  | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
```

**Step 22. See the roles that need workers** (W7, K1 and K2, Endpoint 22). The optional `county` filter is one of the 47 Kenyan counties, spelled as in the shared list. Each opening is one role on one upcoming event, with how many slots are still open and the pay for one shift. The last line saves the first opening's `roleId`.

```bash
OPENINGS=$(curl -s "$API/api/event-openings?county=Nairobi" -H "Authorization: Bearer $TOKEN")
echo "$OPENINGS"
ROLE_ID=$(echo "$OPENINGS" | sed -nE 's/^\[\{"roleId":"([^"]+)".*/\1/p')
```

```json
[
  {
    "roleId": "rol_3003",
    "eventName": "Wanjiku and Otieno wedding",
    "county": "Nairobi",
    "area": "Westlands",
    "startsAt": "2026-12-05T12:00:00Z",
    "title": "Security guards",
    "category": "security",
    "openSlots": 2,
    "payPerShift": 2000
  },
  {
    "roleId": "rol_3001",
    "eventName": "Wanjiku and Otieno wedding",
    "county": "Nairobi",
    "area": "Westlands",
    "startsAt": "2026-12-05T13:00:00Z",
    "title": "Waiters",
    "category": "catering",
    "openSlots": 6,
    "payPerShift": 1500
  }
]
```

**Step 23. Offer workers for a role** (W7, K3, Endpoint 23). `workersOffered` is how many workers you can provide, at least 1, and `note` is optional, up to 500 characters. The reply is `201`, and the last line saves the offer's ID as `OFFER_ID`. The offer is `pending` until the organiser decides.

```bash
OFFER=$(curl -s -X POST $API/api/staffing-offers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleId":"'"$ROLE_ID"'","workersOffered":2,"note":"Two security guards, both with event experience"}')
echo "$OFFER"
OFFER_ID=$(echo "$OFFER" | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
```

```json
{
  "id": "sof_1001",
  "roleId": "rol_3003",
  "eventName": "Wanjiku and Otieno wedding",
  "workersOffered": 2,
  "status": "pending",
  "jobId": null,
  "createdAt": "2026-10-21T07:56:39Z"
}
```

Only one offer can wait on a role at a time, and a role that is already full cannot be offered for. Offering again on the same role answers `409`:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST $API/api/staffing-offers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleId":"'"$ROLE_ID"'","workersOffered":1}'
```

```json
{
  "message": "This role is full, or an offer is already waiting on it."
}
HTTP 409
```

**Step 24. See your offers and their status** (W7, K4, Endpoint 24), newest first. `status` is `pending`, `accepted` or `declined`. `jobId` is `null` until the organiser accepts; then it is the ID of the job that opened for you.

```bash
curl -s -w "\nHTTP %{http_code}\n" $API/api/me/staffing-offers -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": "sof_1001",
    "roleId": "rol_3003",
    "eventName": "Wanjiku and Otieno wedding",
    "workersOffered": 2,
    "status": "pending",
    "jobId": null,
    "createdAt": "2026-10-21T07:56:39Z"
  }
]
HTTP 200
```

**Step 25. Withdraw a waiting offer** (W7, K5, Endpoint 25). Only the employer who made it can, and only while it is `pending`. It is withdrawn at Sherehe and deleted here, so it disappears from the list and a second withdrawal answers `404`.

```bash
curl -s -w "HTTP %{http_code}\n" -X DELETE $API/api/staffing-offers/$OFFER_ID -H "Authorization: Bearer $TOKEN"
curl -s -w "\nHTTP %{http_code}\n" $API/api/me/staffing-offers -H "Authorization: Bearer $TOKEN"
curl -s -w "\nHTTP %{http_code}\n" -X DELETE $API/api/staffing-offers/$OFFER_ID -H "Authorization: Bearer $TOKEN"
```

```text
HTTP 204
[]
HTTP 200
{"message":"Staffing offer sof_1001 not found"}
HTTP 404
```

**What happens when the organiser decides.** Sherehe cannot call Kazi Connect, so Kazi Connect asks Sherehe about each waiting offer every 3 minutes. When the organiser accepts, a job opens for the employer and the offer's `jobId` is filled in, within about 3 minutes. The job is an ordinary Kazi Connect job: its category comes from the role, its county from the event, and its `payRange` has the same `min` and `max`, because Sherehe pays one amount per shift. Ujuzi can request it with Endpoint 7 like any other job. When the organiser declines, the offer becomes `declined` and nothing opens. On the free server this check only runs while the server is awake.

**When Sherehe cannot be reached.** Endpoints 22, 23 and 25 answer `502` with a message that says nothing about Sherehe's side, and change nothing. Endpoint 24 and every endpoint in Parts 1 and 2 keep working. The reply is the same when Sherehe's address or key is not set up. This is what Endpoint 22 answers then:

```json
{
  "message": "Event information is unavailable right now. Try again in a minute."
}
HTTP 502
```

## Error reference

**How to tell success from failure:** look at the status code. Anything from 200 to 299 is success. Anything from 400 up is a failure, and nothing was changed.

**What a failure looks like:** the request endpoints (7 to 9) and every Part 2 and Part 3 endpoint answer with one field, `message`, in plain English:

```json
{ "message": "what went wrong, in plain words" }
```

**One exception:** the read endpoints (1 to 5: listing jobs, one job, a job's status, a request's status) answer `400` and `404` with the status code only and an **empty body**. Check the status code, not the body, for those.

These are real failure replies from the live API. Run them after Part 2, in the same window, because they reuse `STUDENT_TOKEN` and `APP_ID` from it:

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"job_12349","studentId":"stu_0042"}'
curl -s -w "\nHTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"title":"No token sent"}'
curl -s -w "\nHTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/jobs \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Students cannot post jobs","category":"plumbing","county":"Nairobi","area":"Westlands","duration":"About 2 hours","payRange":{"min":1500,"max":1500}}'
curl -s -w "\nHTTP %{http_code}\n" -X DELETE https://kaziconnect1-1xmu.onrender.com/api/applications/app_99999999
curl -s -w "\nHTTP %{http_code}\n" -X DELETE https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/job_99999999
```

```text
{"message":"Missing required field(s): preferredDate"}
HTTP 400
{"message":"Log in first, then send your token as: Authorization: Bearer <token>"}
HTTP 401
{"message":"Only employers can do this."}
HTTP 403
{"message":"Application app_99999999 not found"}
HTTP 404
{"message":"Application app_1019 is accepted; only pending applications can be cancelled"}
HTTP 409

HTTP 404
```

The empty line before the last `HTTP 404` is the empty body of a read endpoint (here, a job that doesn't exist).

| Code | Meaning | Example cause |
|---|---|---|
| `400` | The request is wrong; nothing was changed | A required field is missing, has the wrong type, an unknown field was sent, or a date is in the past |
| `401` | No valid login token (Parts 2 and 3 only) | No `Authorization` header, a mistyped token, an expired token, or after logging out |
| `403` | Logged in, but not allowed (Parts 2 and 3 only) | A student posting a job, or an employer touching another employer's job or offer |
| `404` | That ID doesn't exist | A mistyped ID, or a request or offer that was withdrawn |
| `409` | Not allowed in its current state | Changing or withdrawing a request that is already accepted or filled, requesting a closed job, registering an email that already has an account, or offering for a role that is full or already has an offer waiting |
| `413` | The request body is too large | More than 20 KB of JSON |
| `426` | A plain HTTP request was sent to the live updates endpoint (Endpoint 6) | Use a WebSocket client, as in step 7 |
| `502` | Sherehe could not be reached, or answered in a way Kazi Connect cannot use (Endpoints 22, 23 and 25 only). Nothing was changed, and every other endpoint keeps working | Sherehe is down, or its address or key is not set up. Try again in a minute |

## The same in Windows PowerShell

Open **PowerShell** from the Start menu, then run each block in order, in the same window. PowerShell shows replies as lists rather than raw JSON, and may show dates in your computer's local format; the values are the same as above.

```powershell
# Part 1, steps 1 to 4: find jobs and pick one (no login needed)
$API = "https://kaziconnect1-1xmu.onrender.com"
Invoke-RestMethod "$API/api/jobs?status=active"
Invoke-RestMethod "$API/api/jobs?status=active&county=Nairobi&category=accommodation"
$JOB_ID = (Invoke-RestMethod "$API/api/jobs?status=active")[0].id
Invoke-RestMethod "$API/api/jobs/$JOB_ID"
Invoke-RestMethod "$API/api/jobs/$JOB_ID/status"
```

```powershell
# Part 1, steps 5 to 8: request the job for a student, check it, and change the date
$body = @{ jobId = $JOB_ID; studentId = "stu_0042"; preferredDate = "2027-06-01T09:00:00Z"; note = "Available after 2pm on weekdays" } | ConvertTo-Json
$app = Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body
$APP_ID = $app.applicationId
$app
Invoke-RestMethod "$API/api/applications/$APP_ID/status"
"For live updates (step 7), run this in a second window: npx --yes wscat -c wss://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID/subscribe"
$body = @{ preferredDate = "2027-06-08T14:00:00Z"; note = "Can start a week later" } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$API/api/applications/$APP_ID" -ContentType "application/json" -Body $body
```

```powershell
# Part 1, step 9: withdraw the request
Invoke-RestMethod -Method Delete -Uri "$API/api/applications/$APP_ID"
"Withdrew $APP_ID"
```

```powershell
# Part 2, steps 10 to 12: register an employer, log in, and check who you are
$EMAIL = "employer$(Get-Random)@example.com"
$body = @{ name = "Test Employer"; email = $EMAIL; password = "choose-a-password-1"; role = "employer" } | ConvertTo-Json
$reg = Invoke-RestMethod -Method Post -Uri "$API/api/auth/register" -ContentType "application/json" -Body $body
$body = @{ email = $EMAIL; password = "choose-a-password-1" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$API/api/auth/login" -ContentType "application/json" -Body $body
$AUTH = @{ Authorization = "Bearer $($login.token)" }
Invoke-RestMethod "$API/api/me" -Headers $AUTH
```

```powershell
# Part 2, steps 13 to 18: post a job, a student requests it, see requests, accept, list your jobs, reopen
$body = @{ title = "Fix leaking kitchen sink"; category = "plumbing"; county = "Nairobi"; area = "Westlands"; duration = "About 2 hours"; urgent = $true; payRange = @{ min = 1500; max = 1500 } } | ConvertTo-Json
$job = Invoke-RestMethod -Method Post -Uri "$API/api/jobs" -Headers $AUTH -ContentType "application/json" -Body $body
$JOB_ID = $job.id
$job
$body = @{ jobId = $JOB_ID; studentId = "stu_0042"; preferredDate = "2027-06-01T09:00:00Z" } | ConvertTo-Json
$APP_ID = (Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body).applicationId
Invoke-RestMethod "$API/api/jobs/$JOB_ID/applications" -Headers $AUTH
Invoke-RestMethod -Method Patch -Uri "$API/api/applications/$APP_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"accepted"}'
Invoke-RestMethod "$API/api/me/jobs" -Headers $AUTH
Invoke-RestMethod -Method Patch -Uri "$API/api/jobs/$JOB_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"active"}'
```

```powershell
# Part 2, step 19: register a student, request the job with their account, and list their requests
$body = @{ name = "Test Student"; email = "student$(Get-Random)@example.com"; password = "choose-a-password-1"; role = "student" } | ConvertTo-Json
$student = Invoke-RestMethod -Method Post -Uri "$API/api/auth/register" -ContentType "application/json" -Body $body
$STUDENT_AUTH = @{ Authorization = "Bearer $($student.token)" }
$body = @{ jobId = $JOB_ID; studentId = $student.user.id; preferredDate = "2027-06-03T09:00:00Z" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body | Out-Null
Invoke-RestMethod "$API/api/me/applications" -Headers $STUDENT_AUTH
```

```powershell
# Part 2, steps 20 and 21: forgot password request, close your job, and log out
Invoke-RestMethod -Method Post -Uri "$API/api/auth/password-resets" -ContentType "application/json" -Body '{"email":"no-account@example.invalid"}'
Invoke-RestMethod -Method Patch -Uri "$API/api/jobs/$JOB_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"closed"}' | Out-Null
"Closed $JOB_ID"
Invoke-RestMethod -Method Post -Uri "$API/api/auth/logout" -Headers $AUTH
"Logged out"
```

Part 3 (Event work) is not repeated in PowerShell: the commands above have not been run on a Windows computer, and this README does not show a command nobody has run. Use the bash commands with Git Bash, or the docs page. TODO: add a PowerShell block once it has been run.

When a request fails, PowerShell shows the error in red. Windows PowerShell 5.1 (the version built into Windows) shows only the status code, such as `(401) Unauthorized`; PowerShell 7 also shows the `message`. To see the full failure body on 5.1, use the bash commands in the error reference with Git Bash.

## Run the API on your own computer

You need **Node.js 20.9 or newer** (from https://nodejs.org, the LTS version) and **Git**. The commands are the same on Windows, macOS and Linux.

1. In a terminal, run:

```text
git clone https://github.com/MarkBrucey/KaziConnect1.git
cd KaziConnect1
npm install
npm run build
npm start
```

> Until `uat` is merged into `main` (TODO: remove this note then), clone `uat` instead: `git clone --branch uat https://github.com/MarkBrucey/KaziConnect1.git`.

No Git? Open https://github.com/MarkBrucey/KaziConnect1, click the green **Code** button, then **Download ZIP**. Extract it, open a terminal in the extracted folder that contains `package.json`, and run `npm install`, `npm run build` and then `npm start`.

`npm run build` prepares the website and the API for running, and takes a minute or two. Run it again after you change any code. To work on the code instead, use `npm run dev`, which rebuilds as you save. Two shortcuts do the whole sequence for you (install, build, check against the contract, start): `sh run.sh` on macOS and Linux, and double-clicking `start_lab.bat` on Windows.

`npm install` may end with a note about moderate vulnerabilities, and it is accurate, so here is what it means. `npm audit --omit=dev` (what the server installs) reports 4 moderate ones and none high or critical; all 4 are one chain, `swagger-ui-react` -> `remarkable` -> `argparse` -> `sprintf-js`, and the last link (a denial of service through huge precision specifiers) is affected in every published version, so there is nothing to upgrade to. `swagger-ui-react` is already at its latest release, and the only fix npm offers is a breaking downgrade to version 3.23.3. We kept it because the risk does not apply here: the library draws the `/docs` page, is loaded only in the visitor's own browser (never on the server), and reads only this project's own `openapi.yaml`, so nobody else can feed it a format string. The API does not use it. Plain `npm audit`, which also counts the testing and build tools that the server never runs, reports more moderate ones and no high ones. Check again with `npm audit --omit=dev --audit-level=high` (it should end with no error) and look for a fixed `sprintf-js` or `swagger-ui-react` whenever you update.

After `npm start`, when it is ready, the terminal shows:

```text
> kazi-connect-api@1.3.0 start
> tsx server.ts

Kazi Connect API running on http://localhost:3000
Swagger UI:           http://localhost:3000/docs
Data is stored:       in memory (resets on restart)
Event work (Sherehe): not set up (set SHEREHE_API_URL and SHEREHE_API_KEY); everything else works without it
✓ Running next.config.ts took 16ms
```

2. Open http://localhost:3000/docs for the interactive docs, or http://localhost:3000 for the website. Every command in Parts 1 and 2 works locally too: replace `https://kaziconnect1-1xmu.onrender.com` with `http://localhost:3000`, and `wss://kaziconnect1-1xmu.onrender.com` with `ws://localhost:3000`. Part 3 already uses your own computer.

Things to know when running locally:

* With no settings, data is kept **in memory** and goes back to the sample data every time the server restarts. The sample jobs `job_12345` to `job_12352` and the two demo accounts are always there.
* With no email service set up, password reset links are **printed in the terminal** instead of being emailed.
* Event work needs Sherehe's address and key (`SHEREHE_API_URL` and `SHEREHE_API_KEY`). Without them, only Endpoints 22, 23 and 25 are affected: they answer `502`.
* Run `npm install` from **inside** the project folder. Running it somewhere else, such as `C:\`, fails with `EPERM: operation not permitted`.
* Port 3000 already in use? Start on another port: `PORT=3001 npm start` in bash, or `$env:PORT=3001; npm start` in PowerShell.
* To stop the server, press **Ctrl + C**.

To check everything works:

```text
npm test
npm run verify
npm run typecheck
```

`npm test` builds the app and runs 588 automated tests: 156 for Endpoints 1 to 21, which are the same tests as before the move to Next.js and TypeScript; 211 for Event work, which use a stand-in for Sherehe and never need the real one; and 221 that prove the move changed nothing a client can see and check the tools below. One test needs a PostgreSQL database and is skipped without `DATABASE_URL`, so a plain run reports 587 passed and 1 skipped. `npm run verify` checks the running code against `openapi.yaml` (81 checks), and `npm run typecheck` checks the TypeScript. All three should end with everything passing.

**The ring, from this repository:**

| Command | What it does |
|---|---|
| `npm run ring:status` | Reports how far each of the three systems has got and why a check fails: a part that is not built yet is put on hold (`evidence/ring/HELD_ISSUES.md`), only a wrong answer is a genuine error. It only reads |
| `npm run ring:check` | The end-to-end check of Kazi Connect's part of the ring: one live read from Sherehe with the real key, then Endpoints 1, 5 and 6 on Kazi Connect's own address (`KAZI_URL`, the live site unless you set it). It makes one throwaway application there and cancels it again; add `--read-only` to make nothing. It needs Sherehe's address and key |
| `npm run test:partner` | Our tests of Sherehe, written from its contract alone and run against its real address (`partner-tests/`) |
| `npm run db:migrate` | Creates the tables that are missing in the database `DATABASE_URL` points to. It only adds; `--print` shows the statements without touching a database |

**Optional settings** (environment variables, or a `.env` file in the project folder; copy `.env.example`; a real environment variable wins over the file). The live server uses these; you don't need them locally.

| Setting | What it does |
|---|---|
| `DATABASE_URL` | A PostgreSQL connection address. Data is then kept between restarts. The tables and sample data are created automatically on first start |
| `SHEREHE_API_URL` and `SHEREHE_API_KEY` | Where Sherehe is and the partner key it issued to Kazi Connect. Needed for Event work (Part 3) |
| `OFFER_POLL_MS` | How often Kazi Connect asks Sherehe about waiting offers, in milliseconds (default 180000, minimum 5000) |
| `BREVO_API_KEY` and `MAIL_FROM` | Send password reset emails through Brevo, from the `MAIL_FROM` address |
| `APP_URL` | The site address used in reset links (the live server works it out by itself) |
| `PORT` | The port to listen on (default 3000) |
| `KAZI_URL` and `UJUZI_URL` | Used only by `npm run ring:status` and `npm run ring:check`: Kazi Connect's own address (the live site by default) and Ujuzi's (TODO until it is shared) |

## All endpoints

| # | Request | Login | Success | Serves | Step |
|---|---|---|---|---|---|
| 1 | `GET /api/jobs?status=active` | no | 200 | Ujuzi U1 | 1 |
| 2 | `GET /api/jobs?status=active&county=...&category=...` | no | 200 | Ujuzi U2 | 2 |
| 3 | `GET /api/jobs/{jobId}` | no | 200 | Ujuzi U3 | 3 |
| 4 | `GET /api/jobs/{jobId}/status` | no | 200 | Ujuzi U3 | 4 |
| 5 | `GET /api/applications/{applicationId}/status` | no | 200 | Ujuzi U5 | 6 |
| 6 | `GET /api/applications/{applicationId}/subscribe` (WebSocket) | no | 101 | Ujuzi U5 | 7 |
| 7 | `POST /api/applications` | no | 201 | Ujuzi U4 | 5, 14 |
| 8 | `PUT /api/applications/{applicationId}` | no | 200 | Ujuzi U6 | 8 |
| 9 | `DELETE /api/applications/{applicationId}` | no | 204 | Ujuzi U6 | 9 |
| 10 | `POST /api/auth/register` | no | 201 | Website W1 | 10 |
| 11 | `POST /api/auth/login` | no | 200 | Website W1 | 11 |
| 12 | `POST /api/auth/logout` | yes | 204 | Website W1 | 21 |
| 13 | `GET /api/me` | yes | 200 | Website W1 | 12 |
| 14 | `POST /api/jobs` | employer | 201 | Website W2 | 13 |
| 15 | `GET /api/me/jobs` | employer | 200 | Website W2 | 17 |
| 16 | `GET /api/jobs/{jobId}/applications` | the job's employer | 200 | Website W3 | 15 |
| 17 | `PATCH /api/jobs/{jobId}` | the job's employer | 200 | Website W4 | 18, 21 |
| 18 | `PATCH /api/applications/{applicationId}` | the job's employer | 200 | Website W3, Ujuzi U5 | 16 |
| 19 | `GET /api/me/applications` | student | 200 | Website W5 | 19 |
| 20 | `POST /api/auth/password-resets` | no | 202 | Website W6 | 20 |
| 21 | `PUT /api/auth/password` | no | 204 | Website W6 | 20 |
| 22 | `GET /api/event-openings?county=...` | employer | 200 | Website W7 (K1, K2) | 22 |
| 23 | `POST /api/staffing-offers` | employer | 201 | Website W7 (K3) | 23 |
| 24 | `GET /api/me/staffing-offers` | employer | 200 | Website W7 (K4) | 24 |
| 25 | `DELETE /api/staffing-offers/{offerId}` | the employer who made it | 204 | Website W7 (K5) | 25 |

Full request and response shapes for every endpoint are on the docs page: https://kaziconnect1-1xmu.onrender.com/docs. The need statements themselves are in `API_NEEDS.md`.

## Known limits

* Endpoints 1 to 9 need no login, by design: Ujuzi calls them on behalf of its graduates. It also means anyone who knows a request's ID can change or withdraw it. Any change to how these endpoints work, for security or any other reason, will be agreed with Ujuzi first and recorded in `CONTRACT_DEVIATIONS.md`, so their integration never breaks without warning.
* The free server sleeps after 15 minutes without visitors, so the first request after a quiet spell is slow.
* Reset emails are sent from a Gmail address, so they may land in spam.
* Event work (Part 3) depends on Sherehe. When Sherehe is down, Endpoints 22, 23 and 25 answer `502`; everything else keeps working. An organiser's decision reaches Kazi Connect within about 3 minutes, and only while the server is awake. Only one offer can wait on a role at a time.
* Sherehe's contract is still a draft (version 0.1.0), and Kazi Connect has not yet been run against the real Sherehe. When the final contract arrives, Event work may need small changes.
* The docs page uses a library with 4 moderate-severity advisories in `npm audit` that have no fix yet. They can only matter in the browser page, and not here (see the note under [Run the API on your own computer](#run-the-api-on-your-own-computer)); the API is not affected.

## More documents in this repository

`API_NEEDS.md` (who needs what: K1 to K5, U1 to U6 and W1 to W7), `ENDPOINT_LIST.md` (every endpoint and the need it serves), `openapi.yaml` (the contract), `CONTRACT_DEVIATIONS.md` (every change to the contract and why), `CONTRACT_QUESTIONS.md` (our questions about our partners' contracts), `VERIFICATION.md` (the contract check results), `PARTNER_TEST_RESULTS.md` (partner testing), `BLIND_TEST_REPORT.md` (the blind test of this README), `TEAM_CHARTER.md` (the team and its place in the ring), `NEW_RING_CHANGES.md` (the checklist of the move to the new ring), `evidence/ring/` (screenshots of the ring working, and `HELD_ISSUES.md`, the errors put on hold while a partner is not built yet), `partner-tests/` (Sherehe's contract and our tests of it), `.env.example` (every setting) and `CLAUDE.md` (standing instructions for coding agents working in this repository).
