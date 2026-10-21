import type { Metadata } from 'next';
import { EmployerDashboard } from '@/components/EmployerDashboard';

export const metadata: Metadata = { title: 'Dashboard: Kazi Connect' };

export default function DashboardPage() {
  return <EmployerDashboard />;
}
