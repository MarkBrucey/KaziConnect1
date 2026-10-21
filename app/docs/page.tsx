import type { Metadata } from 'next';
import { ApiDocs } from '@/components/ApiDocs';

export const metadata: Metadata = { title: 'API documentation: Kazi Connect' };

export default function DocsPage() {
  return <ApiDocs />;
}
