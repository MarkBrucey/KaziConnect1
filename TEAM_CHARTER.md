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
- Upstream provider: Shamba Direct (Team 14)
- Downstream consumer: SettleIn (Team 1)

## Update after Week 7

The features marked as planned above are now built: employers can post jobs, see who applied and accept one applicant, and students can see their own applications. Students are the workers in the API, so accounts are either `student` or `employer`. See README.md for how to use them.
