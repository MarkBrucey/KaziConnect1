import type { Metadata } from 'next';
import { JobDetail } from '@/components/JobDetail';

export const metadata: Metadata = { title: 'Job details: Kazi Connect' };

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <JobDetail jobId={jobId} />;
}
