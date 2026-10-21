# Team Charter

## Team
- Team name: Kazi Connect
- Ashlyn Aringo: API Lead
- Dwayne: Backend Dev
- Mark Bruce Nyangena: Integration/QA Lead
- Solovea Mutei: Shared Design and Docs

## App summary
Kazi Connect is a platform that connects employers with nearby casual workers
(fundis). Employers can post short-term jobs and workers can browse jobs by
category and apply.

## Resource and action audit

### Users
- Register as a worker or employer
- Log in
- Log out
- View role-specific pages

### Jobs
- View all jobs
- Filter jobs by category
- View job details: title, category, location, pay, duration, urgency and description
- Post jobs (advertised in the app, though the posting page is not yet implemented)
- Manage employer job postings (planned dashboard feature)

### Applications
- Apply to a job
- Store the worker, job, status and application date
- View applicants for a posted job (planned dashboard feature)
- View a worker's applications (linked in navigation but not yet implemented)

## Ring position
- Upstream provider (we consume their API): Sherehe (events)
- Downstream consumer (consumes our API): Ujuzi (skills training)
- The full ring: Sherehe -> Kazi Connect -> Ujuzi -> Sherehe
- Until October 2026 the ring partners were Shamba Direct (Team 14, upstream) and SettleIn (Team 1, downstream); both have left the ring. Sherehe and Ujuzi are built by our own sub-teams, each with its own repository.

## Update after Week 7

The features marked as planned above are now built: employers can post jobs, see who applied and accept one applicant, and students can see their own applications. Students are the workers in the API, so accounts are either `student` or `employer`. See README.md for how to use them.

## Update: new ring partners and stack (October 2026)

- Shamba Direct and SettleIn left the ring. Sherehe replaces Shamba Direct upstream; Ujuzi replaces SettleIn downstream and uses Endpoints 1 to 9 exactly as SettleIn did.
- New website feature: employers can see staffing roles on Sherehe events and offer Kazi workers for them (W7, Endpoints 22 to 25). This is the first time Kazi Connect calls another team's API from code.
- New stack, shared by all three systems: Next.js (App Router) with TypeScript for the website and the API, PostgreSQL for data, Tailwind CSS v4 for styling, Jest and Supertest for tests.
- Audit addition, Event work: see staffing roles on upcoming Sherehe events; offer workers for a role; see each offer's status; a job opens automatically when the organiser accepts.
- Sub-teams: TODO (who works on Kazi Connect, Sherehe and Ujuzi, and their starting roles).
