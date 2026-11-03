// Anything else under /api: 404 with no body, for every method.

export const dynamic = 'force-dynamic';

export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE } from '@/lib/notFound';
