import type { Metadata } from 'next';
import { AuthPage } from '@/components/AuthPage';

export const metadata: Metadata = { title: 'Log in: Kazi Connect' };

export default function Page() {
  return <AuthPage initial="login" />;
}
