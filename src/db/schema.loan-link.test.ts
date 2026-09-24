import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

// `loan_holding_id` / `loan_link_source` / `loan_link_rejected` (T29, spec
// 5.4): the loan-payment link on a transaction — which loan holding a bank
// debit counts against, whether the matcher (`auto`) or the user (`manual`)
// set it, and whether the user has explicitly rejected an auto-suggested
// link on this row (so the matcher never re-links it). Migration 0038 adds
// all three additively.
describe('loan-payment link column migration', () => {
  it('adds loan_holding_id, loan_link_source, and loan_link_rejected to transactions', () => {
    const combined = combinedSql();

    expect(combined).toContain('ALTER TABLE `transactions` ADD `loan_holding_id` text;');
    expect(combined).toContain('ALTER TABLE `transactions` ADD `loan_link_source` text;');
    expect(combined).toContain(
      'ALTER TABLE `transactions` ADD `loan_link_rejected` integer DEFAULT false NOT NULL;',
    );
  });

  it('registers the migration in the index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain("import m0038 from './0038_add_loan_link.sql';");
    expect(index).toMatch(/\bm0038,/);
  });
});
