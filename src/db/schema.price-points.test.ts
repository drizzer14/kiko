import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const migrationsDir = join(__dirname, '../../drizzle/migrations');

const combinedSql = (): string =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'))
    .join('\n');

// `price_points`: one row per (instrument, day) — the priced value for
// a share/metal/holding on a given UTC-midnight day, keyed the same way
// `currency_rate_history` keys a rate. Migration 0035 creates the table.
describe('price_points table migration', () => {
  it('creates the price_points table with the priced-day columns', () => {
    const combined = combinedSql();

    expect(combined).toContain('CREATE TABLE `price_points`');
    expect(combined).toContain('`instrument` text NOT NULL');
    expect(combined).toContain('`day` integer NOT NULL');
    expect(combined).toContain('`price` text NOT NULL');
    expect(combined).toContain('`currency` text NOT NULL');
    expect(combined).toContain('`source` text NOT NULL');
  });

  it('creates the (instrument, day) unique index', () => {
    const combined = combinedSql();

    expect(combined).toMatch(
      /CREATE UNIQUE INDEX `price_points_instrument_day` ON `price_points` \(`instrument`,`day`\)/,
    );
  });

  it('registers the create-table migration in the index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain("import m0035 from './0035_add_price_points.sql';");
    expect(index).toMatch(/\bm0035,/);
  });
});
