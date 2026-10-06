// The real `transactionsRepo.importRows` (transactions/repo/transactions.repo.ts)
// runs through `write`, which op-sqlite's open() blocks under Jest. Mocking
// `write` to run its callback against a fake in-memory transaction handle
// lets this test drive the REAL repo function — the real (source,
// external_id) dedup upsert AND the real balance-write decision — without a
// live database, mirroring `holdings.repo.test.ts`'s fake-transaction-handle
// pattern: one persistent `store`/`holding` pair spans BOTH `importStatement`
// calls in the re-import test below, the same way that file spans one store
// across a disconnect-then-reconnect sequence.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

// The target holding's OWN currency — mocked directly at the repo boundary
// rather than through the real op-sqlite
// connection, which `write`'s own mock above already bypasses. Defaults to a
// single UAH `holding-1`, matching every pre-existing fixture below; a test
// exercising a different holding currency reassigns this before calling
// `importStatement`.
let mockHoldingRows: { id: string; currency: string }[] = [{ id: 'holding-1', currency: 'UAH' }];
jest.mock('@kiko/holdings/repo', () => ({
  // The closing-balance write forgets the deleted-row keys; this file's fake handle holds none.
  clearDeletedImportKeysDatabaseTransaction: () => Promise.resolve(),
  holdingsRepo: {
    byIdQuery: (holdingId: string) =>
      Promise.resolve(mockHoldingRows.filter((row) => row.id === holdingId)),
  },
}));

// The loan auto-link matcher itself is exhaustively unit-tested on its own
// (`use-loan-auto-link.test.ts`); this file only proves the WIRING — that
// every `importParsedStatement` caller runs it once the import commits.
const mockRunLoanAutoLink = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/loans/use-loan-auto-link', () => ({
  runLoanAutoLink: () => mockRunLoanAutoLink(),
}));

// Both one-shot rewrites are exhaustively proven on their own
// (`upgrade-stored-dedup-keys.test.ts`, `rezone-import-times.test.ts`); this
// file only proves the WIRING — the call order, and the refusal when the
// rezone step's own flag hasn't flipped afterward. Defaults keep every
// pre-existing test below unaffected (both resolve, and the flag reads
// already-rezoned). Mocked by the feature's own barrel path (never a
// relative path out of this unit — kiko-code-style's "Feature imports"), the
// same resolved module `import-statement.ts` itself imports.
const mockUpgradeStoredDedupKeys = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/statement-import/upgrade-stored-dedup-keys', () => ({
  upgradeStoredDedupKeys: () => mockUpgradeStoredDedupKeys(),
}));

const mockRezoneImportTimes = jest.fn().mockResolvedValue(undefined);
jest.mock('@kiko/statement-import/rezone-import-times', () => ({
  rezoneImportTimes: () => mockRezoneImportTimes(),
}));

let mockImportTimesRezoned = true;
let mockDedupKeysUpgraded = true;
jest.mock('@kiko/settings', () => ({
  settingsRepo: {
    getQuery: () =>
      Promise.resolve([
        { importTimesRezoned: mockImportTimesRezoned, dedupKeysUpgraded: mockDedupKeysUpgraded },
      ]),
  },
}));

import path from 'node:path';
import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { transactionsRepo } from '@kiko/transactions/repo';
import {
  ukrsibBusinessFixtureInput,
  procreditBusinessFixtureInput,
} from '@kiko/statement-import/formats/format-test-fixtures';
import { kyivWallClockToUtcMilliseconds } from '@kiko/dates';
import { accounts, categoryOverrides, holdings, transactions } from '@kiko/db';

import { StatementParseError } from '../parser';
import { applyColumnMapping, type ColumnMapping } from '../column-mapping';

import {
  importStatement,
  importParsedStatement,
  previewParsedStatementBalance,
} from './import-statement';

const fixtureText = readFileSync(
  path.join(__dirname, '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const monobankInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

// The real synthetic PrivatBank fixture (`privatbank-xlsx.format.test.ts`'s
// own fixture-reading pattern) — its 2 resolvable rows are DIFFERENT
// currencies (row 1: грн -> UAH; row 2: дол -> USD), so importing it exercises
// the real multi-currency exclusion end to end, through the real
// `detectFormat` -> `privatbankXlsxFormat.parse` pipeline, not a hand-built
// `ParsedStatement`.
const privatbankFixturePath = path.join(
  __dirname,
  '../formats/privatbank-xlsx/__fixtures__/synthetic-privatbank-sample.xlsx',
);
const readPrivatbankInput = async (): Promise<{
  text: string;
  fileName: string;
  sheetRows: unknown[][];
}> => {
  const buffer = readFileSync(privatbankFixturePath);
  const sheets = await readXlsxFile(buffer);

  return {
    text: '',
    fileName: 'synthetic-privatbank-sample.xlsx',
    sheetRows: sheets[0].data,
  };
};

beforeEach(() => {
  mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];
  mockRunLoanAutoLink.mockClear();
  mockUpgradeStoredDedupKeys.mockClear().mockResolvedValue(undefined);
  mockRezoneImportTimes.mockClear().mockResolvedValue(undefined);
  mockImportTimesRezoned = true;
  mockDedupKeysUpgraded = true;
});

// Regression fixture for the occurrence-index bug: two rows identical on
// (holding, time, amount, normalized description) — `computeDedupKey`'s own
// equivalence-class tuple — but differing only on `mcc`, a field
// `computeDedupKey` deliberately ignores.
const MONOBANK_HEADER =
  'Дата i час операції,Деталі операції,MCC,Сума в валюті картки (UAH),Сума в валюті операції,Валюта,Курс,Сума комісій (UAH),Сума кешбеку (UAH),Залишок після операції';
const duplicateMccInput = {
  text: [
    MONOBANK_HEADER,
    '01.06.2023 12:00:00,Duplicate Merchant,5411,-100,-100,UAH,—,—,—,1000',
    '01.06.2023 12:00:00,Duplicate Merchant,5412,-100,-100,UAH,—,—,—,900',
  ].join('\n'),
  fileName: 'duplicate-mcc.csv',
};

/** A row as `importRows`'s upsert sees it: enough of `TransactionRow` for
 * this fake's (source, externalId) match/refresh, plus its own `time` (the
 * fake's newest-existing-time aggregate reads this back). */
type StoredRow = { id: string; source: string; externalId: string | null; time: number } & Record<
  string,
  unknown
>;

/** The existing stored row a given incoming row's (source, externalId)
 * conflicts with, or `undefined` for a fresh insert — a null externalId
 * never conflicts (SQLite treats every NULL in a unique index as distinct). */
const findConflict = (store: StoredRow[], row: Record<string, unknown>): StoredRow | undefined => {
  const externalId = (row.externalId as string | null) ?? null;

  if (!externalId) {
    return undefined;
  }

  return store.find(
    (candidate) => candidate.source === row.source && candidate.externalId === externalId,
  );
};

/** Refresh an existing row's bank-owned columns (`set`'s keys stand in for
 * `sql\`excluded.<column>\``, which equal the incoming row's own value), or
 * push a freshly-inserted one — the same insert-or-refresh split the real
 * upsert performs per row. */
const applyUpsertRow = (
  store: { transactions: StoredRow[] },
  row: Record<string, unknown>,
  set: Record<string, unknown>,
  nextId: () => string,
): void => {
  const existing = findConflict(store.transactions, row);

  if (existing) {
    for (const key of Object.keys(set)) {
      existing[key] = row[key];
    }

    return;
  }

  store.transactions.push({ id: nextId(), ...row } as StoredRow);
};

type FakeHolding = {
  id: string;
  currency: string;
  balanceMinorUnits: number;
  accountId: string;
  balanceSetAt: number | null;
  metadata?: unknown;
};

const defaultHolding = (overrides: Partial<FakeHolding> = {}): FakeHolding => ({
  id: 'holding-1',
  currency: 'UAH',
  balanceMinorUnits: 0,
  accountId: 'acc-1',
  balanceSetAt: null,
  metadata: null,
  ...overrides,
});

const unsyncedAccount = { institution: null };

/**
 * A full in-memory fake for the write-transaction handle `importRows` runs
 * against: `categoryOverrides` always answers empty (none seeded for this
 * test), the `holdings`/`accounts` reads answer the given `holding`/`account`
 * (`.limit(1)` chained or not — both calling conventions resolve, mirroring
 * `transactions.repo.test.ts`'s own dual-convention trick), the
 * newest-existing-time aggregate is computed FRESH from `store.transactions`
 * at call time (so it reflects only rows already there BEFORE this import's
 * own upsert runs below), the dedup partition probe answers the CURRENT store
 * contents, the upsert itself applies for real via `applyUpsertRow`, and a
 * `holdings` balance write is captured.
 */
type ImportTransactionOptions = {
  store: { transactions: StoredRow[] };
  holding?: FakeHolding;
  account?: { institution: string | null };
};

/** The rows one fake `select(fields).from(table).where(...)` resolves to,
 * dispatched by table identity — and, for the no-`.limit()` `transactions`
 * reads, by the PROJECTED field set: a conflict-key probe carries
 * `externalId` and is answered with every stored row's own projected columns;
 * the post-closing `{ net }` sum and the synced-row read answer empty. The
 * holding read's `newestSyncTime` mirrors the REAL subquery's own sync-source
 * filter (`source NOT IN ('manual', 'import')`). */
const resolveImportSelect = (
  options: ImportTransactionOptions,
  table: unknown,
  fields: Record<string, unknown> | undefined,
): unknown[] => {
  if (table === categoryOverrides) {
    return [];
  }

  if (table === holdings) {
    const syncTimes = options.store.transactions
      .filter((row) => row.source !== 'manual' && row.source !== 'import')
      .map((row) => row.time);
    const newestSyncTime = syncTimes.length > 0 ? Math.max(...syncTimes) : null;

    return options.holding ? [{ ...options.holding, newestSyncTime }] : [];
  }

  if (table === accounts) {
    return options.account ? [options.account] : [];
  }

  if (table === transactions && fields && 'externalId' in fields) {
    return options.store.transactions.map((row) =>
      Object.fromEntries(Object.keys(fields).map((field) => [field, row[field]])),
    );
  }

  return [];
};

const makeImportDatabaseTransaction = (
  options: ImportTransactionOptions,
): { databaseTransaction: unknown; captured: { holdingSet?: Record<string, unknown> } } => {
  let sequence = 0;
  const nextId = (): string => `row-${++sequence}`;
  const captured: { holdingSet?: Record<string, unknown> } = {};
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  const databaseTransaction = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveImportSelect(options, table, fields)),
      }),
    }),
    insert: (table: unknown) => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          if (table !== transactions) {
            return;
          }

          for (const row of rows) {
            applyUpsertRow(options.store, row, set, nextId);
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === holdings) {
          captured.holdingSet = values;
        }

        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { databaseTransaction, captured };
};

describe('importStatement', () => {
  it('detects the format, maps every row, and imports all of them on a first pass', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    }).databaseTransaction;

    const result = await importStatement(monobankInput, 'holding-1');

    expect(result.formatId).toBe('monobank-csv');
    expect(result.total).toBe(4);
    expect(result.imported).toBe(4);
    expect(store.transactions).toHaveLength(4);
    expect(store.transactions.every((row) => row.holdingId === 'holding-1')).toBe(true);
    expect(store.transactions.every((row) => row.source === 'import')).toBe(true);
  });

  it('imports zero new rows on a re-import of the identical text into the same holding (real dedup)', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding();
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding,
      account: unsyncedAccount,
    }).databaseTransaction;

    const first = await importStatement(monobankInput, 'holding-1');

    expect(first.imported).toBe(4);

    const second = await importStatement(monobankInput, 'holding-1');

    expect(second.imported).toBe(0);
    expect(second.total).toBe(4);
    // No duplicates accumulated across the two calls — the real
    // (source, external_id) upsert refreshed the existing rows in place.
    expect(store.transactions).toHaveLength(4);
  });

  // `seenKeys` must key on `computeDedupKey`'s own (holding, time, amount,
  // normalized description) fold, never on `JSON.stringify(transaction)`
  // (the whole row) — `computeDedupKey` ignores `mcc`, so two rows identical
  // on that tuple but differing only on `mcc` would both land at
  // occurrenceIndex 0 and produce the SAME externalId, the second silently
  // overwriting the first, if `seenKeys` folded on anything finer-grained.
  it('keeps two rows identical on (holding, time, amount, description) but differing only on mcc as distinct rows', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    }).databaseTransaction;

    const result = await importStatement(duplicateMccInput, 'holding-1');

    expect(result.total).toBe(2);
    expect(result.imported).toBe(2);
    expect(store.transactions).toHaveLength(2);
    const externalIds = store.transactions.map((row) => row.externalId);
    expect(new Set(externalIds).size).toBe(2);
  });

  it('throws StatementParseError for an unrecognized file before calling the repo', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    }).databaseTransaction;
    const importRows = jest.spyOn(transactionsRepo, 'importRows');

    await expect(
      importStatement(
        { text: 'not,a,known,statement,format\n1,2,3,4,5', fileName: 'mystery.csv' },
        'holding-1',
      ),
    ).rejects.toThrow(StatementParseError);

    expect(importRows).not.toHaveBeenCalled();
    expect(store.transactions).toHaveLength(0);

    importRows.mockRestore();
  });

  describe('importParsedStatement', () => {
    it('writes rows with source "import" and returns the given formatId for a hand-built column-mapping ParsedStatement, excluding a wrong-currency row', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockDatabaseTransaction = makeImportDatabaseTransaction({
        store,
        holding: defaultHolding(),
        account: unsyncedAccount,
      }).databaseTransaction;
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];

      const parsed = {
        formatId: 'column-mapping' as const,
        account: { currency: 'UAH' as const },
        transactions: [
          {
            currency: 'UAH' as const,
            amountMinorUnits: -1_000,
            timeSeconds: 1_700_000_000,
            description: 'Coffee',
          },
          {
            currency: 'USD' as const,
            amountMinorUnits: 500,
            timeSeconds: 1_700_000_100,
            description: 'Wrong currency',
          },
        ],
      };

      const result = await importParsedStatement(parsed, 'holding-1');

      expect(result.formatId).toBe('column-mapping');
      expect(result.total).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skippedWrongCurrency).toBe(1);
      // The result names WHICH currency was skipped, not just how many rows.
      expect(result.skippedWrongCurrencyCodes).toEqual(['USD']);
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0].source).toBe('import');
    });

    // import-balance commit B: the column-mapping screen's optional "Balance" column role,
    // end to end — a real `applyColumnMapping` output (not a hand-built
    // `ParsedStatement`) carries a `closingBalance` derived from the mapped
    // Balance column, and `importParsedStatement` -> `transactionsRepo.importRows`
    // applies it exactly like a dedicated format's own closing balance would.
    it('a mapped Balance column flows through to a real import and lands the holding on the closing balance', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({ balanceMinorUnits: 0 });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];

      const mapping: ColumnMapping = {
        headerRowIndex: 0,
        decimalSeparator: '.',
        dateColumn: 0,
        dateFormat: 'DD.MM.YYYY HH:MM:SS',
        amount: { mode: 'single', column: 2 },
        descriptionColumn: 1,
        currency: { mode: 'fixed', currency: 'UAH' },
        balanceColumn: 3,
      };
      const rows = [
        ['Date', 'Description', 'Amount', 'Balance'],
        ['01.07.2025 10:00:00', 'Coffee', '-100.00', '900.00'],
        ['02.07.2025 10:00:00', 'Salary', '5000.00', '5900.00'],
      ];
      const { statement } = applyColumnMapping(rows, mapping);

      const result = await importParsedStatement(statement, 'holding-1');

      expect(result.imported).toBe(2);
      // A virgin holding has no boundary at all, so the mapped closing
      // balance (5,900.00 UAH -> 590_000 minor units, as of the newest row's
      // own time) applies outright, over the plain net-delta fallback.
      // A mapping with no time zone reads this cell as Kyiv time.
      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 590_000,
        balanceSetAt: kyivWallClockToUtcMilliseconds({
          year: 2025,
          month: 7,
          day: 2,
          hour: 10,
          minute: 0,
          second: 0,
        }),
        balanceSetRowId: null,
      });
    });
  });

  // A PrivatBank file can mix currencies per row (one card per currency) —
  // importing it into a holding of ONE of those
  // currencies must write ONLY the matching rows, at their EXACT amount, and
  // exclude (never convert, never write verbatim) every other-currency row.
  describe('multi-currency exclusion (no FX conversion, no cross-currency corruption)', () => {
    it('imports only the UAH rows into a UAH holding, at their exact amount, and counts the rest as skipped', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];
      mockDatabaseTransaction = makeImportDatabaseTransaction({
        store,
        holding: defaultHolding({ currency: 'UAH' }),
        account: unsyncedAccount,
      }).databaseTransaction;

      const result = await importStatement(await readPrivatbankInput(), 'holding-1');

      expect(result.formatId).toBe('privatbank-xlsx');
      // 2 resolvable rows total (грн + дол); фунт is excluded upstream by the
      // format's own `unresolvedRows` handling and never reaches `total`.
      expect(result.total).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skippedWrongCurrency).toBe(1);
      expect(store.transactions).toHaveLength(1);
      // The exact UAH amount (row 1: "-123,45 грн") — not the USD row's
      // 5_000 minor units, and not a corrupted cross-currency value.
      expect(store.transactions[0].amountMinorUnits).toBe(-12_345);
      expect(store.transactions.some((row) => row.amountMinorUnits === 5_000)).toBe(false);
    });

    it('imports only the USD row into a USD holding (the reverse split)', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockHoldingRows = [{ id: 'holding-1', currency: 'USD' }];
      mockDatabaseTransaction = makeImportDatabaseTransaction({
        store,
        holding: defaultHolding({ currency: 'USD' }),
        account: unsyncedAccount,
      }).databaseTransaction;

      const result = await importStatement(await readPrivatbankInput(), 'holding-1');

      expect(result.total).toBe(2);
      expect(result.imported).toBe(1);
      expect(result.skippedWrongCurrency).toBe(1);
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0].amountMinorUnits).toBe(5_000);
      expect(store.transactions.some((row) => row.amountMinorUnits === -12_345)).toBe(false);
    });

    it('throws when the target holding cannot be found, writing nothing', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockHoldingRows = [];
      mockDatabaseTransaction = makeImportDatabaseTransaction({
        store,
        holding: defaultHolding(),
        account: unsyncedAccount,
      }).databaseTransaction;
      const importRows = jest.spyOn(transactionsRepo, 'importRows');

      await expect(importStatement(monobankInput, 'missing-holding')).rejects.toThrow(
        'Target holding not found: missing-holding',
      );

      expect(importRows).not.toHaveBeenCalled();
      expect(store.transactions).toHaveLength(0);

      importRows.mockRestore();
    });
  });

  // An import-only holding's displayed balance stayed 0 forever, because the
  // old code never wrote to `holdings` at all. `holdingValueBreakdown`/
  // `guardedNetWorth` (the Home net-worth path) read
  // `holding.balanceMinorUnits` verbatim (`holding-value.ts` `flat()`), so
  // proving the repo's write here is the same proof for Home.
  describe('balance write (net of genuinely new rows after the boundary, plus the closing-balance override)', () => {
    // Ukrsibbank business CSV carries no closing balance at all (its own
    // format doc comment; see `ParsedStatement.closingBalance`), so this
    // isolates the boundary's plain net-delta arithmetic with no closing-balance
    // interference — unlike Monobank CSV, which always carries one and, for
    // a virgin (no-history) holding, is always eligible to apply outright
    // (see the closing-balance tests below and `transactions.repo.test.ts`'s
    // "treats a holding with no prior transactions as always eligible").
    it('moves a 0-balance holding to the net of the imported rows on a first import', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({ balanceMinorUnits: 0 });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;

      const result = await importStatement(ukrsibBusinessFixtureInput, 'holding-1');

      // 2 UAH rows land (-25_000 debit, +500_000 credit); the 2 USD rows are
      // excluded as wrong-currency. Net = -25_000 + 500_000 = 475_000.
      expect(result.skippedWrongCurrency).toBe(2);
      expect(captured.holdingSet).toEqual({ balanceMinorUnits: 475_000 });
    });

    it('leaves the balance untouched on a re-import of the identical file (net of new rows is 0)', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({ balanceMinorUnits: 0 });
      mockDatabaseTransaction = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      }).databaseTransaction;

      await importStatement(ukrsibBusinessFixtureInput, 'holding-1');
      // The fake commits `captured.holdingSet` to the SAME `holding` object a
      // real op-sqlite transaction would have, so the second call's balance
      // read sees the first call's write.
      holding.balanceMinorUnits = 475_000;

      const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
      mockDatabaseTransaction = second.databaseTransaction;

      const result = await importStatement(ukrsibBusinessFixtureInput, 'holding-1');

      expect(result.imported).toBe(0);
      expect(second.captured.holdingSet).toBeUndefined();
    });

    it('sets a VIRGIN (no-history) holding straight to a real closing-balance-carrying import’s own closing balance', async () => {
      // The exact shape of the bug report's repro: a holding created purely
      // to receive an import, never touched by anything else. With no prior
      // transaction to compare against, Monobank CSV's own closing balance
      // (the bank's ground truth) applies outright rather than the net-delta
      // fallback.
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({ balanceMinorUnits: 0 });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;

      await importStatement(monobankInput, 'holding-1');

      // Applying the closing balance also stamps `balanceSetAt` — the
      // fixture's own last row's time — as this holding's boundary for a
      // later import.
      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 10_000_000,
        balanceSetAt: 1_683_901_836_000,
        balanceSetRowId: null,
      });
    });

    // The sync already writes every row under its own source; the same rows
    // under the import source would be a second, undeletable copy.
    it('refuses to import into an account a bank sync owns, writing nothing', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({
        balanceMinorUnits: 0,
        metadata: { monobankId: 'mono-1' },
      });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: { institution: 'monobank' },
      });
      mockDatabaseTransaction = databaseTransaction;

      await expect(importStatement(monobankInput, 'holding-1')).rejects.toThrow(
        'statement-import/synced-account',
      );
      expect(store.transactions).toHaveLength(0);
      expect(captured.holdingSet).toBeUndefined();
    });

    it('wrong-currency rows contribute 0 to the balance delta (excluded before the repo ever sees them)', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      // The real PrivatBank fixture's 2 resolvable rows are different
      // currencies (UAH -123.45, USD +50.00) — importing into a UAH holding
      // must move the balance by ONLY the UAH row's exact amount, never the
      // USD row's minor units (a ~40x cross-currency corruption if it did).
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];
      const holding = defaultHolding({ currency: 'UAH', balanceMinorUnits: 0 });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;

      const result = await importStatement(await readPrivatbankInput(), 'holding-1');

      expect(result.skippedWrongCurrency).toBe(1);
      expect(captured.holdingSet).toEqual({ balanceMinorUnits: -12_345 });
    });

    it('sets the balance to the closing balance when the statement is at or after the hand-set boundary', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      // A hand-set balance well before the fixture's own dates
      // (`balanceSetAt`, not a seeded ledger row — see `holdings.repo.test.ts`
      // for `holdingsRepo.create`/`updateWithBalanceDelta` writing it for real).
      const holding = defaultHolding({ balanceMinorUnits: -999_999, balanceSetAt: 1 });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;

      await importStatement(monobankInput, 'holding-1');

      // Monobank CSV's closing balance is the fixture's last row's own
      // "Залишок після операції": 100000.00 UAH -> 10_000_000 minor units —
      // NOT base + net (which would be -999_999 + -21_794). Applying it also
      // moves `balanceSetAt` to that same instant.
      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 10_000_000,
        balanceSetAt: 1_683_901_836_000,
        balanceSetRowId: null,
      });
    });

    // A statement entirely OLDER than the holding's hand-set boundary is
    // history from end to end — its own closing balance is ignored, and its
    // rows contribute 0 to the balance (they still land as real ledger
    // rows). A boundary newer than every date in the Monobank fixture
    // (which ends 2023-05-12) makes the statement the older one.
    it('treats an entirely OLDER statement as history: its closing balance is ignored, its rows land but move nothing', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({
        balanceMinorUnits: 500_000,
        balanceSetAt: Date.UTC(2025, 0, 1),
      });
      const { databaseTransaction, captured } = makeImportDatabaseTransaction({
        store,
        holding,
        account: unsyncedAccount,
      });
      mockDatabaseTransaction = databaseTransaction;

      const result = await importStatement(monobankInput, 'holding-1');

      // All 4 rows still land as ledger history (imported: 4) — the
      // fixture's own closing balance (10_000_000) is ignored (as before),
      // and every row is also dated before the boundary, so the net-delta
      // fallback adds 0: the balance stays exactly 500_000.
      expect(result.imported).toBe(4);
      expect(store.transactions).toHaveLength(4);
      expect(captured.holdingSet).toBeUndefined();
    });
  });
});

// An older build read a real `00:00:00` bank time as a date-only noon, so
// the ledger can hold that row at Kyiv noon under a noon-time key. This
// stands in for that ledger by rewriting a fresh import's midnight rows the
// way the older build would have written them.
const keyRowsAtNoonLikeAnOlderBuild = (
  store: { transactions: StoredRow[] },
  day: { year: number; month: number; day: number },
): void => {
  const at = (hour: number): number =>
    (kyivWallClockToUtcMilliseconds({ ...day, hour, minute: 0, second: 0 }) ?? Number.NaN) / 1000;
  const midnightSeconds = at(0);
  const noonSeconds = at(12);

  for (const row of store.transactions) {
    if (row.time === midnightSeconds * 1000 && row.externalId) {
      row.time = noonSeconds * 1000;
      row.externalId = row.externalId.replace(` ${midnightSeconds} `, ` ${noonSeconds} `);
    }
  }
};

describe('a real 00:00:00 row the ledger already holds at noon', () => {
  it('adds nothing on a ProCredit re-import (no closing balance)', async () => {
    mockHoldingRows = [{ id: 'holding-1', currency: 'GBP' }];
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding({ currency: 'GBP' });
    const first = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = first.databaseTransaction;

    const firstResult = await importStatement(procreditBusinessFixtureInput, 'holding-1');

    // 3 of the sample's 4 GBP rows are stamped 01.01.2000 00:00:00.
    expect(firstResult.imported).toBe(4);
    keyRowsAtNoonLikeAnOlderBuild(store, { year: 2000, month: 1, day: 1 });
    holding.balanceMinorUnits = first.captured.holdingSet?.balanceMinorUnits as number;
    const storedBefore = store.transactions.map((row) => ({ ...row }));
    const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = second.databaseTransaction;

    const result = await importStatement(procreditBusinessFixtureInput, 'holding-1');

    expect(result.imported).toBe(0);
    expect(store.transactions).toEqual(storedBefore);
    expect(second.captured.holdingSet).toBeUndefined();
  });

  it('adds nothing on a Monobank re-import (closing balance)', async () => {
    const input = {
      text: [
        MONOBANK_HEADER,
        '02.06.2023 09:15:00,Taxi,4121,-120,-120,UAH,—,—,—,880',
        '01.06.2023 00:00:00,Monthly fee,4829,-50,-50,UAH,—,—,—,1000',
      ].join('\n'),
      fileName: 'midnight-monobank.csv',
    };
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding();
    const first = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = first.databaseTransaction;

    await importStatement(input, 'holding-1');
    keyRowsAtNoonLikeAnOlderBuild(store, { year: 2023, month: 6, day: 1 });
    Object.assign(holding, first.captured.holdingSet);
    const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = second.databaseTransaction;

    const result = await importStatement(input, 'holding-1');

    expect(result.imported).toBe(0);
    expect(store.transactions).toHaveLength(2);
    expect(second.captured.holdingSet?.balanceMinorUnits).toBe(88_000);
  });

  it('adds nothing on a column-mapped re-import with a timed preset', async () => {
    const mapping: ColumnMapping = {
      headerRowIndex: 0,
      decimalSeparator: '.',
      dateColumn: 0,
      dateFormat: 'DD.MM.YYYY HH:MM:SS',
      amount: { mode: 'single', column: 2 },
      descriptionColumn: 1,
      currency: { mode: 'fixed', currency: 'UAH' },
    };
    const rows = [
      ['Date', 'Description', 'Amount'],
      ['01.03.2026 00:00:00', 'Rent', '-1000.00'],
      ['02.03.2026 10:00:00', 'Salary', '5000.00'],
    ];
    const { statement } = applyColumnMapping(rows, mapping);
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding();
    const first = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = first.databaseTransaction;

    await importParsedStatement(statement, 'holding-1');
    keyRowsAtNoonLikeAnOlderBuild(store, { year: 2026, month: 3, day: 1 });
    holding.balanceMinorUnits = first.captured.holdingSet?.balanceMinorUnits as number;
    const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = second.databaseTransaction;

    const result = await importParsedStatement(statement, 'holding-1');

    expect(result.imported).toBe(0);
    expect(store.transactions).toHaveLength(2);
    expect(second.captured.holdingSet).toBeUndefined();
  });

  it('still inserts a midnight row the ledger holds under no key at all', async () => {
    mockHoldingRows = [{ id: 'holding-1', currency: 'GBP' }];
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding({ currency: 'GBP' });
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding,
      account: unsyncedAccount,
    }).databaseTransaction;
    await importStatement(procreditBusinessFixtureInput, 'holding-1');
    keyRowsAtNoonLikeAnOlderBuild(store, { year: 2000, month: 1, day: 1 });
    const debit = store.transactions.find((row) => row.amountMinorUnits === -1_847_500);
    store.transactions = store.transactions.filter((row) => row !== debit);
    const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = second.databaseTransaction;

    const result = await importStatement(procreditBusinessFixtureInput, 'holding-1');
    const midnight = kyivWallClockToUtcMilliseconds({
      year: 2000,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });

    expect(result.imported).toBe(1);
    expect(store.transactions.find((row) => row.amountMinorUnits === -1_847_500)?.time).toBe(
      midnight,
    );
    expect(second.captured.holdingSet?.balanceMinorUnits).toBe(
      holding.balanceMinorUnits - 1_847_500,
    );
  });

  // No older build ever read a UTC-10 file, so a stored row whose time is
  // Kyiv noon is a real row here, never a noon-keyed copy.
  it('inserts and counts a new row on a non-Kyiv mapping whose Kyiv time is midnight', async () => {
    const mapping: ColumnMapping = {
      headerRowIndex: 0,
      decimalSeparator: '.',
      dateColumn: 0,
      dateFormat: 'DD.MM.YYYY HH:MM:SS',
      timeZone: 'UTC-10:00',
      amount: { mode: 'single', column: 2 },
      descriptionColumn: 1,
      currency: { mode: 'fixed', currency: 'UAH' },
    };
    const header = ['Date', 'Description', 'Amount'];
    const newer = applyColumnMapping(
      [header, ['01.02.2026 00:00:00', 'Subscription', '-100.00']],
      mapping,
    ).statement;
    const older = applyColumnMapping(
      [header, ['31.01.2026 12:00:00', 'Subscription', '-100.00']],
      mapping,
    ).statement;
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const holding = defaultHolding();
    const first = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = first.databaseTransaction;

    await importParsedStatement(newer, 'holding-1');
    holding.balanceMinorUnits = first.captured.holdingSet?.balanceMinorUnits as number;
    const second = makeImportDatabaseTransaction({ store, holding, account: unsyncedAccount });
    mockDatabaseTransaction = second.databaseTransaction;

    const result = await importParsedStatement(older, 'holding-1');

    expect(result.imported).toBe(1);
    expect(store.transactions).toHaveLength(2);
    expect(second.captured.holdingSet?.balanceMinorUnits).toBe(-20_000);
  });
});

// Both `importParsedStatement` callers (the dedicated `importStatement`
// above, and the generic column-mapping import, which calls
// `importParsedStatement` directly) fan through this ONE function, so
// wiring the matcher inside it alone covers both.
describe('importParsedStatement runs the loan auto-link matcher', () => {
  it('runs it once after a dedicated (importStatement) import commits', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const { databaseTransaction } = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    });
    mockDatabaseTransaction = databaseTransaction;

    await importStatement(monobankInput, 'holding-1');

    expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
  });

  it('runs it once after a column-mapping (direct importParsedStatement) import commits', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const { databaseTransaction } = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    });
    mockDatabaseTransaction = databaseTransaction;
    const parsed = {
      formatId: 'column-mapping' as const,
      account: { currency: 'UAH' as const },
      transactions: [
        {
          currency: 'UAH' as const,
          amountMinorUnits: -1_000,
          timeSeconds: 1_700_000_000,
          description: 'Coffee',
        },
      ],
    };

    await importParsedStatement(parsed, 'holding-1');

    expect(mockRunLoanAutoLink).toHaveBeenCalledTimes(1);
  });
});

describe('importParsedStatement hands each row its time reading', () => {
  it("passes each row's own reading and stores no reading column", async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const { databaseTransaction } = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    });
    mockDatabaseTransaction = databaseTransaction;
    const importRows = jest.spyOn(transactionsRepo, 'importRows');
    const parsed = {
      formatId: 'sensebank-csv' as const,
      account: { currency: 'UAH' as const },
      transactions: [
        {
          currency: 'UAH' as const,
          amountMinorUnits: -1_000,
          timeSeconds: 1_700_000_040,
          timeReading: { kind: 'minute' as const },
          description: 'Coffee',
        },
        {
          currency: 'UAH' as const,
          amountMinorUnits: -2_000,
          timeSeconds: 1_700_000_100,
          description: 'Lunch',
        },
        {
          currency: 'UAH' as const,
          amountMinorUnits: -3_000,
          timeSeconds: 1_700_043_200,
          timeReading: {
            kind: 'day' as const,
            fromSeconds: 1_700_000_000,
            untilSeconds: 1_700_086_400,
          },
          description: 'Market',
        },
      ],
    };

    await importParsedStatement(parsed, 'holding-1');

    expect(importRows.mock.calls[0][0].rows.map((row) => row.timeReading)).toEqual([
      { kind: 'minute' },
      undefined,
      { kind: 'day', fromSeconds: 1_700_000_000, untilSeconds: 1_700_086_400 },
    ]);
    expect(store.transactions.every((row) => !('timeReading' in row))).toBe(true);

    importRows.mockRestore();
  });
});

describe('importParsedStatement runs the one-shot statement-import rewrites first', () => {
  const parsed = {
    formatId: 'column-mapping' as const,
    account: { currency: 'UAH' as const },
    transactions: [
      {
        currency: 'UAH' as const,
        amountMinorUnits: -1_000,
        timeSeconds: 1_700_000_000,
        description: 'Coffee',
      },
    ],
  };

  it('runs the dedup-key upgrade, then the import-time rezone, before writing any row', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const { databaseTransaction } = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    });
    mockDatabaseTransaction = databaseTransaction;
    const order: string[] = [];
    mockUpgradeStoredDedupKeys.mockImplementation(async () => {
      order.push('dedup-key-upgrade');
    });
    mockRezoneImportTimes.mockImplementation(async () => {
      order.push('import-time-rezone');
    });

    const result = await importParsedStatement(parsed, 'holding-1');

    expect(result.imported).toBe(1);
    expect(order).toEqual(['dedup-key-upgrade', 'import-time-rezone']);
  });

  it('refuses the import, writing no row, when the rezone flag is still false afterward', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    const { databaseTransaction } = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    });
    mockDatabaseTransaction = databaseTransaction;
    mockImportTimesRezoned = false;

    await expect(importParsedStatement(parsed, 'holding-1')).rejects.toThrow(
      'statement-import/rezone-pending',
    );
    expect(store.transactions).toEqual([]);
  });
});

describe('previewParsedStatementBalance', () => {
  const closingBalance = {
    minorUnits: 90_000,
    currency: 'UAH' as const,
    asOfSeconds: 1_700_086_400,
  };
  const parsed = {
    formatId: 'column-mapping' as const,
    account: { currency: 'UAH' as const },
    closingBalance,
    transactions: [
      {
        currency: 'UAH' as const,
        amountMinorUnits: -1_000,
        timeSeconds: 1_700_000_040,
        timeReading: { kind: 'minute' as const },
        description: 'Coffee',
      },
      {
        currency: 'USD' as const,
        amountMinorUnits: -2_000,
        timeSeconds: 1_700_000_100,
        description: 'Dollar lunch',
      },
      {
        currency: 'UAH' as const,
        amountMinorUnits: -1_000,
        timeSeconds: 1_700_000_040,
        timeReading: { kind: 'minute' as const },
        description: 'Coffee',
      },
    ],
  };
  const preview = {
    kind: 'set' as const,
    currency: 'UAH' as const,
    minorUnits: 90_000,
    bankMinorUnits: 90_000,
    asOfSeconds: closingBalance.asOfSeconds,
  };
  let previewImportBalance: jest.SpyInstance;
  let importRows: jest.SpyInstance;

  beforeEach(() => {
    previewImportBalance = jest.spyOn(transactionsRepo, 'previewImportBalance');
    previewImportBalance.mockResolvedValue(preview);
    importRows = jest.spyOn(transactionsRepo, 'importRows');
  });

  afterEach(() => {
    previewImportBalance.mockRestore();
    importRows.mockRestore();
  });

  it('returns what the repository says the balance will become', async () => {
    await expect(previewParsedStatementBalance(parsed, 'holding-1')).resolves.toEqual(preview);
  });

  it('hands the repository the same rows and closing balance the import writes', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeImportDatabaseTransaction({
      store,
      holding: defaultHolding(),
      account: unsyncedAccount,
    }).databaseTransaction;

    await importParsedStatement(parsed, 'holding-1');
    await previewParsedStatementBalance(parsed, 'holding-1');

    expect(previewImportBalance).toHaveBeenCalledTimes(1);
    expect(previewImportBalance.mock.calls[0][0]).toEqual(importRows.mock.calls[0][0]);
  });

  it('leaves out a row in another currency than the holding, like the import', async () => {
    await previewParsedStatementBalance(parsed, 'holding-1');

    expect(
      previewImportBalance.mock.calls[0][0].rows.map(
        (row: { amountMinorUnits: number }) => row.amountMinorUnits,
      ),
    ).toEqual([-1_000, -1_000]);
  });

  it('gives a repeated row its own occurrence key, like the import', async () => {
    await previewParsedStatementBalance(parsed, 'holding-1');

    const keys = previewImportBalance.mock.calls[0][0].rows.map(
      (row: { externalId: string }) => row.externalId,
    );

    expect(new Set(keys).size).toBe(2);
  });

  it('writes nothing: no rewrite, no import, no loan matcher', async () => {
    await previewParsedStatementBalance(parsed, 'holding-1');

    expect(mockUpgradeStoredDedupKeys).not.toHaveBeenCalled();
    expect(mockRezoneImportTimes).not.toHaveBeenCalled();
    expect(importRows).not.toHaveBeenCalled();
    expect(mockRunLoanAutoLink).not.toHaveBeenCalled();
  });

  // The preview writes nothing, so it cannot run the two rewrites the import
  // runs first; it would otherwise judge rows against keys and times the import
  // has not yet put into the form it stores. It refuses, so no balance line
  // shows rather than one the import could contradict.
  it('throws while the import-time rezone flag is false, asking the repository nothing', async () => {
    mockImportTimesRezoned = false;

    await expect(previewParsedStatementBalance(parsed, 'holding-1')).rejects.toThrow(
      'statement-import/preview-pending',
    );
    expect(previewImportBalance).not.toHaveBeenCalled();
  });

  it('throws while the stored dedup keys are not yet upgraded, asking the repository nothing', async () => {
    mockDedupKeysUpgraded = false;

    await expect(previewParsedStatementBalance(parsed, 'holding-1')).rejects.toThrow(
      'statement-import/preview-pending',
    );
    expect(previewImportBalance).not.toHaveBeenCalled();
  });

  it('throws when the target holding cannot be found, asking the repository nothing', async () => {
    mockHoldingRows = [];

    await expect(previewParsedStatementBalance(parsed, 'missing-holding')).rejects.toThrow(
      'Target holding not found: missing-holding',
    );
    expect(previewImportBalance).not.toHaveBeenCalled();
  });
});
