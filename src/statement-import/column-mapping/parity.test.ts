// Dedup parity setup (a real re-import). Mirrors
// `import-statement.test.ts`'s own in-memory fake-transaction-handle pattern:
// the real `write`/`@kiko/holdings/repo` are blocked under Jest (op-sqlite's
// `open()`), so `write` is mocked to run its callback against a fake
// transaction handle that drives the REAL `transactionsRepo.addManyDedup`
// upsert logic — the real (source, external_id) dedup, without a live
// database.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

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
} from '@kiko/statement-import/formats/format-test-fixtures';
import { accounts, categoryOverrides, holdings, transactions } from '@kiko/db';
import { monobankCsvFormat } from '@kiko/statement-import/formats/monobank-csv';
import { sensebankCsvFormat } from '@kiko/statement-import/formats/sensebank-csv';
import { privatbankXlsxFormat } from '@kiko/statement-import/formats/privatbank-xlsx';
import { procreditBusinessCsvFormat } from '@kiko/statement-import/formats/procredit-business-csv';

import { importParsedStatement } from '../import-statement';
import type { ParsedTransaction, StatementFormatInput } from '../parser';

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

/** The 3 fields column mapping and a dedicated format still ALWAYS agree
 * on — `timeSeconds` no longer belongs here: a named format reads its wall
 * clock as Europe/Kyiv, column mapping as this DEVICE's own local time, so
 * the two only agree on the time field when the device happens to be in the
 * Kyiv zone. Each describe block below asserts the time field on its own,
 * per path, instead. */
const pick = (databaseTransaction: ParsedTransaction) => ({
  currency: databaseTransaction.currency,
  amountMinorUnits: databaseTransaction.amountMinorUnits,
  description: databaseTransaction.description,
});

const DD_MM_YYYY_HH_MM_SS = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;
const DD_MM_YY_HH_MM = /^(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})$/;

/** Builds the expected device-local instant for every row `applyColumnMapping`
 * actually kept as a transaction — an independent oracle, through the local
 * `Date` constructor directly (never `parseDateWithFormat` itself), so this
 * test passes under any process time zone. `rowErrors` (the SAME result
 * `applyColumnMapping` already returned) is what tells this which file rows
 * were dropped — a row can be excluded for a reason that has nothing to do
 * with its date cell (PrivatBank's own unresolved-currency rows, for
 * instance), so re-deriving "kept vs. dropped" from the date pattern alone
 * would disagree with the real output. */
const deviceSecondsForMappedRows = (
  rows: { [index: number]: unknown }[],
  mapping: ColumnMapping,
  rowErrors: { rowNumber: number }[],
  pattern: RegExp,
  toYearMonthDay: (match: RegExpExecArray) => [number, number, number],
  toHourMinuteSecond: (match: RegExpExecArray) => [number, number, number],
): number[] => {
  const droppedFileRowIndices = new Set(rowErrors.map((rowError) => rowError.rowNumber - 1));

  return rows
    .map((row, fileRowIndex) => ({ row, fileRowIndex }))
    .filter(
      ({ fileRowIndex }) =>
        fileRowIndex > mapping.headerRowIndex && !droppedFileRowIndices.has(fileRowIndex),
    )
    .map(({ row }) => pattern.exec(String(row[mapping.dateColumn]).trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const [year, month, day] = toYearMonthDay(match);
      const [hour, minute, second] = toHourMinuteSecond(match);
      const isDateOnly = hour === 0 && minute === 0 && second === 0;

      return isDateOnly
        ? new Date(year, month - 1, day, 12, 0, 0).getTime() / 1000
        : new Date(year, month - 1, day, hour, minute, second).getTime() / 1000;
    });
};

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

  it('maps every row to the same (currency, amountMinorUnits, description) as monobankCsvFormat', () => {
    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = monobankCsvFormat.parse(monobankFixtureInput);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });

  it('maps every row’s time as THIS DEVICE’s own local reading of the same wall clock', () => {
    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);

    const expectedSeconds = deviceSecondsForMappedRows(
      rows,
      mapping,
      rowErrors,
      DD_MM_YYYY_HH_MM_SS,
      (match) => [Number(match[3]), Number(match[2]), Number(match[1])],
      (match) => [Number(match[4]), Number(match[5]), Number(match[6])],
    );

    expect(
      statement.transactions.map((databaseTransaction) => databaseTransaction.timeSeconds),
    ).toEqual(expectedSeconds);
  });

  // `computeDedupKey` folds in `timeSeconds`, so the mapped and dedicated
  // keys are equal only when the device happens to be in the Kyiv zone —
  // see `kiko-statement-import`'s own note on this. A re-import through
  // column mapping of a file ALREADY imported through column mapping stays
  // a guaranteed, zone-independent dedup, since both runs read the same
  // wall clock through the same (device) path.
  it('imports 0 new rows when the SAME mapped file is re-imported through column mapping again (real dedup)', async () => {
    const store: { transactions: StoredRow[] } = { transactions: [] };
    mockDatabaseTransaction = makeFakeDatabaseTransaction(store);

    const { rows } = readTableRows(monobankFixtureInput, ',');
    const { statement } = applyColumnMapping(rows, mapping);

    const first = await importParsedStatement(statement, 'holding-1');
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

  it('maps every row to the same (currency, amountMinorUnits, description) as sensebankCsvFormat, with exactly 2 date row errors', () => {
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

  it('maps every row’s time as THIS DEVICE’s own local reading of the same wall clock', () => {
    const { rows } = readTableRows(sensebankFixtureInput, ';');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);

    const expectedSeconds = deviceSecondsForMappedRows(
      rows,
      mapping,
      rowErrors,
      DD_MM_YY_HH_MM,
      (match) => [2000 + Number(match[3]), Number(match[2]), Number(match[1])],
      (match) => [Number(match[4]), Number(match[5]), 0],
    );

    expect(
      statement.transactions.map((databaseTransaction) => databaseTransaction.timeSeconds),
    ).toEqual(expectedSeconds);
  });

  // Sensebank's own amounts are comma-decimal ("1 250,00"); a user who never
  // touches the decimal-separator chip stays on the screen's dot default
  // (`column-mapping.screen.tsx`). Every genuine amount cell must then fail
  // as a row error rather than land 100x too large in the ledger.
  it('with the dot default left untouched, every mapped amount is either a row error or the correct value — never 100x', () => {
    const { rows } = readTableRows(sensebankFixtureInput, ';');
    const dedicated = sensebankCsvFormat.parse(sensebankFixtureInput);
    const { statement, rowErrors } = applyColumnMapping(rows, {
      ...mapping,
      decimalSeparator: '.',
    });

    // Every one of Sensebank's own 6 rows carries a 2-decimal amount, which
    // never lands in a real thousands-group position under the wrong dot
    // default — so all 6 become 'amount' row errors (on top of the 2 date
    // errors every mapping of this fixture already has), and NONE come
    // through as a mapped transaction at all, let alone a 100x-too-large one.
    expect(rowErrors).toHaveLength(dedicated.transactions.length + 2);
    expect(
      rowErrors.every((rowError) => rowError.reason === 'date' || rowError.reason === 'amount'),
    ).toBe(true);
    expect(statement.transactions).toEqual([]);
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

  it('maps every row to the same (currency, amountMinorUnits, description) as privatbankXlsxFormat, with the row-error count equal to unresolvedRows.length', async () => {
    const input = await readFixtureInput();
    const { rows } = readTableRows(input);
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = privatbankXlsxFormat.parse(input);

    expect(rowErrors).toHaveLength(dedicated.unresolvedRows?.length ?? 0);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });

  it('maps every row’s time as THIS DEVICE’s own local reading of the same wall clock', async () => {
    const input = await readFixtureInput();
    const { rows } = readTableRows(input);
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);

    const expectedSeconds = deviceSecondsForMappedRows(
      rows,
      mapping,
      rowErrors,
      DD_MM_YYYY_HH_MM_SS,
      (match) => [Number(match[3]), Number(match[2]), Number(match[1])],
      (match) => [Number(match[4]), Number(match[5]), Number(match[6])],
    );

    expect(
      statement.transactions.map((databaseTransaction) => databaseTransaction.timeSeconds),
    ).toEqual(expectedSeconds);
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

  it('maps every row to the same (currency, amountMinorUnits, description) as procreditBusinessCsvFormat', () => {
    const { rows } = readTableRows(procreditBusinessFixtureInput, ';');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);
    const dedicated = procreditBusinessCsvFormat.parse(procreditBusinessFixtureInput);

    expect(rowErrors).toEqual([]);
    expect(statement.transactions.map(pick)).toEqual(dedicated.transactions.map(pick));
  });

  it('maps every row’s time as THIS DEVICE’s own local reading of the same wall clock', () => {
    const { rows } = readTableRows(procreditBusinessFixtureInput, ';');
    const { statement, rowErrors } = applyColumnMapping(rows, mapping);

    const expectedSeconds = deviceSecondsForMappedRows(
      rows,
      mapping,
      rowErrors,
      DD_MM_YYYY_HH_MM_SS,
      (match) => [Number(match[3]), Number(match[2]), Number(match[1])],
      (match) => [Number(match[4]), Number(match[5]), Number(match[6])],
    );

    expect(
      statement.transactions.map((databaseTransaction) => databaseTransaction.timeSeconds),
    ).toEqual(expectedSeconds);
  });
});
