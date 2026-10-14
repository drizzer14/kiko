import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { darkTheme } from '@kiko/design-system/theme';

import {
  parseSeedCategoryColors,
  readSeedCategoryColorMigration,
} from './__fixtures__/seed-category-colors';
import { SEEDED_CATEGORIES } from './__fixtures__/seeded-categories';

const migrationsDir = join(__dirname, '../../drizzle/migrations');
const sqlFiles = (): string[] =>
  readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));

describe('category_overrides migration', () => {
  it('creates the category_overrides table', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('CREATE TABLE `category_overrides`');
    expect(combined).toContain('`normalized_name`');
    expect(combined).toContain('`category`');
    expect(combined).toContain('`display_name`');
  });

  it('registers the new migration in the migrations index', () => {
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(index).toContain('0007');
  });
});

// Every stored category value is the lowercase `categories.key` slug. Rows
// written before `categoryForMcc` emitted slugs carry a capitalized display
// name ('Groceries'), which no lowercase-slug predicate ever matched, so a
// one-time data migration folds them onto the convention.
describe('lowercase-categories migration', () => {
  it('lowercases legacy category values in a registered migration', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('UPDATE `transactions` SET `category` = lower(`category`)');
    expect(combined).toContain('UPDATE `category_overrides` SET `category` = lower(`category`)');
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0014');
  });

  it('registers the migration under the journal idx the runner resolves it by', () => {
    // `run-migrations.ts` resolves each journal entry's SQL by the key
    // `m${idx padded to 4}`, so a journal entry whose idx has no matching
    // `migrations` key throws "Missing migration" at launch. The tag must also
    // match the file name, since the file is what the bundle imports.
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0014_lowercase_categories',
    );
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(14);
    expect(readdirSync(migrationsDir)).toContain('0014_lowercase_categories.sql');
    expect(index).toContain("import m0014 from './0014_lowercase_categories.sql';");
    expect(index).toMatch(/\bm0014,/);
  });

  it('is idempotent: re-running it lowercases nothing that is already lowercase', () => {
    const sql = readFileSync(join(migrationsDir, '0014_lowercase_categories.sql'), 'utf8');

    // `lower()` is a no-op on an already-lowercase value, and each statement
    // additionally skips those rows outright, so a re-run writes nothing.
    for (const table of ['transactions', 'category_overrides']) {
      expect(sql).toContain(`UPDATE \`${table}\` SET \`category\` = lower(\`category\`)`);
      expect(sql).toMatch(
        new RegExp(`UPDATE \`${table}\`[^;]*WHERE[^;]*\`category\` <> lower\\(\`category\`\\)`),
      );
    }
  });
});

// Monobank's `hold` flag marks a PENDING authorization, whose settled amount can
// still change. Persisting it is what lets a reader tell a provisional row from
// the final one `addManyDedup`'s upsert later refreshes it into.
describe('transaction-hold migration', () => {
  it('adds the hold column in a registered migration', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('`hold`');
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0016');
  });

  it('adds it nullable, so a table that already has rows can take it', () => {
    const sql = readFileSync(join(migrationsDir, '0016_add_transaction_hold.sql'), 'utf8');

    // SQLite refuses `ADD COLUMN ... NOT NULL` without a default on a populated
    // table, and a manual row has no hold state to report anyway.
    expect(sql).toContain('ALTER TABLE `transactions` ADD `hold` integer');
    expect(sql).not.toContain('NOT NULL');
  });
});

// The ten categories `0002_seed_categories.sql` seeds carry a null
// `color`, so the chart layer's `categoryColor` hash
// (`statistics/category-breakdown/category-breakdown.ts`) is what actually
// colors them — and over these exact ten keys that hash collapses to five
// hues (four categories render an identical blue).
// `resolveCategoryColor` prefers a STORED color over the hash, so this
// data-only migration fills one in for eight of the ten keys, only where
// still NULL — `utilities` and `entertainment` are intentionally left
// uncolored (see the migration's own header comment) and keep falling back
// to the hash, same as before this migration existed.
describe('seed-category-colors migration', () => {
  // Parses the REAL migration file into `{ key, color }` pairs — asserting
  // against these (rather than a hand-typed literal map) is what catches a
  // key typo, a duplicate key, or a non-seeded key: any of those would leave
  // the parsed key set mismatched against the eight colored keys even though
  // a looser "eight colors, eight distinct" check would still pass. The
  // parser additionally requires `AND \`color\` IS NULL` on the SAME
  // statement to count as a match, so a statement missing that guard
  // silently drops out of `pairs` and is caught the same way — as a missing
  // key.
  const pairs = parseSeedCategoryColors(readSeedCategoryColorMigration());
  const UNCOLORED_CATEGORY_KEYS = ['utilities', 'entertainment'];
  const COLORED_CATEGORY_KEYS = SEEDED_CATEGORIES.map((category) => category.key).filter(
    (key) => !UNCOLORED_CATEGORY_KEYS.includes(key),
  );

  it('targets exactly the eight colored seeded keys — no extra, missing, or duplicate key', () => {
    const keys = pairs.map((pair) => pair.key);

    expect(keys.sort()).toEqual([...COLORED_CATEGORY_KEYS].sort());
    expect(new Set(keys).size).toBe(COLORED_CATEGORY_KEYS.length);

    for (const uncoloredKey of UNCOLORED_CATEGORY_KEYS) {
      expect(keys).not.toContain(uncoloredKey);
    }
  });

  it('seeds a distinct color for each of the eight colored seeded categories', () => {
    const colors = pairs.map((pair) => pair.color);

    expect(colors).toHaveLength(8);
    expect(new Set(colors).size).toBe(8);
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0017');
  });

  it('draws every seeded color from theme.colors.entityColors, the shared swatch family', () => {
    const entityColorValues = Object.values(darkTheme.colors.entityColors);

    for (const pair of pairs) {
      expect(entityColorValues).toContain(pair.color);
    }
  });

  it('only fills a NULL color, never overwriting a color the user already set', () => {
    const sql = readSeedCategoryColorMigration();
    // Scoped to the color-setting statements only: the migration also carries
    // one `SET \`icon\`` statement (the transport car->bus refinement), which
    // is guarded by `icon = 'car'`, not `color` IS NULL — a different,
    // already-idempotent concern this test does not assert on.
    const statements = sql
      .split('UPDATE `categories`')
      .slice(1)
      .filter((statement) => statement.includes('SET `color`'));

    expect(statements).toHaveLength(8);

    for (const statement of statements) {
      expect(statement).toContain('`color` IS NULL');
    }
  });

  it('registers the migration under the journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0017_default_category_colors',
    );
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(17);
    expect(readdirSync(migrationsDir)).toContain('0017_default_category_colors.sql');
    expect(index).toContain("import m0017 from './0017_default_category_colors.sql';");
    expect(index).toMatch(/\bm0017,/);
  });
});

// A hermetic applier for a single guarded `SET \`icon\`` UPDATE, driven by the
// values parsed out of the REAL migration SQL (never a hand-typed copy): it
// reads the new value, the guard column/value, and the guard icon straight from
// the file, so it proves the shipped guard converges the seeded/created default
// AND leaves a user-picked icon untouched. Returns the resulting icon for a row.
const applyGuardedIconUpdate = (
  sql: string,
  row: { column: string; columnValue: string; icon: string },
): string => {
  const match = sql.match(
    /UPDATE `[a-z_]+` SET `icon` = '([^']+)' WHERE `([a-z_]+)` = '([^']+)' AND `icon` = '([^']+)'/,
  );

  if (match === null) {
    throw new Error('No guarded icon UPDATE found in migration SQL');
  }
  const [, nextIcon, guardColumn, guardColumnValue, guardIcon] = match;
  const matches =
    row.column === guardColumn && row.columnValue === guardColumnValue && row.icon === guardIcon;

  return matches ? nextIcon : row.icon;
};

// The icon rework changes exactly ONE seeded category default — Health from
// `cross.case` to `cross`. Categories are seeded as DB rows (0002), so an
// existing install stores `cross.case` and needs a guarded data migration to
// converge, same class/shape as 0017's transport `car`->`bus` refinement.
describe('health-category-icon migration', () => {
  const sql = (): string =>
    readFileSync(join(migrationsDir, '0031_icon_health_category.sql'), 'utf8');

  it('refines the health icon from cross.case to cross, guarded on the seeded value', () => {
    expect(sql()).toMatch(
      /UPDATE `categories` SET `icon` = 'cross' WHERE `key` = 'health' AND `icon` = 'cross\.case'/,
    );
  });

  it('touches ONLY the categories table icon — no schema change, no other column, no other row', () => {
    const body = sql();

    expect(body).not.toContain('ALTER TABLE');
    expect(body).not.toContain('CREATE TABLE');
    expect(body).not.toContain('DROP');
    expect(body).not.toContain('SET `color`');
    // The only UPDATE targets health; no other category key is written.
    expect((body.match(/UPDATE `categories`/g) ?? []).length).toBe(1);
  });

  it('converges a seeded Health row to cross while preserving a user-picked icon', () => {
    const body = sql();

    // A still-default seeded Health row moves to the new glyph...
    expect(
      applyGuardedIconUpdate(body, { column: 'key', columnValue: 'health', icon: 'cross.case' }),
    ).toBe('cross');
    // ...a Health row the user re-iconed is left untouched (guard misses)...
    expect(
      applyGuardedIconUpdate(body, { column: 'key', columnValue: 'health', icon: 'heart' }),
    ).toBe('heart');
    // ...and re-running the migration is a no-op (the row is already `cross`).
    expect(
      applyGuardedIconUpdate(body, { column: 'key', columnValue: 'health', icon: 'cross' }),
    ).toBe('cross');
  });

  it('registers the migration under the journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0031_icon_health_category',
    );
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(31);
    expect(readdirSync(migrationsDir)).toContain('0031_icon_health_category.sql');
    expect(index).toContain("import m0031 from './0031_icon_health_category.sql';");
    expect(index).toMatch(/\bm0031,/);
  });
});

// The crypto ACCOUNT default changes from `bitcoinsign` to
// `bitcoinsign.circle`. The account form PERSISTS the kind default at create
// time (never null on create), so existing un-customized crypto accounts store
// `bitcoinsign` and need a guarded data migration — unlike the holding defaults,
// which are null-until-picked render-time fallbacks and need no migration.
describe('crypto-account-icon migration', () => {
  const sql = (): string =>
    readFileSync(join(migrationsDir, '0032_icon_crypto_account.sql'), 'utf8');

  it('refines the crypto account icon to bitcoinsign.circle, guarded on the created default', () => {
    expect(sql()).toMatch(
      /UPDATE `accounts` SET `icon` = 'bitcoinsign\.circle' WHERE `kind` = 'crypto' AND `icon` = 'bitcoinsign'/,
    );
  });

  it('touches ONLY the accounts table icon — no schema change, no other column', () => {
    const body = sql();

    expect(body).not.toContain('ALTER TABLE');
    expect(body).not.toContain('CREATE TABLE');
    expect(body).not.toContain('DROP');
    expect(body).not.toContain('SET `kind`');
    expect((body.match(/UPDATE `accounts`/g) ?? []).length).toBe(1);
  });

  it('converges a crypto account default while preserving a user-picked or non-crypto icon', () => {
    const body = sql();

    // An un-customized crypto account moves to the new glyph...
    expect(
      applyGuardedIconUpdate(body, { column: 'kind', columnValue: 'crypto', icon: 'bitcoinsign' }),
    ).toBe('bitcoinsign.circle');
    // ...a crypto account the user re-iconed is untouched...
    expect(
      applyGuardedIconUpdate(body, { column: 'kind', columnValue: 'crypto', icon: 'wallet.pass' }),
    ).toBe('wallet.pass');
    // ...a non-crypto account that happens to hold `bitcoinsign` is untouched...
    expect(
      applyGuardedIconUpdate(body, { column: 'kind', columnValue: 'bank', icon: 'bitcoinsign' }),
    ).toBe('bitcoinsign');
    // ...and re-running is a no-op (already `bitcoinsign.circle`).
    expect(
      applyGuardedIconUpdate(body, {
        column: 'kind',
        columnValue: 'crypto',
        icon: 'bitcoinsign.circle',
      }),
    ).toBe('bitcoinsign.circle');
  });

  it('registers the migration under the journal idx the runner resolves it by', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const entry = journal.entries.find((candidate) => candidate.tag === '0032_icon_crypto_account');
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');

    expect(entry?.idx).toBe(32);
    expect(readdirSync(migrationsDir)).toContain('0032_icon_crypto_account.sql');
    expect(index).toContain("import m0032 from './0032_icon_crypto_account.sql';");
    expect(index).toMatch(/\bm0032,/);
  });
});

// The registration invariant every migration must hold, asserted over the WHOLE
// journal rather than over whichever migration happened to be newest when the
// assertion was written (a per-migration "must be last" check goes stale the
// moment the next one lands, and says nothing about the ones before it).
describe('migration journal', () => {
  it('registers every journal entry, in applied order, with a matching file and import', () => {
    const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; when: number; tag: string }[];
    };
    const index = readFileSync(join(migrationsDir, 'migrations.js'), 'utf8');
    const files = readdirSync(migrationsDir);

    // The journal is applied in array order, so its idx sequence must be a
    // gapless 0..n-1 run — a duplicate or skipped idx silently reorders or
    // drops a migration at launch.
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_entry, position) => position),
    );

    for (const entry of journal.entries) {
      // `run-migrations.ts` resolves each entry's SQL by the key `m${idx padded
      // to 4}`, so a missing file/import throws "Missing migration" at launch.
      const key = `m${String(entry.idx).padStart(4, '0')}`;

      expect(files).toContain(`${entry.tag}.sql`);
      expect(index).toContain(`import ${key} from './${entry.tag}.sql';`);
      expect(index).toMatch(new RegExp(`\\b${key},`));
    }
  });
});

// An Exchange/Convert leg is marked structurally by
// `transactions.exchange_counterpart_holding_id` (see `src/db/schema.ts`), and
// the legs an older build wrote with a persisted English description are
// backfilled onto that marker by the same migration that adds the column.
describe('exchange-marker migration', () => {
  it('adds and backfills the exchange marker in a registered migration', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('`exchange_counterpart_holding_id`');
    expect(combined).toContain("LIKE 'Exchange to %'");
    expect(combined).toContain("LIKE 'Exchange from %'");
    expect(readFileSync(join(migrationsDir, 'migrations.js'), 'utf8')).toContain('0015');
  });

  it('is idempotent: the backfill only touches rows that still lack the marker', () => {
    const sql = readFileSync(join(migrationsDir, '0015_add_exchange_marker.sql'), 'utf8');

    // Every backfill statement is guarded on a NULL marker AND on the legacy
    // description pattern, and it clears that description as it writes — so a
    // re-run matches nothing.
    const backfills = sql.split('UPDATE `transactions`').slice(1);

    expect(backfills).toHaveLength(2);

    for (const statement of backfills) {
      expect(statement).toContain('`exchange_counterpart_holding_id` IS NULL');
      expect(statement).toContain("`description` = ''");
    }
  });
});

// The `transactions` table only carried `transactions_source_external` (the
// dedup unique index). Every `where(eq(transactions.holdingId, …))` did a
// full table scan and every `orderBy(desc(transactions.time))` a full sort, so
// a migration adds a plain index on each of those two columns.
describe('transactions performance indexes migration', () => {
  it('creates an index on transactions(holding_id) in a registered migration', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain(
      'CREATE INDEX `transactions_holding_id` ON `transactions` (`holding_id`);',
    );
  });

  it('creates an index on transactions(time) in a registered migration', () => {
    const combined = sqlFiles().join('\n');

    expect(combined).toContain('CREATE INDEX `transactions_time` ON `transactions` (`time`);');
  });

  it('adds the two indexes and nothing that rebuilds or drops the table', () => {
    // The migration that introduces the holding_id index must not carry an
    // accidental table rebuild or column drop alongside the indexes.
    const migrationSql = sqlFiles().find((sql) => sql.includes('`transactions_holding_id`'));

    expect(migrationSql).toBeDefined();
    expect(migrationSql).not.toContain('DROP TABLE');
    expect(migrationSql).not.toContain('DROP COLUMN');
    expect(migrationSql).not.toContain('CREATE TABLE');
  });
});
