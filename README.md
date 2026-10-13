# Kazi Connect API

Kazi Connect is a REST API for short, local jobs in Kenya. Students browse open jobs by county and kind of work, apply with the date they can start, follow their application live, and change or cancel it while they wait. Employers post jobs, see who applied, and accept one applicant; everyone else who applied is told straight away that the job is filled. It serves two apps: **SettleIn**, a student accommodation app run by another team, and our own **FundiLink** website. It is built with Node.js and Express, and keeps its data in PostgreSQL.

| What | Where |
|---|---|
| Live API | https://kaziconnect1-1xmu.onrender.com |
| Interactive docs (Swagger UI, every endpoint) | https://kaziconnect1-1xmu.onrender.com/docs |
| The contract itself | https://kaziconnect1-1xmu.onrender.com/openapi.yaml |
| FundiLink website, built on this API | https://kaziconnect1-1xmu.onrender.com |

> **Before your first request:** the API runs on a free server that goes to sleep after 15 minutes without visitors. The first request after a quiet spell can take **up to a minute** to answer. That is normal: wait for it, don't cancel. Every request after that is fast.

## Quickstart: one command

Open this link in any browser:

https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active

Or run this in a terminal (macOS, Linux, Git Bash, or Windows Command Prompt):

```bash
curl -s -w "\nHTTP %{http_code}\n" "https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active"
```

You get back a JSON list of open jobs and `HTTP 200`. This is the real reply, formatted for reading and trimmed to the first two of the 11 jobs it listed when this README was written:

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

## Which terminal to use

| Your computer | Use |
|---|---|
| macOS, Linux, or Windows with **Git Bash** or WSL | [Walkthrough A](#walkthrough-a-bash) (bash and curl) |
| Windows **PowerShell** | [Walkthrough B](#walkthrough-b-windows-powershell) |
| Windows **Command Prompt** (cmd) | Only the quickstart works there. For the rest, open PowerShell instead and use Walkthrough B |
| No terminal at all | The docs page: open https://kaziconnect1-1xmu.onrender.com/docs, pick an endpoint, click **Try it out**, then **Execute** |

Run the walkthrough commands **in order, in the same window**. Later steps reuse values that earlier steps save, such as `TOKEN`, `JOB_ID` and `APP_ID`. If you open a new window, start again from step 1.

## Authentication

Some endpoints need a login token; the rest are open.

1. Get a token by registering (step 5) or logging in (step 6). Both answer with a 64 character `token`.
2. Send it on every request that needs it, in this header:

```text
Authorization: Bearer YOUR_TOKEN
```

3. A token lasts **7 days**, or until you log out (step 21). After that the API answers `401` and you log in again.

| Needs a token | Open to anyone |
|---|---|
| `GET /api/me`, `POST /api/auth/logout` | Reading jobs (`GET /api/jobs...`) |
| Employers only: post, close or reopen a job, see applicants, accept an applicant, list their jobs | Applying, checking, changing and cancelling an application, and live updates |
| Students only: list their own applications | Register, log in, and "Forgot password?" |

An employer can only manage **their own** jobs. Anything else answers `403`.

**Demo accounts**, if you'd rather not register: `employer@kaziconnect.demo` and `student@kaziconnect.demo`, both with the password `KaziDemo2026`. Other testers use them too, so their data changes all the time. The walkthrough creates fresh accounts of your own instead.

## Walkthrough A: bash

Every command is complete: copy it, paste it, press Enter. Text inside JSON that looks like `'"$EMAIL"'` is how bash puts a saved value into the request; copy it exactly as it is.

Each response below is the real reply from the live API, formatted for reading. Your IDs, emails and tokens will be different.

### Jobs (no login needed)

**Step 1. List open jobs** (Endpoint 1). Shown in the quickstart above.

**Step 2. Filter by county and kind of work** (Endpoint 2). Both filters are optional, and matching ignores upper and lower case.

```bash
curl -s -w "\nHTTP %{http_code}\n" "https://kaziconnect1-1xmu.onrender.com/api/jobs?status=active&county=Nairobi&category=tutoring"
```

```json
[
  {
    "id": "job_12349",
    "title": "Maths Tutor, First Years",
    "category": "tutoring",
    "county": "Nairobi",
    "area": "South B",
    "duration": "2 evenings a week",
    "urgent": false,
    "status": "active",
    "payRange": {
      "min": 20000,
      "max": 30000
    }
  }
]
HTTP 200
```

**Step 3. Get one job** (Endpoint 3).

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/job_12349
```

```json
{
  "id": "job_12349",
  "title": "Maths Tutor, First Years",
  "category": "tutoring",
  "county": "Nairobi",
  "area": "South B",
  "duration": "2 evenings a week",
  "urgent": false,
  "status": "active",
  "payRange": {
    "min": 20000,
    "max": 30000
  }
}
HTTP 200
```

**Step 4. Check whether a job is still open** (Endpoint 4). `status` is `active` or `closed`.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/job_12349/status
```

```json
{
  "jobId": "job_12349",
  "status": "active"
}
HTTP 200
```

### Accounts

**Step 5. Register as an employer** (Endpoint 10). The first line makes a new email address each time, so this works however many times it is run. The reply is `201` with your token, which the last line saves as `TOKEN`.

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
  "token": "c89636899ff5109173214fbf09583a0da05c096a6814411c4bde5760b1fcaf97",
  "user": {
    "id": "usr_1007",
    "name": "Test Employer",
    "email": "employer1791905523@example.com",
    "role": "employer"
  }
}
```

`role` is `employer` or `student`. Passwords need at least 8 characters. Registering an email that already has an account answers `409`.

**Step 6. Log in** (Endpoint 11). The reply is `200` with a new token, saved as `TOKEN` again.

```bash
LOGIN=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"'"$EMAIL"'","password":"choose-a-password-1"}')
echo "$LOGIN"
TOKEN=$(echo "$LOGIN" | sed -nE 's/.*"token":"([a-f0-9]{64})".*/\1/p')
```

```json
{
  "token": "e4a3e7e35d024388b38b0e989c70ea00808e4e5a39d24a09fc92710367681fad",
  "user": {
    "id": "usr_1007",
    "name": "Test Employer",
    "email": "employer1791905523@example.com",
    "role": "employer"
  }
}
```

A wrong password and an unknown email both answer `401` with the same message.

**Step 7. See who you are logged in as** (Endpoint 13).

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "id": "usr_1007",
  "name": "Test Employer",
  "email": "employer1791905523@example.com",
  "role": "employer"
}
HTTP 200
```

### Posting a job (employer)

**Step 8. Post a job** (Endpoint 14). The reply is `201` with the new job; the last line saves its ID as `JOB_ID`. Leave out `urgent` for a job that isn't urgent. Pay is in Kenyan shillings, and `min` may equal `max` for a fixed price.

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
  "id": "job_12356",
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

### Applying (no login needed: this is how SettleIn calls the API)

**Step 9. Apply for the job** (Endpoint 7). The reply is `201`; the last line saves the application's ID as `APP_ID`. `preferredDate` must be a date and time in the future, written like `2027-06-01T09:00:00Z`. `note` is optional, up to 500 characters.

```bash
APP=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","studentId":"stu_0042","preferredDate":"2027-06-01T09:00:00Z","note":"Available after 2pm on weekdays"}')
echo "$APP"
APP_ID=$(echo "$APP" | sed -nE 's/.*"applicationId":"([^"]+)".*/\1/p')
```

```json
{
  "applicationId": "app_1012",
  "jobId": "job_12356",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-01T09:00:00Z",
  "note": "Available after 2pm on weekdays",
  "status": "pending"
}
```

**Step 10. Check the application's status** (Endpoint 5). `pending` means waiting for a decision; it later becomes `accepted` or `filled`.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID/status
```

```json
{
  "applicationId": "app_1012",
  "status": "pending"
}
HTTP 200
```

**Step 11. Change the start date** (Endpoint 8). `PUT` replaces the date and note: leaving `note` out clears it. Sending the same request twice gives the same result. Only `pending` applications can be changed.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PUT https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID \
  -H "Content-Type: application/json" \
  -d '{"preferredDate":"2027-06-08T14:00:00Z","note":"Can start a week later"}'
```

```json
{
  "applicationId": "app_1012",
  "jobId": "job_12356",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-08T14:00:00Z",
  "note": "Can start a week later",
  "status": "pending"
}
HTTP 200
```

**Step 12. Cancel an application** (Endpoint 9). The first command makes a second application to cancel, so `APP_ID` stays for the next steps. A successful cancel answers `204` with no body. Only `pending` applications can be cancelled.

```bash
APP2_ID=$(curl -s -X POST https://kaziconnect1-1xmu.onrender.com/api/applications \
  -H "Content-Type: application/json" \
  -d '{"jobId":"'"$JOB_ID"'","studentId":"stu_0043","preferredDate":"2027-06-02T09:00:00Z"}' \
  | sed -nE 's/.*"applicationId":"([^"]+)".*/\1/p')
curl -s -w "HTTP %{http_code}\n" -X DELETE https://kaziconnect1-1xmu.onrender.com/api/applications/$APP2_ID
```

```text
HTTP 204
```

**Step 13 (optional). Watch an application live** (Endpoint 6). This is a WebSocket, so it needs a WebSocket client rather than curl. First print your application ID:

```bash
echo $APP_ID
```

```text
app_1012
```

Then, in a **second** terminal, run this with your own ID in place of `app_1012` (it needs Node.js 18 or newer):

```text
npx --yes wscat -c wss://kaziconnect1-1xmu.onrender.com/api/applications/app_1012/subscribe
```

It prints the current status straight away, then a new line each time it changes. Leave it open, go back to the first terminal and carry on: at step 15 you will see `accepted` arrive in the second terminal.

```text
Connected (press CTRL+C to quit)
< {"applicationId":"app_1012","status":"pending"}
< {"applicationId":"app_1012","status":"accepted"}
```

If an application is cancelled while you watch, the last message has `"status":"cancelled"` and the server closes the connection.

### Deciding (employer)

**Step 14. See who applied** (Endpoint 16). Only the employer who posted the job can see this. `studentName` is filled in when the applicant applied from a Kazi Connect account, and empty otherwise.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID/applications \
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "applicationId": "app_1012",
    "jobId": "job_12356",
    "studentId": "stu_0042",
    "preferredDate": "2027-06-08T14:00:00Z",
    "note": "Can start a week later",
    "status": "pending",
    "studentName": ""
  }
]
HTTP 200
```

**Step 15. Accept an applicant** (Endpoint 18). The application becomes `accepted`, every other application still waiting for this job becomes `filled`, and the job closes.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH https://kaziconnect1-1xmu.onrender.com/api/applications/$APP_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"accepted"}'
```

```json
{
  "applicationId": "app_1012",
  "jobId": "job_12356",
  "studentId": "stu_0042",
  "preferredDate": "2027-06-08T14:00:00Z",
  "note": "Can start a week later",
  "status": "accepted"
}
HTTP 200
```

**Step 16. List your jobs** (Endpoint 15), newest first, with how many applications are still waiting on each.

```bash
curl -s -w "\nHTTP %{http_code}\n" https://kaziconnect1-1xmu.onrender.com/api/me/jobs \
  -H "Authorization: Bearer $TOKEN"
```

```json
[
  {
    "id": "job_12356",
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

**Step 17. Reopen or close a job** (Endpoint 17). `status` is `active` or `closed`. Closing a job marks every application still waiting on it as `filled`. This reopens the job for the next step.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PATCH https://kaziconnect1-1xmu.onrender.com/api/jobs/$JOB_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"active"}'
```

```json
{
  "id": "job_12356",
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

### A student with an account

**Step 18. Register a student, apply, and list their applications** (Endpoints 10, 7 and 19). When a student applies with their account ID as `studentId`, the application appears in their own list.

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
    "applicationId": "app_1014",
    "jobId": "job_12356",
    "studentId": "usr_1008",
    "preferredDate": "2027-06-03T09:00:00Z",
    "note": "",
    "status": "pending"
  }
]
HTTP 200
```

### Forgot password and logging out

**Step 19. Ask for a password reset email** (Endpoint 20). The reply is always the same `202`, whether or not the email has an account, so nobody can use it to find out who is registered. If the account exists, it receives a link that works once, for 30 minutes. This example uses an address with no account, so no email is sent.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X POST https://kaziconnect1-1xmu.onrender.com/api/auth/password-resets \
  -H "Content-Type: application/json" \
  -d '{"email":"no-account@example.invalid"}'
```

```json
{
  "message": "If an account exists for that email, we have sent a link to reset its password. The link works for 30 minutes."
}
HTTP 202
```

**Step 20. Set a new password with the token from that email** (Endpoint 21). A real token comes from the link in the email (the part after `#reset=`), and success answers `204`. This example sends a made up token, so it shows the failure reply.

```bash
curl -s -w "\nHTTP %{http_code}\n" -X PUT https://kaziconnect1-1xmu.onrender.com/api/auth/password \
  -H "Content-Type: application/json" \
  -d '{"token":"0000000000000000000000000000000000000000000000000000000000000000","password":"a-new-password-2"}'
```

```json
{
  "message": "This reset link is not valid or has expired. Ask for a new one."
}
HTTP 400
```

**Step 21. Close your job and log out** (Endpoints 17 and 12). Closing the job you posted keeps the public listings tidy for the next reader, and the student's waiting application from step 18 becomes `filled`. Logging out answers `204`, and the token stops working straight away, as the last command shows.

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
    "applicationId": "app_1014",
    "jobId": "job_12356",
    "studentId": "usr_1008",
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

## Error reference

**How to tell success from failure:** look at the status code. Anything from 200 to 299 is success. Anything from 400 up is a failure, and nothing was changed.

**What a failure looks like:** every account, employer and write endpoint answers with one field, `message`, in plain English:

```json
{ "message": "what went wrong, in plain words" }
```

**One exception:** the read endpoints (1 to 5: listing jobs, one job, a job's status, an application's status) answer `400` and `404` with the status code only and an **empty body**. Check the status code, not the body, for those.

These are real failure replies from the live API. Run them after Walkthrough A, in the same window, because they reuse `STUDENT_TOKEN` and `APP_ID` from it:

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
{"message":"Application app_1012 is accepted; only pending applications can be cancelled"}
HTTP 409

HTTP 404
```

The empty line before the last `HTTP 404` is the empty body of a read endpoint (here, a job that doesn't exist).

| Code | Meaning | Example cause |
|---|---|---|
| `400` | The request is wrong; nothing was changed | A required field is missing, has the wrong type, an unknown field was sent, or a date is in the past |
| `401` | No valid login token | No `Authorization` header, a mistyped token, an expired token, or after logging out |
| `403` | Logged in, but not allowed | A student posting a job, or an employer touching another employer's job |
| `404` | That ID doesn't exist | A mistyped ID, or an application that was cancelled |
| `409` | Not allowed in its current state | Changing or cancelling an application that is already accepted or filled, applying for a closed job, or registering an email that already has an account |
| `413` | The request body is too large | More than 20 KB of JSON |
| `426` | A plain HTTP request was sent to the WebSocket endpoint (Endpoint 6) | Use a WebSocket client, as in step 13 |

## Walkthrough B: Windows PowerShell

The same journey in PowerShell. Open **PowerShell** from the Start menu, then run each block in order, in the same window. PowerShell shows replies as lists rather than raw JSON, and may show dates in your computer's local format; the values are the same as in Walkthrough A.

```powershell
$API = "https://kaziconnect1-1xmu.onrender.com"

# Steps 1 to 4: jobs (no login needed)
Invoke-RestMethod "$API/api/jobs?status=active"
Invoke-RestMethod "$API/api/jobs?status=active&county=Nairobi&category=tutoring"
Invoke-RestMethod "$API/api/jobs/job_12349"
Invoke-RestMethod "$API/api/jobs/job_12349/status"
```

```powershell
# Steps 5 and 6: register an employer, then log in. $TOKEN is saved for later steps.
$EMAIL = "employer$(Get-Random)@example.com"
$body = @{ name = "Test Employer"; email = $EMAIL; password = "choose-a-password-1"; role = "employer" } | ConvertTo-Json
$reg = Invoke-RestMethod -Method Post -Uri "$API/api/auth/register" -ContentType "application/json" -Body $body
$body = @{ email = $EMAIL; password = "choose-a-password-1" } | ConvertTo-Json
$login = Invoke-RestMethod -Method Post -Uri "$API/api/auth/login" -ContentType "application/json" -Body $body
$TOKEN = $login.token
$AUTH = @{ Authorization = "Bearer $TOKEN" }

# Step 7: who am I
Invoke-RestMethod "$API/api/me" -Headers $AUTH
```

```powershell
# Step 8: post a job, and save its ID
$body = @{ title = "Fix leaking kitchen sink"; category = "plumbing"; county = "Nairobi"; area = "Westlands"; duration = "About 2 hours"; urgent = $true; payRange = @{ min = 1500; max = 1500 } } | ConvertTo-Json
$job = Invoke-RestMethod -Method Post -Uri "$API/api/jobs" -Headers $AUTH -ContentType "application/json" -Body $body
$job
$JOB_ID = $job.id
```

```powershell
# Steps 9 to 12: apply, check, change the date, and cancel a second application
$body = @{ jobId = $JOB_ID; studentId = "stu_0042"; preferredDate = "2027-06-01T09:00:00Z"; note = "Available after 2pm on weekdays" } | ConvertTo-Json
$app = Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body
$APP_ID = $app.applicationId
$app
Invoke-RestMethod "$API/api/applications/$APP_ID/status"
$body = @{ preferredDate = "2027-06-08T14:00:00Z"; note = "Can start a week later" } | ConvertTo-Json
Invoke-RestMethod -Method Put -Uri "$API/api/applications/$APP_ID" -ContentType "application/json" -Body $body
$body = @{ jobId = $JOB_ID; studentId = "stu_0043"; preferredDate = "2027-06-02T09:00:00Z" } | ConvertTo-Json
$app2 = Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body
Invoke-RestMethod -Method Delete -Uri "$API/api/applications/$($app2.applicationId)"
"Cancelled $($app2.applicationId)"
```

```powershell
# Steps 14 to 17: see applicants, accept one, list your jobs, reopen the job
Invoke-RestMethod "$API/api/jobs/$JOB_ID/applications" -Headers $AUTH
Invoke-RestMethod -Method Patch -Uri "$API/api/applications/$APP_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"accepted"}'
Invoke-RestMethod "$API/api/me/jobs" -Headers $AUTH
Invoke-RestMethod -Method Patch -Uri "$API/api/jobs/$JOB_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"active"}'
```

```powershell
# Step 18: register a student, apply with their account, and list their applications
$body = @{ name = "Test Student"; email = "student$(Get-Random)@example.com"; password = "choose-a-password-1"; role = "student" } | ConvertTo-Json
$student = Invoke-RestMethod -Method Post -Uri "$API/api/auth/register" -ContentType "application/json" -Body $body
$STUDENT_AUTH = @{ Authorization = "Bearer $($student.token)" }
$body = @{ jobId = $JOB_ID; studentId = $student.user.id; preferredDate = "2027-06-03T09:00:00Z" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$API/api/applications" -ContentType "application/json" -Body $body | Out-Null
Invoke-RestMethod "$API/api/me/applications" -Headers $STUDENT_AUTH
```

```powershell
# Steps 19 and 21: password reset request, close your job, and log out
Invoke-RestMethod -Method Post -Uri "$API/api/auth/password-resets" -ContentType "application/json" -Body '{"email":"no-account@example.invalid"}'
Invoke-RestMethod -Method Patch -Uri "$API/api/jobs/$JOB_ID" -Headers $AUTH -ContentType "application/json" -Body '{"status":"closed"}' | Out-Null
"Closed $JOB_ID"
Invoke-RestMethod -Method Post -Uri "$API/api/auth/logout" -Headers $AUTH
"Logged out"
```

When a request fails, PowerShell shows the error in red. Windows PowerShell 5.1 (the version built into Windows) shows only the status code, such as `(401) Unauthorized`; PowerShell 7 also shows the `message`. To see the full failure body on 5.1, use the bash commands in the error reference with Git Bash.

## Run the API on your own computer

You need **Node.js 18 or newer** (from https://nodejs.org, the LTS version) and **Git**. The commands are the same on Windows, macOS and Linux.

1. On this repository's GitHub page, click the green **Code** button and copy the **HTTPS** address.
2. In a terminal, run these, pasting that address after `git clone`:

```text
git clone PASTE_THE_ADDRESS_HERE
cd KaziConnect1
npm install
npm start
```

No Git? Click **Code**, then **Download ZIP**, extract it, and open a terminal in the extracted folder that contains `package.json` before running `npm install` and `npm start`.

`npm install` may end with a note about moderate vulnerabilities. They are all inside Jest, the testing tool, which the server never runs: `npm audit --omit=dev` reports 0 for the server itself.

After `npm start`, when it is ready, the terminal shows:

```text
> kazi-connect-api@1.2.0 start
> node server.js

Kazi Connect API running on http://localhost:3000
Swagger UI:           http://localhost:3000/docs
Data is stored:       in memory (resets on restart)
```

3. Open http://localhost:3000/docs for the interactive docs, or http://localhost:3000 for the website. Every walkthrough command works locally too: replace `https://kaziconnect1-1xmu.onrender.com` with `http://localhost:3000`.

Things to know when running locally:

* With no settings, data is kept **in memory** and goes back to the sample data every time the server restarts. The sample jobs `job_12345` to `job_12352` and the two demo accounts are always there.
* With no email service set up, password reset links are **printed in the terminal** instead of being emailed.
* Run `npm install` from **inside** the project folder. Running it somewhere else, such as `C:\`, fails with `EPERM: operation not permitted`.
* Port 3000 already in use? Start on another port: `PORT=3001 npm start` in bash, or `$env:PORT=3001; npm start` in PowerShell.
* To stop the server, press **Ctrl + C**.

To check everything works:

```text
npm test
npm run verify
```

`npm test` runs 156 automated tests and `npm run verify` checks the running code against `openapi.yaml` (44 checks). Both should end with everything passing.

**Optional settings** (environment variables). The live server uses these; you don't need them locally.

| Setting | What it does |
|---|---|
| `DATABASE_URL` | A PostgreSQL connection address. Data is then kept between restarts. The tables and sample data are created automatically on first start |
| `BREVO_API_KEY` and `MAIL_FROM` | Send password reset emails through Brevo, from the `MAIL_FROM` address |
| `APP_URL` | The site address used in reset links (the live server works it out by itself) |
| `PORT` | The port to listen on (default 3000) |

## All endpoints

| # | Request | Login | Success | Step |
|---|---|---|---|---|
| 1 | `GET /api/jobs?status=active` | no | 200 | 1 |
| 2 | `GET /api/jobs?status=active&county=...&category=...` | no | 200 | 2 |
| 3 | `GET /api/jobs/{jobId}` | no | 200 | 3 |
| 4 | `GET /api/jobs/{jobId}/status` | no | 200 | 4 |
| 5 | `GET /api/applications/{applicationId}/status` | no | 200 | 10 |
| 6 | `GET /api/applications/{applicationId}/subscribe` (WebSocket) | no | 101 | 13 |
| 7 | `POST /api/applications` | no | 201 | 9 |
| 8 | `PUT /api/applications/{applicationId}` | no | 200 | 11 |
| 9 | `DELETE /api/applications/{applicationId}` | no | 204 | 12 |
| 10 | `POST /api/auth/register` | no | 201 | 5 |
| 11 | `POST /api/auth/login` | no | 200 | 6 |
| 12 | `POST /api/auth/logout` | yes | 204 | 21 |
| 13 | `GET /api/me` | yes | 200 | 7 |
| 14 | `POST /api/jobs` | employer | 201 | 8 |
| 15 | `GET /api/me/jobs` | employer | 200 | 16 |
| 16 | `GET /api/jobs/{jobId}/applications` | the job's employer | 200 | 14 |
| 17 | `PATCH /api/jobs/{jobId}` | the job's employer | 200 | 17, 21 |
| 18 | `PATCH /api/applications/{applicationId}` | the job's employer | 200 | 15 |
| 19 | `GET /api/me/applications` | student | 200 | 18 |
| 20 | `POST /api/auth/password-resets` | no | 202 | 19 |
| 21 | `PUT /api/auth/password` | no | 204 | 20 |

Full request and response shapes for every endpoint are on the docs page: https://kaziconnect1-1xmu.onrender.com/docs

## Known limits

* Applying, changing and cancelling (Endpoints 7 to 9) don't need a login yet, so anyone who knows an application ID can change or cancel it. That is how SettleIn calls the API today; closing this gap is planned for Week 9 (security).
* The free server sleeps after 15 minutes without visitors, so the first request after a quiet spell is slow.
* Reset emails are sent from a Gmail address, so they may land in spam.

## More documents in this repository

`API_NEEDS.md` (who needs what), `ENDPOINT_LIST.md` (every endpoint and the need it serves), `openapi.yaml` (the contract), `CONTRACT_DEVIATIONS.md` (every change to the contract and why), `VERIFICATION.md` (the contract check results), `PARTNER_TEST_RESULTS.md` (partner testing) and `BLIND_TEST_REPORT.md` (Week 8 blind test).
