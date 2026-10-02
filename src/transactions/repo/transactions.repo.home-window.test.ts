// Home's 30-day view reads a windowed ledger, the ledger's span and its distinct
// categories instead of every row. Only a real engine shows that the SQL window
// is the very predicate the screen's own filter applies in JavaScript, that
// same-time rows keep their order, and that the aggregates equal what the whole
// ledger holds.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { transactionSpan } from '@kiko/transactions/transaction-span';
import { DAY_MS, defaultDateRange, endOfLocalDay, startOfLocalDay } from '@kiko/dates';

import { transactionsRepo } from './transactions.repo';

const NOW = new Date(2026, 8, 20, 15, 0).getTime();
const CATEGORIES = ['food', 'Groceries', 'groceries', null, '', 'transport', 'Taxi', 'other'];

const insertTransaction = (
  id: string,
  holdingId: string,
  time: number,
  category: string | null,
): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category, source)
       VALUES (?, ?, -100, ?, ?, ?, 'manual')`,
    )
    .run(id, holdingId, time, `row ${id}`, category);
};

// A ledger the way one accumulates: rows spread over 400 days, two holdings
// under two accounts, several rows sharing one exact time (a statement's
// date-only cells), and rows placed exactly on, just inside and just outside
// the default window's edges.
const seedLedger = (): void => {
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('a-1', 'Monobank', 'bank'), ('a-2', 'Cash', 'cash');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES
      ('h-1', 'a-1', 'Card', 'card', 'UAH'), ('h-2', 'a-2', 'Wallet', 'cash', 'UAH');
  `);

  const { from, to } = defaultDateRange(NOW);
  const windowStart = startOfLocalDay(from.getTime());
  const windowEnd = endOfLocalDay(to.getTime());

  for (let index = 0; index < 1_500; index += 1) {
    const time = NOW - Math.floor(((index * 7919) % 400_000) * (DAY_MS / 1_000));

    insertTransaction(
      `t-${index}`,
      index % 3 === 0 ? 'h-2' : 'h-1',
      time,
      CATEGORIES[index % CATEGORIES.length],
    );
  }

  const noon = new Date(2026, 8, 10, 12, 0).getTime();

  for (let index = 0; index < 6; index += 1) {
    insertTransaction(`same-${index}`, index % 2 === 0 ? 'h-1' : 'h-2', noon, 'food');
  }

  insertTransaction('edge-before', 'h-1', windowStart - 1, 'edge');
  insertTransaction('edge-start', 'h-1', windowStart, 'edge');
  insertTransaction('edge-end', 'h-1', windowEnd, 'edge');
  insertTransaction('edge-after', 'h-1', windowEnd + 1, 'edge');
};

const idsOf = (rows: { id: string }[]): string[] => rows.map((row) => row.id);

// The whole ledger: the windowed query with no bounds, so it has no WHERE
// clause and is the reference every window must match.
const fullLedger = () => transactionsRepo.listWithContextBetweenQuery(undefined, undefined);

type Range = { from?: number; to?: number };

// The (inclusive) bounds the screen resolves from a picked date range; a null
// side stays open-ended.
const bounds = (from: Date | null, to: Date | null): Range => ({
  from: foldMap(maybe(from), (date) => startOfLocalDay(date.getTime())),
  to: foldMap(maybe(to), (date) => endOfLocalDay(date.getTime())),
});

describe('the windowed ledger Home reads', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
    seedLedger();
  });

  // The range filter `home.screen.tsx` still applies in JavaScript, which the
  // SQL window has to agree with row for row.
  const filteredInJavaScript = async (range: Range) =>
    (await fullLedger()).filter(
      (row) =>
        (range.from === undefined || row.time >= range.from) &&
        (range.to === undefined || row.time <= range.to),
    );

  const RANGES: [string, Range][] = [
    ['the default last 30 days', bounds(defaultDateRange(NOW).from, defaultDateRange(NOW).to)],
    ['a past month', bounds(new Date(2026, 4, 1), new Date(2026, 4, 31))],
    ['one day', bounds(new Date(2026, 8, 10), new Date(2026, 8, 10))],
    ['open-ended to the past', bounds(null, new Date(2026, 5, 15))],
    ['open-ended to the future', bounds(new Date(2026, 5, 15), null)],
    ['no bound at all', bounds(null, null)],
    ['the Kyiv DST start day', bounds(new Date(2026, 2, 29), new Date(2026, 2, 29))],
    ['the Kyiv DST end day', bounds(new Date(2026, 9, 25), new Date(2026, 9, 25))],
    ['a range after every row', bounds(new Date(2027, 0, 1), new Date(2027, 0, 31))],
  ];

  it.each(RANGES)(
    'returns the same rows in the same order as the full list, filtered: %s',
    async (_label, range) => {
      const expected = await filteredInJavaScript(range);
      const windowed = await transactionsRepo.listWithContextBetweenQuery(range.from, range.to);

      expect(windowed).toEqual(expected);
    },
  );

  it('keeps the order of rows that share one exact time', async () => {
    const range = bounds(new Date(2026, 8, 10), new Date(2026, 8, 10));
    const windowed = await transactionsRepo.listWithContextBetweenQuery(range.from, range.to);
    const sameTime = idsOf(windowed).filter((id) => id.startsWith('same-'));
    const expected = idsOf(await filteredInJavaScript(range)).filter((id) =>
      id.startsWith('same-'),
    );

    expect(sameTime).toHaveLength(6);
    expect(sameTime).toEqual(expected);
  });

  it('includes a row exactly on each edge of the window and none just outside it', async () => {
    const { from, to } = defaultDateRange(NOW);
    const range = bounds(from, to);
    const ids = idsOf(await transactionsRepo.listWithContextBetweenQuery(range.from, range.to));

    expect(ids).toEqual(expect.arrayContaining(['edge-start', 'edge-end']));
    expect(ids).not.toContain('edge-before');
    expect(ids).not.toContain('edge-after');
  });

  it('searches the transactions time index for the window, never scanning the ledger', () => {
    const { from, to } = defaultDateRange(NOW);
    const range = bounds(from, to);
    const { sql, params } = transactionsRepo
      .listWithContextBetweenQuery(range.from, range.to)
      .toSQL();
    const plan = mockDatabase
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...(params as (string | number)[])) as { detail: string }[];

    expect(plan.map((step) => step.detail)).toContainEqual(
      expect.stringContaining('SEARCH transactions USING INDEX transactions_time'),
    );
  });

  it('reads a fraction of the ledger for the default window', async () => {
    const { from, to } = defaultDateRange(NOW);
    const range = bounds(from, to);

    expect((await fullLedger()).length).toBeGreaterThan(1_500);
    expect(
      (await transactionsRepo.listWithContextBetweenQuery(range.from, range.to)).length,
    ).toBeLessThan(250);
  });
});

describe('the ledger span and categories Home reads', () => {
  beforeEach(() => {
    mockDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockDatabase);
  });

  it('finds the earliest and latest time of the same rows the full list holds', async () => {
    seedLedger();

    const all = await fullLedger();
    const [summary] = await transactionsRepo.contextSpanQuery();
    const span = transactionSpan(
      all.map((row) => row.time),
      0,
    );

    expect(summary).toEqual({ earliest: span.start, latest: span.end });
  });

  it('reports an empty ledger as no rows', async () => {
    const [summary] = await transactionsRepo.contextSpanQuery();

    expect(summary).toEqual({ earliest: null, latest: null });
    await expect(transactionsRepo.contextCategoriesQuery()).resolves.toEqual([]);
  });

  it('lists each stored category once, in the order the newest-first full list first meets it', async () => {
    seedLedger();

    const all = await fullLedger();
    const firstSeen = [...new Set(all.map((row) => row.category))];
    const categories = await transactionsRepo.contextCategoriesQuery();

    expect(categories.map((row) => row.category)).toEqual(firstSeen);
  });
});
