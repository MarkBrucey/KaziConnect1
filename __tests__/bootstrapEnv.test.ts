// bootstrapEnv.ts runs first in server.ts and the scripts. It sets NODE_ENV and reads a .env file with Next.js's own
// loader BEFORE db.ts picks PostgreSQL or memory and before server.ts reads PORT. Before this was fixed, a .env file
// was read only later, by Next itself, so PORT and DATABASE_URL in it were silently ignored.
//
// The real file is copied into a temp folder next to a throwaway .env (it reads the .env beside itself), then run
// with tsx in a child process. The project's own .env is never touched.
//
// Written to run on Windows too: node_modules is linked as a junction (a plain directory symlink needs admin rights
// or Developer Mode on Windows; the type is ignored elsewhere), and tsx is started through Node itself, because
// node_modules/.bin/tsx is a shell script that Windows cannot start without a shell.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.join(__dirname, '..');
const tsxCli = require.resolve('tsx/cli');
let dir = '';

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kazi-env-'));
  fs.copyFileSync(path.join(root, 'bootstrapEnv.ts'), path.join(dir, 'bootstrapEnv.ts'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(dir, 'probe.ts'),
    "import './bootstrapEnv';\nconsole.log(JSON.stringify({ node: process.env.NODE_ENV, port: process.env.PORT, db: process.env.DATABASE_URL, sherehe: process.env.SHEREHE_API_URL }));\n");
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function run(env: Record<string, string> = {}, args: string[] = []): { node?: string; port?: string; db?: string; sherehe?: string } {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !['NODE_ENV', 'PORT', 'DATABASE_URL', 'SHEREHE_API_URL', 'SHEREHE_API_KEY', '__NEXT_TEST_MODE'].includes(k)) clean[k] = v;
  }
  // Cast: Next's types make NODE_ENV mandatory on ProcessEnv, but this test needs the child to start without one.
  const out = spawnSync(process.execPath, [tsxCli, 'probe.ts', ...args], { cwd: dir, env: { ...clean, ...env } as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60000 });
  if (out.status !== 0) throw new Error(`probe failed: ${out.stderr || out.stdout}`);
  return JSON.parse(out.stdout.trim().split('\n').pop()!);
}

const write = (name: string, text: string): void => fs.writeFileSync(path.join(dir, name), text);
const remove = (name: string): void => fs.rmSync(path.join(dir, name), { force: true });

afterEach(() => { for (const f of ['.env', '.env.local', '.env.production', '.env.development']) remove(f); });

describe('bootstrapEnv', () => {
  it('reads PORT, DATABASE_URL and the Sherehe settings from .env', () => {
    write('.env', 'PORT=4567\nDATABASE_URL=postgres://u:p@127.0.0.1:5432/x\nSHEREHE_API_URL=http://localhost:4001\n');

    expect(run()).toMatchObject({ port: '4567', db: 'postgres://u:p@127.0.0.1:5432/x', sherehe: 'http://localhost:4001' });
  });

  it('lets a real environment variable win over .env', () => {
    write('.env', 'PORT=4567\nDATABASE_URL=postgres://from-the-file\n');

    expect(run({ PORT: '9999', DATABASE_URL: 'postgres://from-the-shell' })).toMatchObject({ port: '9999', db: 'postgres://from-the-shell' });
  });

  it('works with no .env at all: nothing is set, and it still starts', () => {
    const seen = run();

    expect(seen.node).toBe('production');
    expect(seen.port).toBeUndefined();
    expect(seen.db).toBeUndefined();
  });

  it('defaults NODE_ENV to production, and to development with --dev', () => {
    expect(run().node).toBe('production');
    expect(run({}, ['--dev']).node).toBe('development');
  });

  it('keeps a NODE_ENV that is already set', () => {
    expect(run({ NODE_ENV: 'test' }).node).toBe('test');
  });

  it('reads the file for the mode it starts in (.env.production in production, .env.development with --dev)', () => {
    write('.env.production', 'PORT=5001\n');
    write('.env.development', 'PORT=5002\n');

    expect(run().port).toBe('5001');
    expect(run({}, ['--dev']).port).toBe('5002');
  });
});
