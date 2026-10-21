// npm run db:migrate: creates the tables and indexes that are missing in the PostgreSQL database that
// DATABASE_URL points to. It only adds, so running it twice, or against a database that already has
// the tables, changes nothing. The server runs the same statements when it starts; this is for doing
// it on purpose, and for looking first.
//
//   npm run db:migrate -- --print    shows the statements and touches no database (no DATABASE_URL needed)
//   npm run db:migrate               runs them against DATABASE_URL, and loads no sample data

import '../bootstrapEnv';
import path from 'path';
import { MIGRATION_SQL } from '../pgStore';
import { readDotEnv } from './lib/dotenv';

export interface MigrateOutcome {
  code: number;
  lines: string[];
}

// The database named in a connection string, without the user or the password.
export function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${url.pathname}`;
  } catch {
    return '(a DATABASE_URL that is not a valid address)';
  }
}

// The statements in a block of SQL, one string each, without the comments.
export function statementsOf(sql: string): string[] {
  return sql.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
}

// `env` is only read for DATABASE_URL, so a test can pass just that.
export async function runMigrate(args: string[], env: { DATABASE_URL?: string }, apply: () => Promise<void>): Promise<MigrateOutcome> {
  if (args.includes('--print')) return { code: 0, lines: [MIGRATION_SQL.trim()] };
  const url = (env.DATABASE_URL || '').trim();
  if (!url) {
    return { code: 2, lines: ['DATABASE_URL is not set, so there is no database to migrate. Set it in .env, or use --print to only see the statements.'] };
  }
  const target = describeTarget(url);
  try {
    await apply();
  } catch (err) {
    return { code: 1, lines: [`Migrating ${target}`, `Could not migrate: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const statements = statementsOf(MIGRATION_SQL).length;
  return { code: 0, lines: [`Migrating ${target}`, `Done: ${statements} statements ran. Each one only adds what is missing; nothing was changed or removed, and no sample data was loaded.`] };
}

async function main(): Promise<void> {
  // Like the server (which gets .env from Next), a real environment variable beats .env. The pool reads
  // DATABASE_URL when it is first used, so it is set here before that.
  const env = { DATABASE_URL: process.env.DATABASE_URL ?? readDotEnv(path.join(__dirname, '..', '.env')).DATABASE_URL };
  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  const { migrate, close } = await import('../pgStore');
  const outcome = await runMigrate(process.argv.slice(2), env, migrate);
  for (const line of outcome.lines) console.log(line);
  if (env.DATABASE_URL) await close().catch(() => undefined);
  process.exit(outcome.code);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(2);
  });
}
