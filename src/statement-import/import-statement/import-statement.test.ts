// The real `transactionsRepo.importRows` (transactions/repo/transactions.repo.ts)
// runs through `write`, which op-sqlite's open() blocks under Jest. Mocking
// `write` to run its callback against a fake in-memory transaction handle
// lets this test drive the REAL repo function — the real (source,
// external_id) dedup upsert AND the real balance-write decision — without a
// live database, mirroring `holdings.repo.test.ts`'s fake-transaction-handle
// pattern: one persistent `store`/`holding` pair spans BOTH `importStatement`
// calls in the re-import test below, the same way that file spans one store
// across a disconnect-then-reconnect sequence.
let mockTx: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

// The target holding's OWN currency (Task 3 review, CRITICAL fix) — mocked
// directly at the repo boundary rather than through the real op-sqlite
// connection, which `write`'s own mock above already bypasses. Defaults to a
// single UAH `holding-1`, matching every pre-existing fixture below; a test
// exercising a different holding currency reassigns this before calling
// `importStatement`.
let mockHoldingRows: { id: string; currency: string }[] = [{ id: 'holding-1', currency: 'UAH' }];
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    byIdQuery: (holdingId: string) =>
      Promise.resolve(mockHoldingRows.filter((row) => row.id === holdingId)),
  },
}));

import path from 'node:path';
import { readFileSync } from 'node:fs';
import readXlsxFile from 'read-excel-file/node';
import { transactionsRepo } from '@kiko/transactions/repo';

import { StatementParseError } from '../parser';
import { ukrsibBusinessFixtureInput } from '../formats/format-test-fixtures';
import { accounts, categoryOverrides, holdings, transactions } from '../../db/schema';

import { importStatement, importParsedStatement } from './import-statement';

const fixtureText = readFileSync(
  path.join(__dirname, '../formats/monobank-csv/__fixtures__/uabean-monobank-sample.csv'),
  'utf-8',
);
const monobankInput = { text: fixtureText, fileName: 'uabean-monobank-sample.csv' };

// The real synthetic PrivatBank fixture (Task 3, `privatbank-xlsx.format.test.ts`'s
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
type ImportTxOpts = {
  store: { transactions: StoredRow[] };
  holding?: FakeHolding;
  account?: { institution: string | null };
};

/** The rows one fake `select(fields).from(table).where(...)` resolves to,
 * dispatched by table identity — and, for the two no-`.limit()` `transactions`
 * reads (the sync-boundary aggregate vs. the dedup partition probe), by the
 * PROJECTED field set (`{ time }` vs `{ source, externalId }`), since both
 * share the same table identity. The "time" read mirrors the REAL query's
 * own sync-source filter (`source NOT IN ('manual', 'import')`) — the
 * hand-set boundary source comes back separately, straight off
 * `opts.holding.balanceSetAt`. */
const resolveImportSelect = (
  opts: ImportTxOpts,
  table: unknown,
  fields: Record<string, unknown> | undefined,
): unknown[] => {
  if (table === categoryOverrides) {
    return [];
  }

  if (table === holdings) {
    return opts.holding ? [opts.holding] : [];
  }

  if (table === accounts) {
    return opts.account ? [opts.account] : [];
  }

  if (table === transactions && fields && 'time' in fields) {
    const syncTimes = opts.store.transactions
      .filter((row) => row.source !== 'manual' && row.source !== 'import')
      .map((row) => row.time);

    return syncTimes.length > 0 ? [{ time: Math.max(...syncTimes) }] : [{ time: null }];
  }

  return opts.store.transactions.map((row) => ({ source: row.source, externalId: row.externalId }));
};

const makeImportTx = (
  opts: ImportTxOpts,
): { tx: unknown; captured: { holdingSet?: Record<string, unknown> } } => {
  let sequence = 0;
  const nextId = (): string => `row-${++sequence}`;
  const captured: { holdingSet?: Record<string, unknown> } = {};
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  const tx = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveImportSelect(opts, table, fields)),
      }),
    }),
    insert: (table: unknown) => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          if (table !== transactions) {
            return;
          }

          for (const row of rows) {
            applyUpsertRow(opts.store, row, set, nextId);
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

  return { tx, captured };
};

describe('importStatement', () => {
  it('detects the format, maps every row, and imports all of them on a first pass', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockTx = makeImportTx({ store, holding: defaultHolding(), account: unsyncedAccount }).tx;

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
    mockTx = makeImportTx({ store, holding, account: unsyncedAccount }).tx;

    const first = await importStatement(monobankInput, 'holding-1');

    expect(first.imported).toBe(4);

    const second = await importStatement(monobankInput, 'holding-1');

    expect(second.imported).toBe(0);
    expect(second.total).toBe(4);
    // No duplicates accumulated across the two calls — the real
    // (source, external_id) upsert refreshed the existing rows in place.
    expect(store.transactions).toHaveLength(4);
  });

  // Regression test: `seenKeys` used to key on `JSON.stringify(transaction)`
  // (the whole row), but `computeDedupKey` folds only on (holding, time,
  // amount, normalized description) — it ignores `mcc`. Two rows identical
  // on that tuple but differing only on `mcc` each got occurrenceIndex 0
  // under the old code, so `computeDedupKey` produced the SAME externalId
  // for both and the second silently overwrote the first.
  it('keeps two rows identical on (holding, time, amount, description) but differing only on mcc as distinct rows', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockTx = makeImportTx({ store, holding: defaultHolding(), account: unsyncedAccount }).tx;

    const result = await importStatement(duplicateMccInput, 'holding-1');

    expect(result.total).toBe(2);
    expect(result.imported).toBe(2);
    expect(store.transactions).toHaveLength(2);
    const externalIds = store.transactions.map((row) => row.externalId);
    expect(new Set(externalIds).size).toBe(2);
  });

  it('throws StatementParseError for an unrecognized file before calling the repo', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockTx = makeImportTx({ store, holding: defaultHolding(), account: unsyncedAccount }).tx;
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
      mockTx = makeImportTx({ store, holding: defaultHolding(), account: unsyncedAccount }).tx;
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
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0].source).toBe('import');
    });
  });

  // Task 3 review, CRITICAL: a PrivatBank file can mix currencies per row
  // (one card per currency) — importing it into a holding of ONE of those
  // currencies must write ONLY the matching rows, at their EXACT amount, and
  // exclude (never convert, never write verbatim) every other-currency row.
  describe('multi-currency exclusion (no FX conversion, no cross-currency corruption)', () => {
    it('imports only the UAH rows into a UAH holding, at their exact amount, and counts the rest as skipped', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];
      mockTx = makeImportTx({
        store,
        holding: defaultHolding({ currency: 'UAH' }),
        account: unsyncedAccount,
      }).tx;

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
      mockTx = makeImportTx({
        store,
        holding: defaultHolding({ currency: 'USD' }),
        account: unsyncedAccount,
      }).tx;

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
      mockTx = makeImportTx({ store, holding: defaultHolding(), account: unsyncedAccount }).tx;
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
  describe('balance write (net of genuinely new rows at/after the boundary, plus the closing-balance override)', () => {
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
      const { tx, captured } = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = tx;

      const result = await importStatement(ukrsibBusinessFixtureInput, 'holding-1');

      // 2 UAH rows land (-25_000 debit, +500_000 credit); the 2 USD rows are
      // excluded as wrong-currency. Net = -25_000 + 500_000 = 475_000.
      expect(result.skippedWrongCurrency).toBe(2);
      expect(captured.holdingSet).toEqual({ balanceMinorUnits: 475_000 });
    });

    it('leaves the balance untouched on a re-import of the identical file (net of new rows is 0)', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({ balanceMinorUnits: 0 });
      mockTx = makeImportTx({ store, holding, account: unsyncedAccount }).tx;

      await importStatement(ukrsibBusinessFixtureInput, 'holding-1');
      // The fake commits `captured.holdingSet` to the SAME `holding` object a
      // real op-sqlite transaction would have, so the second call's balance
      // read sees the first call's write.
      holding.balanceMinorUnits = 475_000;

      const second = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = second.tx;

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
      const { tx, captured } = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = tx;

      await importStatement(monobankInput, 'holding-1');

      // Applying the closing balance also stamps `balanceSetAt` — the
      // fixture's own last row's time — as this holding's boundary for a
      // later import.
      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 10_000_000,
        balanceSetAt: 1_683_912_636_000,
      });
    });

    it('never moves a SYNCED holding’s balance, even though its new rows still import', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      const holding = defaultHolding({
        balanceMinorUnits: 0,
        metadata: { monobankId: 'mono-1' },
      });
      const { tx, captured } = makeImportTx({
        store,
        holding,
        account: { institution: 'monobank' },
      });
      mockTx = tx;

      const result = await importStatement(monobankInput, 'holding-1');

      expect(result.imported).toBe(4);
      expect(store.transactions).toHaveLength(4);
      // The sync pipeline stays the sole owner of this holding's balance.
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
      const { tx, captured } = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = tx;

      const result = await importStatement(await readPrivatbankInput(), 'holding-1');

      expect(result.skippedWrongCurrency).toBe(1);
      expect(captured.holdingSet).toEqual({ balanceMinorUnits: -12_345 });
    });

    it('sets the balance to the closing balance when the statement is at or after the hand-set boundary', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      // A hand-set balance well before the fixture's own dates (D-I2:
      // `balanceSetAt`, not a seeded ledger row — see `holdings.repo.test.ts`
      // for `holdingsRepo.create`/`updateWithBalanceDelta` writing it for real).
      const holding = defaultHolding({ balanceMinorUnits: -999_999, balanceSetAt: 1 });
      const { tx, captured } = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = tx;

      await importStatement(monobankInput, 'holding-1');

      // Monobank CSV's closing balance is the fixture's last row's own
      // "Залишок після операції": 100000.00 UAH -> 10_000_000 minor units —
      // NOT base + net (which would be -999_999 + -21_794). Applying it also
      // moves `balanceSetAt` to that same instant.
      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 10_000_000,
        balanceSetAt: 1_683_912_636_000,
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
      const { tx, captured } = makeImportTx({ store, holding, account: unsyncedAccount });
      mockTx = tx;

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
