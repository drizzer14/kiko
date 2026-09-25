// Dedup parity setup (a real re-import). Mirrors
// `import-statement.test.ts`'s own in-memory fake-transaction-handle pattern:
// the real `write`/`@kiko/holdings/repo` are blocked under Jest (op-sqlite's
// `open()`), so `write` is mocked to run its callback against a fake
// transaction handle that drives the REAL `transactionsRepo.addManyDedup`
// upsert logic — the real (source, external_id) dedup, without a live
// database.
let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

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

import {
  monobankFixtureInput,
  sensebankFixtureInput,
  procreditBusinessFixtureInput,
} from '../formats/format-test-fixtures';
import { computeDedupKey } from '../mapping';
import { monobankCsvFormat } from '../formats/monobank-csv';
import { sensebankCsvFormat } from '../formats/sensebank-csv';
import { privatbankXlsxFormat } from '../formats/privatbank-xlsx';
import type { ParsedTransaction, StatementFormatInput } from '../parser';
import { importParsedStatement, importStatement } from '../import-statement';
import { procreditBusinessCsvFormat } from '../formats/procredit-business-csv';
import { accounts, categoryOverrides, holdings, transactions } from '../../db/schema';

import { readTableRows } from './table-rows';
import { applyColumnMapping } from './apply-column-mapping';
import type { ColumnMapping } from './apply-column-mapping';

/** A row as `importRows`'s upsert sees it — same minimal shape
 * `import-statement.test.ts` uses for its own fake transaction handle, plus
 * its own `time` (the fake's sync-boundary aggregate reads this back). */
type StoredRow = { id: string; source: string; externalId: string | null; time: number } & Record<
  string,
  unknown
>;

const findConflict = (store: StoredRow[], row: Record<string, unknown>): StoredRow | undefined => {
  const externalId = (row.externalId as string | null) ?? null;

  return externalId
    ? store.find(
        (candidate) => candidate.source === row.source && candidate.externalId === externalId,
      )
    : undefined;
};

/** Refresh an existing row's bank-owned columns, or push a freshly-inserted
 * one — the same insert-or-refresh split the real upsert performs per row
 * (`import-statement.test.ts`'s own `applyUpsertRow`). */
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

const fakeHolding = { id: 'holding-1', currency: 'UAH', balanceMinorUnits: 0, balanceSetAt: null };
const fakeAccount = { institution: null };

/** The rows one fake `select(fields).from(table).where(...)` resolves to,
 * dispatched by table identity — mirrors `import-statement.test.ts`'s own
 * `resolveImportSelect`. */
const resolveParitySelect = (
  store: { transactions: StoredRow[] },
  table: unknown,
  fields: Record<string, unknown> | undefined,
): unknown[] => {
  if (table === categoryOverrides) {
    return [];
  }

  if (table === holdings) {
    return [fakeHolding];
  }

  if (table === accounts) {
    return [fakeAccount];
  }

  if (table === transactions && fields && 'time' in fields) {
    const syncTimes = store.transactions
      .filter((row) => row.source !== 'manual' && row.source !== 'import')
      .map((row) => row.time);

    return syncTimes.length > 0 ? [{ time: Math.max(...syncTimes) }] : [{ time: null }];
  }

  return store.transactions.map((row) => ({ source: row.source, externalId: row.externalId }));
};

/** A minimal in-memory fake for the write-transaction handle
 * `transactionsRepo.importRows` runs against — see `import-statement.test.ts`'s
 * own (more elaborate) `makeImportDatabaseTransaction` for the full shape this mirrors;
 * deliberately NOT shared with that file (same reasoning as
 * `transactions.repo.test.ts`'s `makeImportRowsDatabaseTransaction` doc comment): this suite
 * only needs a single fixed holding/account pair, never a per-test override. */
const makeFakeDatabaseTransaction = (store: { transactions: StoredRow[] }) => {
  let sequence = 0;
  const nextId = (): string => `row-${++sequence}`;
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveParitySelect(store, table, fields)),
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
    update: (table: unknown) => ({
      set: () => ({ where: () => (table === holdings ? Promise.resolve() : undefined) }),
    }),
  };
};

/** The 4 fields dedup/parity actually cares about — same field set Review
 * Focus 2 names. */
const pick = (databaseTransaction: ParsedTransaction) => ({
  currency: databaseTransaction.currency,
  amountMinorUnits: databaseTransaction.amountMinorUnits,
  timeSeconds: databaseTransaction.timeSeconds,
  description: databaseTransaction.description,
});

beforeEach(() => {
  mockHoldingRows = [{ id: 'holding-1', currency: 'UAH' }];
});

describe('column-mapping parity (Monobank CSV)', () => {
  // Monobank CSV: ',' delimiter, header row 0, date col 0 'DD.MM.YYYY
  // HH:MM:SS', amount col 3 single, '.', description col 1, fixed UAH.
  const mapping: ColumnMapping = {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 3 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
  };

  it('maps every row to the same (currency, amountMinorUnits, timeSeconds, description) as monobankCsvFormat', () => {
    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = monobankCsvFormat.parse(monobankFixtureInput);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });

  it('computeDedupKey gives equal keys for the mapped and dedicated results', () => {
    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement } = applyColumnMapping(rows, mapping);
    const dedicated = monobankCsvFormat.parse(monobankFixtureInput);

    const mappedKeys = statement.transactions.map((databaseTransaction) =>
      computeDedupKey('holding-1', databaseTransaction, 0),
    );
    const dedicatedKeys = dedicated.transactions.map((databaseTransaction) =>
      computeDedupKey('holding-1', databaseTransaction, 0),
    );

    expect(mappedKeys).toEqual(dedicatedKeys);
  });

  it('imports 0 new rows when the mapped result is re-imported after the dedicated import (real dedup)', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeFakeDatabaseTransaction(store);

    const first = await importStatement(monobankFixtureInput, 'holding-1');

    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement } = applyColumnMapping(rows, mapping);
    const second = await importParsedStatement(statement, 'holding-1');

    expect(first.imported).toBeGreaterThan(0);
    expect(second.imported).toBe(0);
    expect(second.total).toBe(first.imported);
  });
});

describe('column-mapping parity (Sensebank CSV)', () => {
  // Sensebank CSV (cp1251): ';', header row 5, date col 0 'DD.MM.YY HH:MM',
  // debit col 6 / credit col 7, ',', description col 3, fixed UAH.
  const mapping: ColumnMapping = {
    headerRowIndex: 5,
    decimalSeparator: ',',
    dateColumn: 0,
    dateFormat: 'DD.MM.YY HH:MM',
    amount: { mode: 'debitCredit', debitColumn: 6, creditColumn: 7 },
    descriptionColumn: 3,
    currency: { mode: 'fixed', currency: 'UAH' },
  };

  it('maps every row to the same (currency, amountMinorUnits, timeSeconds, description) as sensebankCsvFormat, with exactly 2 date row errors', () => {
    const { rows } = readTableRows(sensebankFixtureInput, ';');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = sensebankCsvFormat.parse(sensebankFixtureInput);

    // The 2 non-data lines a generic column mapping has no way to recognize
    // structurally: the second block's own section-marker line and its
    // repeated header row — both fail to parse as a date under this mapping.
    expect(rowErrors).toEqual([
      expect.objectContaining({ reason: 'date' }),
      expect.objectContaining({ reason: 'date' }),
    ]);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });
});

describe('column-mapping parity (PrivatBank XLSX)', () => {
  const FIXTURE_PATH = path.join(
    __dirname,
    '../formats/privatbank-xlsx/__fixtures__/synthetic-privatbank-sample.xlsx',
  );

  const readFixtureInput = async (): Promise<StatementFormatInput> => {
    const buffer = readFileSync(FIXTURE_PATH);
    const sheets = await readXlsxFile(buffer);

    return {
      text: '',
      fileName: 'synthetic-privatbank-sample.xlsx',
      sheetRows: sheets[0].data as StatementFormatInput['sheetRows'],
    };
  };

  // PrivatBank XLSX: header row 1, date col 0, amount col 4 single, currency
  // column col 5 (words), description col 3.
  const mapping: ColumnMapping = {
    headerRowIndex: 1,
    decimalSeparator: ',',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 4 },
    descriptionColumn: 3,
    currency: { mode: 'column', column: 5 },
  };

  it('maps every row to the same (currency, amountMinorUnits, timeSeconds, description) as privatbankXlsxFormat, with the row-error count equal to unresolvedRows.length', async () => {
    const input = await readFixtureInput();
    const { rows } = readTableRows(input);
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = privatbankXlsxFormat.parse(input);

    expect(rowErrors).toHaveLength(dedicated.unresolvedRows?.length ?? 0);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });
});

describe('column-mapping parity (ProCredit business CSV)', () => {
  // ProCredit business CSV (cp1251): ';', header row 0, date col 4, debit
  // col 13 / credit col 14, '.', currency column col 3, description col 15.
  const mapping: ColumnMapping = {
    headerRowIndex: 0,
    decimalSeparator: '.',
    dateColumn: 4,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'debitCredit', debitColumn: 13, creditColumn: 14 },
    descriptionColumn: 15,
    currency: { mode: 'column', column: 3 },
  };

  it('maps every row to the same (currency, amountMinorUnits, timeSeconds, description) as procreditBusinessCsvFormat', () => {
    const { rows } = readTableRows(procreditBusinessFixtureInput, ';');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = procreditBusinessCsvFormat.parse(procreditBusinessFixtureInput);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });
});
