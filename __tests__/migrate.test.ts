// npm run db:migrate. The messages and exit codes run everywhere; the test against a real database runs
// when DATABASE_URL is set (the PostgreSQL leg of the test run).

import * as db from '../db';
import { describeTarget, runMigrate, statementsOf } from '../scripts/migrate';
import { MIGRATION_SQL, migrate } from '../pgStore';

const PASSWORD = 'hunter2-secret';
const URL_WITH_PASSWORD = `postgres://kazi_user:${PASSWORD}@db.example.com:5432/kazi?sslmode=require`;
const never = async (): Promise<void> => { throw new Error('should not have been called'); };

describe('db:migrate', () => {
  it('--print shows the statements and touches no database, even without DATABASE_URL', async () => {
    const outcome = await runMigrate(['--print'], {}, never);

    expect(outcome.code).toBe(0);
    expect(outcome.lines.join('\n')).toContain('CREATE TABLE IF NOT EXISTS staffing_offers');
    expect(outcome.lines.join('\n')).toBe(MIGRATION_SQL.trim());
  });

  it('only adds: no statement drops, deletes, truncates or alters anything', () => {
    // "ON DELETE CASCADE" in a foreign key is a rule about later deletes, not a delete, so it is set aside.
    const statements = statementsOf(MIGRATION_SQL);
    expect(statements.length).toBeGreaterThan(10);
    for (const statement of statements) expect(statement.replace(/ON DELETE (CASCADE|SET NULL|RESTRICT)/gi, '')).not.toMatch(/\b(DROP|DELETE|TRUNCATE|RENAME|UPDATE|INSERT)\b/i);
    for (const statement of statements) expect(statement).toMatch(/^(CREATE (UNIQUE )?(TABLE|INDEX|SEQUENCE) IF NOT EXISTS|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS)/i);
  });

  it('without DATABASE_URL does nothing and says why, exit 2', async () => {
    const outcome = await runMigrate([], {}, never);

    expect(outcome.code).toBe(2);
    expect(outcome.lines.join(' ')).toMatch(/DATABASE_URL is not set/);
  });

  it('names the database it is migrating, but never prints the user or the password', async () => {
    let called = false;
    const outcome = await runMigrate([], { DATABASE_URL: URL_WITH_PASSWORD }, async () => { called = true; });

    expect(called).toBe(true);
    expect(outcome.code).toBe(0);
    const text = outcome.lines.join('\n');
    expect(text).toContain('db.example.com:5432/kazi');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('kazi_user');
    expect(text).toMatch(/no sample data was loaded/);
  });

  it('reports a failure with exit 1, and still does not print the password', async () => {
    const outcome = await runMigrate([], { DATABASE_URL: URL_WITH_PASSWORD }, async () => { throw new Error('connect ECONNREFUSED 10.0.0.1:5432'); });

    expect(outcome.code).toBe(1);
    expect(outcome.lines.join('\n')).toContain('ECONNREFUSED');
    expect(outcome.lines.join('\n')).not.toContain(PASSWORD);
  });

  it('describes a malformed DATABASE_URL without echoing it', () => {
    expect(describeTarget(`not a url ${PASSWORD}`)).not.toContain(PASSWORD);
  });

  (process.env.DATABASE_URL ? it : it.skip)('against a real database: safe to run twice, changes no data', async () => {
    await db.reset();
    const applications = await db.countApplications();

    await migrate();
    await migrate();

    expect(await db.countApplications()).toBe(applications);
    expect((await db.findApplicationById('app_1001'))!.application_status).toBe('pending');
  });
});

afterAll(async () => { if (db.close) await db.close(); });
