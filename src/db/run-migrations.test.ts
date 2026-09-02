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

// The exported `runMigrations` memoizes its run in a module-level in-flight
// promise, so every test loads a fresh module instance to start from a clean
// memo. A fresh `require` after `jest.resetModules` (in `beforeEach`) is the
// only way to reset that memo between tests.
const loadRunMigrations = (): (() => Promise<void>) =>
  (require('./run-migrations') as typeof import('./run-migrations')).runMigrations;

const lastAppliedRows: { current: Array<Record<string, unknown>> } = { current: [] };

beforeEach(() => {
  jest.resetModules();
  jest.doMock('../../drizzle/migrations/migrations', migrationBundleFactory);

  mockExecute.mockReset();
  mockTxExecute.mockReset();
  mockTransaction.mockClear();
  lastAppliedRows.current = [];
  mockExecute.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT')) {
      return { rows: lastAppliedRows.current };
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

  it('reads the last applied timestamp through the working execute().rows path', async () => {
    const runMigrations = loadRunMigrations();

    await runMigrations();

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, hash, created_at FROM __drizzle_migrations'),
    );
  });

  it('reads the last-applied timestamp exactly once, before the apply loop', async () => {
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
    // gate every entry against that one snapshot.
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

  it('skips migrations at or before the last applied timestamp', async () => {
    const runMigrations = loadRunMigrations();
    lastAppliedRows.current = [{ id: 1, hash: '', created_at: 1000 }];

    await runMigrations();

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockTxExecute).toHaveBeenCalledWith('CREATE TABLE b (id text);');
    expect(mockTxExecute).not.toHaveBeenCalledWith('CREATE TABLE a (id text);');
  });

  it('applies nothing when the newest migration is already recorded', async () => {
    const runMigrations = loadRunMigrations();
    lastAppliedRows.current = [{ id: 2, hash: '', created_at: 2000 }];

    await runMigrations();

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('coerces a string created_at through Number() so the gate still holds', async () => {
    const runMigrations = loadRunMigrations();
    // op-sqlite can hand back the numeric column as a string; the runner must
    // coerce it so a fully-migrated DB stays a no-op instead of re-applying.
    lastAppliedRows.current = [{ id: 2, hash: '', created_at: '1788123454602' }];

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
