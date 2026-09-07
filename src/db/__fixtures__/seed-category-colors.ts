import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Parses migration `0017_seed_category_colors.sql`'s UPDATE statements into
// `{ key, color }` pairs, read from the REAL migration file rather than a
// hand-typed literal a test could assert against. A hand-typed literal can
// silently drift from the migration (a key typo, a duplicate key, a
// non-seeded key, or a missing `AND \`color\` IS NULL` guard) while every
// test still passes, leaving a seeded category on the collision-prone
// `categoryColor` hash (see `src/statistics/category-breakdown.ts`) in
// production. Both `src/db/schema.category-overrides.test.ts` (the migration
// registration/idempotency tests) and
// `src/statistics/category-breakdown.test.ts` (the chart-layer contract test)
// import this so the two suites cannot drift from each other either.
const MIGRATION_PATH = join(__dirname, '../../../drizzle/migrations/0017_seed_category_colors.sql');

type SeedCategoryColor = { key: string; color: string };

// Requires the `AND \`color\` IS NULL` guard on the SAME statement as part of
// the match, so a statement missing it is silently excluded from the parsed
// pairs rather than parsed as if it were compliant — a caller asserting the
// parsed key set against `SEEDED_CATEGORIES` (the full ten) catches the
// omission as a missing key.
const UPDATE_PATTERN =
  /UPDATE `categories` SET `color` = '(#[0-9A-F]{6})' WHERE `key` = '([a-z]+)' AND `color` IS NULL/g;

export const readSeedCategoryColorMigration = (): string => readFileSync(MIGRATION_PATH, 'utf8');

export const parseSeedCategoryColors = (sql: string): SeedCategoryColor[] =>
  [...sql.matchAll(UPDATE_PATTERN)].map((match) => ({ color: match[1], key: match[2] }));

export const readSeedCategoryColors = (): SeedCategoryColor[] =>
  parseSeedCategoryColors(readSeedCategoryColorMigration());
