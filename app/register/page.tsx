import type { Metadata } from 'next';
import { AuthPage } from '@/components/AuthPage';

export const metadata: Metadata = { title: 'Register: Kazi Connect' };

export default function Page() {
  return <AuthPage initial="register" />;
}
