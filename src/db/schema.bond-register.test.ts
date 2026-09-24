import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

// `bond_register` (T24): the NBU securities-register cache — one row per
// bond ISIN, `terms` the resolved `BondTerms` JSON, `fetched_at` the
// cache-wide write-time stamp `refreshBondRegisterIfStale` compares against
// to gate its once-per-local-day refresh. Migration 0037 creates the table.
describe('bond_register table migration', () => {
  it('creates the bond_register table with an isin primary key, a terms json column, and fetchedAt', () => {
    const combined = combinedSql();

    expect(combined).toContain('CREATE TABLE `bond_register`');
    expect(combined).toContain('`isin` text PRIMARY KEY NOT NULL');
    expect(combined).toContain('`terms` text NOT NULL');
    expect(combined).toContain('`fetched_at` integer NOT NULL');
  });

  it('registers the create-table migration in the index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain("import m0037 from './0037_add_bond_register.sql';");
    expect(index).toMatch(/\bm0037,/);
  });
});
