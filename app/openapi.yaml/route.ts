// The contract itself, served as it is on disk.

import { promises as fs } from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const text = await fs.readFile(path.join(process.cwd(), 'openapi.yaml'), 'utf8');
  return new Response(text, { headers: { 'Content-Type': 'application/yaml; charset=utf-8' } });
}
