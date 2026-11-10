// GET /api/v1/jobs: version 1 of the job list (Endpoints 1 and 2) under a versioned address, Week 13.
// Exactly the same answers as GET /api/jobs, which stays for everyone already calling it.

import { listJobsV1 } from '@/lib/jobsV1';

export const dynamic = 'force-dynamic';

export const GET = listJobsV1;

export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
