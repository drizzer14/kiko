// The real `transactionsRepo.addManyDedup` (transactions/repo/transactions.repo.ts)
// runs through `write`, which op-sqlite's open() blocks under Jest. Mocking
// `write` to run its callback against a fake in-memory transaction handle
// lets this test drive the REAL repo function — the real (source,
// external_id) dedup upsert — without a live database, mirroring
// `holdings.repo.test.ts`'s fake-transaction-handle pattern: one persistent
// `store` spans BOTH `importStatement` calls in the re-import test below, the
// same way that file spans one store across a disconnect-then-reconnect
// sequence.
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
import { categoryOverrides, transactions } from '../../db/schema';

import { importStatement } from './import-statement';

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

/** A row as `addManyDedup`'s upsert sees it: enough of `TransactionRow` for
 * this fake's (source, externalId) match/refresh. */
type StoredRow = { id: string; source: string; externalId: string | null } & Record<
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

/**
 * A minimal in-memory fake for the write-transaction handle
 * `transactionsRepo.addManyDedup` runs against: the name→category rule
 * lookup (`categoryOverrides`) always answers empty (none seeded for this
 * test), the pre-write existing-row read answers with the CURRENT store
 * contents, and the upsert itself is applied for real via `applyUpsertRow` —
 * a row whose (source, externalId) already exists in `store` is refreshed,
 * everything else is a fresh insert.
 */
const makeAddManyDedupTx = (store: { transactions: StoredRow[] }) => {
  let sequence = 0;
  const nextId = (): string => `row-${++sequence}`;

  return {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === categoryOverrides
            ? []
            : store.transactions.map((row) => ({ source: row.source, externalId: row.externalId })),
      }),
    }),
    insert: (table: unknown) => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          if (table !== transactions) {
            return;
          }

          for (const row of rows) {
            applyUpsertRow(store, row, set, nextId);
          }
        },
      }),
    }),
  };
};

describe('importStatement', () => {
  it('detects the format, maps every row, and imports all of them on a first pass', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockTx = makeAddManyDedupTx(store);

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
    mockTx = makeAddManyDedupTx(store);

    const first = await importStatement(monobankInput, 'holding-1');
    const second = await importStatement(monobankInput, 'holding-1');

    expect(first.imported).toBe(4);
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
    mockTx = makeAddManyDedupTx(store);

    const result = await importStatement(duplicateMccInput, 'holding-1');

    expect(result.total).toBe(2);
    expect(result.imported).toBe(2);
    expect(store.transactions).toHaveLength(2);
    const externalIds = store.transactions.map((row) => row.externalId);
    expect(new Set(externalIds).size).toBe(2);
  });

  it('throws StatementParseError for an unrecognized file before calling the repo', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockTx = makeAddManyDedupTx(store);
    const addManyDedup = jest.spyOn(transactionsRepo, 'addManyDedup');

    await expect(
      importStatement(
        { text: 'not,a,known,statement,format\n1,2,3,4,5', fileName: 'mystery.csv' },
        'holding-1',
      ),
    ).rejects.toThrow(StatementParseError);

    expect(addManyDedup).not.toHaveBeenCalled();
    expect(store.transactions).toHaveLength(0);

    addManyDedup.mockRestore();
  });

  // Task 3 review, CRITICAL: a PrivatBank file can mix currencies per row
  // (one card per currency) — importing it into a holding of ONE of those
  // currencies must write ONLY the matching rows, at their EXACT amount, and
  // exclude (never convert, never write verbatim) every other-currency row.
  describe('multi-currency exclusion (no FX conversion, no cross-currency corruption)', () => {
    it('imports only the UAH rows into a UAH holding, at their exact amount, and counts the rest as skipped', async () => {
      const store: { transactions: StoredRow[] } = { transactions: [] };
      mockTx = makeAddManyDedupTx(store);
      mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];

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
      mockTx = makeAddManyDedupTx(store);
      mockHoldingRows = [{ id: 'holding-1', currency: 'USD' }];

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
      mockTx = makeAddManyDedupTx(store);
      mockHoldingRows = [];
      const addManyDedup = jest.spyOn(transactionsRepo, 'addManyDedup');

      await expect(importStatement(monobankInput, 'missing-holding')).rejects.toThrow(
        'Target holding not found: missing-holding',
      );

      expect(addManyDedup).not.toHaveBeenCalled();
      expect(store.transactions).toHaveLength(0);

      addManyDedup.mockRestore();
    });
  });
});
