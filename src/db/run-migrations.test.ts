// jest's mock-hoisting guard only allows the module-factory closures below to
// reference variables prefixed with `mock` (case-insensitive) — see
// babel-plugin-jest-hoist.
const mockExecute = jest.fn();
const mockTxExecute = jest.fn();
const mockTransaction = jest.fn(async (work: (tx: { execute: jest.Mock }) => Promise<void>) => {
  await work({ execute: mockTxExecute });
});

jest.mock('./client', () => ({
  rawDatabase: {
    execute: (...args: unknown[]) => mockExecute(...args),
    transaction: (work: (tx: { execute: jest.Mock }) => Promise<void>) => mockTransaction(work),
  },
}));

// A two-entry bundle standing in for drizzle's real migrations bundle: the
// second migration carries two statements separated by drizzle's breakpoint
// token AND a trailing breakpoint, so the runner's statement-splitting and its
// empty-chunk filtering are both exercised.
const migrationBundleFactory = () => ({
  __esModule: true,
  default: {
    journal: {
      entries: [
        { idx: 0, when: 1000, tag: 'm0000' },
        { idx: 1, when: 2000, tag: 'm0001' },
      ],
    },
    migrations: {
      m0000: 'CREATE TABLE a (id text);',
      m0001:
        'CREATE TABLE b (id text);--> statement-breakpoint\nCREATE TABLE c (id text);--> statement-breakpoint\n',
    },
  },
});

// A nine-entry bundle mirroring the SHIPPED journal, whose `when` timestamps are
// deliberately NON-MONOTONIC: idx 6 (0006_backfill_sort_order) carries a LATER
// `when` than idx 7 and idx 8, which were generated in a different worktree with
// an earlier wall clock. A high-water-mark-by-timestamp gate would read
// MAX(created_at) = idx 6's `when` and wrongly treat idx 7/8 as already applied.
// The runner must instead gate by the COUNT of recorded migrations so those
// out-of-order timestamps are harmless. Migrations 7 and 8 carry the real
// schema-creating SQL (the `category_overrides` table and the `categories.color`
// column) so a full run can be asserted to actually build that schema.
const nonMonotonicBundleFactory = () => ({
  __esModule: true,
  default: {
    journal: {
      entries: [
        { idx: 0, when: 1788123454602, tag: '0000_aromatic_carmella_unuscione' },
        { idx: 1, when: 1788259079337, tag: '0001_mushy_obadiah_stane' },
        { idx: 2, when: 1788345479337, tag: '0002_seed_categories' },
        { idx: 3, when: 1788360589801, tag: '0003_special_the_phantom' },
        { idx: 4, when: 1788428295456, tag: '0004_abnormal_energizer' },
        { idx: 5, when: 1788430622536, tag: '0005_add_entity_color' },
        { idx: 6, when: 1788517022536, tag: '0006_backfill_sort_order' },
        { idx: 7, when: 1788510193092, tag: '0007_robust_karen_page' },
        { idx: 8, when: 1788514551234, tag: '0008_new_luminals' },
      ],
    },
    migrations: {
      m0000: 'CREATE TABLE accounts (id text);',
      m0001: 'CREATE TABLE holdings (id text);',
      m0002: 'INSERT INTO categories (id) VALUES (1);',
      m0003: 'CREATE TABLE transactions (id text);',
      m0004: 'CREATE TABLE currency_rates (id text);',
      m0005: 'ALTER TABLE accounts ADD color text;',
      m0006: 'UPDATE accounts SET sort_order = 0;',
      m0007:
        'CREATE TABLE `category_overrides` (\n\t`normalized_name` text PRIMARY KEY NOT NULL,\n\t`category` text NOT NULL,\n\t`display_name` text NOT NULL\n);',
      m0008: 'ALTER TABLE `categories` ADD `color` text;',
    },
  },
});

// The exported `runMigrations` memoizes its run in a module-level in-flight
// promise, so every test loads a fresh module instance to start from a clean
// memo. A fresh `require` after `jest.resetModules` (in `beforeEach`) is the
// only way to reset that memo between tests.
const loadRunMigrations = (): (() => Promise<void>) =>
  (require('./run-migrations') as typeof import('./run-migrations')).runMigrations;

// The runner gates on the COUNT of rows already recorded in
// `__drizzle_migrations`, so the mocked SELECT hands back a single count row.
const appliedCount: { current: number | string } = { current: 0 };

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../drizzle/migrations/migrations', migrationBundleFactory);

  mockExecute.mockReset();
  mockTxExecute.mockReset();
  mockTransaction.mockClear();
  appliedCount.current = 0;
  mockExecute.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT')) {
      return { rows: [{ count: appliedCount.current }] };
    }

    return { rows: [] };
  });
});

describe('runMigrations', () => {
  it('ensures the drizzle migrations bookkeeping table exists before reading it', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS __drizzle_migrations'),
    );
  });

  it('reads the applied migration count through the working execute().rows path', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('SELECT COUNT(*)'));
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('FROM __drizzle_migrations'));
  });

  it('reads the applied count exactly once, before the apply loop', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    const selectCallIndex = mockExecute.mock.calls.findIndex(
      ([sql]) => typeof sql === 'string' && sql.includes('SELECT'),
    );
    const selectCalls = mockExecute.mock.calls.filter(
      ([sql]) => typeof sql === 'string' && sql.includes('SELECT'),
    );

    expect(selectCalls).toHaveLength(1);
    // The single read must precede the first apply transaction: read once, then
    // gate every entry against that one count snapshot.
    expect(mockExecute.mock.invocationCallOrder[selectCallIndex]).toBeLessThan(
      mockTransaction.mock.invocationCallOrder[0],
    );
  });

  it('applies every bundled migration on a fresh database, each in its own transaction', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockTxExecute).toHaveBeenCalledWith('CREATE TABLE a (id text);');
    expect(mockTxExecute).toHaveBeenCalledWith('CREATE TABLE b (id text);');
    expect(mockTxExecute).toHaveBeenCalledWith('\nCREATE TABLE c (id text);');
  });

  it('filters empty statements so a trailing breakpoint never executes a blank query', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockTxExecute).not.toHaveBeenCalledWith('');
    expect(mockTxExecute).not.toHaveBeenCalledWith('\n');
  });

  it('records each applied migration with its own journal timestamp', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO __drizzle_migrations'),
      ['', 1000],
    );
    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO __drizzle_migrations'),
      ['', 2000],
    );
  });

  it('skips migrations already recorded, applying only entries beyond the recorded count', async () => {
    const runMigrations = loadRunMigrations();
    appliedCount.current = 1;

    await runMigrations();

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxExecute).toHaveBeenCalledWith('CREATE TABLE b (id text);');
    expect(mockTxExecute).not.toHaveBeenCalledWith('CREATE TABLE a (id text);');
  });

  it('applies nothing when every bundled migration is already recorded', async () => {
    const runMigrations = loadRunMigrations();
    appliedCount.current = 2;

    await runMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('coerces a string count through Number() so the gate still holds', async () => {
    const runMigrations = loadRunMigrations();
    // op-sqlite can hand back the aggregate column as a string; the runner must
    // coerce it so a fully-migrated DB stays a no-op instead of re-applying.
    appliedCount.current = '2';

    await runMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('throws when a pending migration has no bundled SQL', async () => {
    jest.doMock('../../drizzle/migrations/migrations', () => ({
      __esModule: true,
      default: {
        journal: { entries: [{ idx: 7, when: 1000, tag: 'm0007' }] },
        migrations: {},
      },
    }));
    const runMigrations = loadRunMigrations();

    await expect(runMigrations()).rejects.toThrow('Missing migration: m0007');
  });

  it('shares a single in-flight run across concurrent callers', async () => {
    const runMigrations = loadRunMigrations();

    await Promise.all([runMigrations(), runMigrations()]);

    // Both callers share ONE run: the two bundled migrations apply once, not
    // twice, so the un-guarded CREATE TABLE cannot double-enter.
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('memoizes a completed run so a repeat call re-executes nothing', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();
    mockExecute.mockClear();
    mockTransaction.mockClear();
    await runMigrations();

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('clears the memo after a failed run so the next call retries from scratch', async () => {
    const runMigrations = loadRunMigrations();
    mockExecute.mockRejectedValueOnce(new Error('boom'));

    await expect(runMigrations()).rejects.toThrow('boom');
    await expect(runMigrations()).resolves.toBeUndefined();

    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });
});

// The device-repro suite: a real, already-migrated database whose journal has
// non-monotonic `when` timestamps. These prove the count/order gate self-heals a
// database that a timestamp gate would have left permanently broken.
describe('runMigrations — non-monotonic journal self-heal', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../drizzle/migrations/migrations', nonMonotonicBundleFactory);
  });

  it('self-heals a DB recorded through 0006: applies EXACTLY 0007 and 0008, nothing else', async () => {
    const runMigrations = loadRunMigrations();
    // Seven rows recorded (0000–0006). idx 6's `when` is LATER than idx 7/8, so
    // a timestamp gate skips them; the count gate applies exactly the tail.
    appliedCount.current = 7;

    await runMigrations();

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE `category_overrides`'),
    );
    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE `categories` ADD `color`'),
    );
    // The two applied migrations are recorded under their own (earlier) `when`.
    expect(mockTxExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), [
      '',
      1788510193092,
    ]);
    expect(mockTxExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), [
      '',
      1788514551234,
    ]);
    // Nothing at or before idx 6 is re-run.
    expect(mockTxExecute).not.toHaveBeenCalledWith('UPDATE accounts SET sort_order = 0;');
    expect(mockTxExecute).not.toHaveBeenCalledWith('CREATE TABLE accounts (id text);');
  });

  it('applies ALL nine journal migrations, in order, on a fresh/empty database', async () => {
    const runMigrations = loadRunMigrations();
    appliedCount.current = 0;

    await runMigrations();

    expect(mockTransaction).toHaveBeenCalledTimes(9);
    // The tail schema (the previously-skipped migrations) is built.
    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE `category_overrides`'),
    );
    expect(mockTxExecute).toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE `categories` ADD `color`'),
    );
  });

  it('is idempotent: a run against a fully-recorded DB applies nothing and does not error', async () => {
    const runMigrations = loadRunMigrations();
    appliedCount.current = 9;

    await expect(runMigrations()).resolves.toBeUndefined();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('never re-runs an already-recorded migration even though a later entry has an earlier `when`', async () => {
    const runMigrations = loadRunMigrations();
    // idx 8's `when` (1788514551234) is earlier than idx 6's (1788517022536).
    // A timestamp gate seeing MAX = idx 6 would still (wrongly) apply idx 8
    // because idx 8 < ... no — it would SKIP it. Either way the count gate is
    // the correct oracle: recorded through 0008 means apply nothing.
    appliedCount.current = 9;

    await runMigrations();

    expect(mockTxExecute).not.toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE `category_overrides`'),
    );
    expect(mockTxExecute).not.toHaveBeenCalledWith(
      expect.stringContaining('ALTER TABLE `categories` ADD `color`'),
    );
  });
});
