import type { Metadata } from 'next';
import { ApplicationsTracker } from '@/components/ApplicationsTracker';

export const metadata: Metadata = { title: 'Your applications: Kazi Connect' };

export default function ApplicationsPage() {
  return <ApplicationsTracker />;
}
