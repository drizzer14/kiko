// `recordManual` runs its insert + balance read + balance update through
// the `write` helper (one op-sqlite transaction). Override `write` to run
// the callback against a fake transaction handle so the test can capture
// what was inserted and what balance was written, proving the read-modify-
// write of the balance happens inside the same unit and uses the DB-read
// base (5000) + amount, not a caller-supplied snapshot.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import { categoryOverrides, holdings, transactions } from '../db/schema';

import { transactionsRepo } from './transactions.repo';

// Build a fake transaction handle for `update`. `select(...).from(...).where
// (...).limit(...)` resolves the queued rows in call order (first the existing
// transaction row, then the holding balance); each `update(table).set(values)`
// is captured keyed by the schema table object it targeted, so a test can prove
// exactly what was written to `transactions` vs to `holdings`.
const makeUpdateTx = (opts: {
  existing: Record<string, unknown> | null;
  holdingBalance: number;
}): {
  tx: unknown;
  captured: {
    transactionSet?: Record<string, unknown>;
    holdingSet?: Record<string, unknown>;
  };
} => {
  const selectQueue: unknown[][] = [
    opts.existing ? [opts.existing] : [],
    [{ balanceMinorUnits: opts.holdingBalance }],
  ];
  const captured: {
    transactionSet?: Record<string, unknown>;
    holdingSet?: Record<string, unknown>;
  } = {};
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.transactionSet = values;
        } else if (table === holdings) {
          captured.holdingSet = values;
        }

        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  };

  return { tx, captured };
};

describe('transactionsRepo', () => {
  it('builds a query filtered by holding id', () => {
    const { sql, params } = transactionsRepo.listByHoldingQuery('hold-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('hold-1');
  });

  it('builds a single-row query filtered by transaction id', () => {
    const { sql, params } = transactionsRepo.getByIdQuery('txn-1').toSQL();
    expect(sql).toContain('transactions');
    expect(params).toContain('txn-1');
  });

  it('exposes a joined all-transactions query with account and holding labels', () => {
    const query = transactionsRepo.listAllWithContextQuery();
    const sql = query.toSQL().sql.toLowerCase();
    expect(sql).toContain('from "transactions"');
    expect(sql).toContain('join "holdings"');
    expect(sql).toContain('join "accounts"');
    expect(sql).toContain('order by');
    // Home reads the holding type to decide whether a row shows its HH:MM time
    // (a term_deposit/bond row does not), so the type must ride the projection.
    expect(sql).toContain('"holdings"."type"');
  });

  it('records a manual transaction and adjusts the balance atomically', async () => {
    const captured: { insert?: Record<string, unknown>; set?: Record<string, unknown> } = {};
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.insert = values;
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5000 }]) }),
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          captured.set = values;
          return { where: () => Promise.resolve() };
        },
      }),
    };

    await transactionsRepo.recordManual({
      holdingId: 'hold-1',
      amountMinorUnits: -1000,
      time: 42,
      description: 'Coffee',
    });

    expect(captured.insert).toMatchObject({
      holdingId: 'hold-1',
      amountMinorUnits: -1000,
      time: 42,
      description: 'Coffee',
      source: 'manual',
    });
    // base read inside the tx (5000) + amount (-1000)
    expect(captured.set).toEqual({ balanceMinorUnits: 4000 });
  });

  it('persists the picked category on a manual row, even with a blank description', async () => {
    const captured: { insert?: Record<string, unknown> } = {};
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.insert = values;
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5000 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await transactionsRepo.recordManual({
      holdingId: 'hold-1',
      amountMinorUnits: -1234,
      time: 1_700_000_000_000,
      description: '',
      category: 'groceries',
    });

    expect(captured.insert).toMatchObject({ category: 'groceries', description: '' });
  });

  it('writes a null category when none is given', async () => {
    const captured: { insert?: Record<string, unknown> } = {};
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          captured.insert = values;
          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5000 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await transactionsRepo.recordManual({
      holdingId: 'hold-1',
      amountMinorUnits: -1234,
      time: 1_700_000_000_000,
    });

    expect(captured.insert).toMatchObject({ category: null });
  });

  it('updates a manual transaction and moves the balance by the amount delta when it grows', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 3000,
      time: 42,
      description: 'Raise',
    });

    expect(captured.transactionSet).toMatchObject({
      amountMinorUnits: 3000,
      time: 42,
      description: 'Raise',
    });
    // delta = 3000 - 1000 = +2000; base 5000 -> 7000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 7000 });
  });

  it('updates a manual transaction and moves the balance by the amount delta when it shrinks', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 3000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 1000,
      time: 42,
      description: 'Cut',
    });

    // delta = 1000 - 3000 = -2000; base 5000 -> 3000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 3000 });
  });

  it('leaves the balance untouched when only the description changes (amount unchanged)', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'manual' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 1000,
      time: 99,
      description: 'Renamed',
    });

    // The transaction row still updates its description/time...
    expect(captured.transactionSet).toMatchObject({ description: 'Renamed', time: 99 });
    // ...but a zero delta never touches the holding balance.
    expect(captured.holdingSet).toBeUndefined();
  });

  it('never updates a synced (monobank) transaction and never moves the balance', async () => {
    const { tx, captured } = makeUpdateTx({
      existing: { holdingId: 'hold-1', amountMinorUnits: 1000, source: 'monobank' },
      holdingBalance: 5000,
    });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'txn-1',
      amountMinorUnits: 9999,
      time: 42,
      description: 'Tampered',
    });

    expect(captured.transactionSet).toBeUndefined();
    expect(captured.holdingSet).toBeUndefined();
  });

  it('does nothing when the target transaction does not exist', async () => {
    const { tx, captured } = makeUpdateTx({ existing: null, holdingBalance: 5000 });
    mockTx = tx;

    await transactionsRepo.update({
      transactionId: 'missing',
      amountMinorUnits: 1000,
      time: 42,
      description: 'Ghost',
    });

    expect(captured.transactionSet).toBeUndefined();
    expect(captured.holdingSet).toBeUndefined();
  });
});

// Build a fake transaction handle for `remove`. `select(...).from(...).where(...)`
// resolves queued rows in call order (first the transaction row, then the holding
// row); each `delete(table)` records the table it targeted (so a test can prove
// the transaction row was deleted) and each `update(holdings).set(values)` captures
// the reversed balance written back.
const makeRemoveTx = (opts: {
  transaction: Record<string, unknown> | null;
  holding: Record<string, unknown> | null;
}): {
  tx: unknown;
  captured: { deletedFrom: unknown[]; holdingSet?: Record<string, unknown> };
} => {
  const selectQueue: unknown[][] = [
    opts.transaction ? [opts.transaction] : [],
    opts.holding ? [opts.holding] : [],
  ];
  const captured: { deletedFrom: unknown[]; holdingSet?: Record<string, unknown> } = {
    deletedFrom: [],
  };
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(selectQueue.shift() ?? []) }),
    }),
    delete: (table: unknown) => {
      captured.deletedFrom.push(table);
      return { where: () => Promise.resolve() };
    },
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

// Fake tx for addManyDedup: two reads (the name→category rules, and the rows
// that already hold an incoming external id) and one upsert. Each select
// dispatches on the table it reads rather than on call order, because the rule
// lookup is skipped entirely when no input carries a description. Both the
// inserted values and the on-conflict config are captured.
const makeAddManyTx = (
  rules: { normalizedName: string; category: string }[],
  existing: { source: string; externalId: string }[] = [],
): {
  tx: unknown;
  captured: {
    inserted?: Record<string, unknown>[];
    conflict?: { target: unknown; set: Record<string, unknown> };
  };
} => {
  const captured: {
    inserted?: Record<string, unknown>[];
    conflict?: { target: unknown; set: Record<string, unknown> };
  } = {};
  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => Promise.resolve(table === categoryOverrides ? rules : existing),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>[]) => {
        if (table !== categoryOverrides) {
          captured.inserted = values;
        }

        return {
          onConflictDoUpdate: (config: { target: unknown; set: Record<string, unknown> }) => {
            captured.conflict = config;

            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { tx, captured };
};

describe('transactionsRepo.addManyDedup category overrides', () => {
  it('applies a matching rule to an incoming synced row at insert time', async () => {
    const { tx, captured } = makeAddManyTx([
      { normalizedName: 'atb market', category: 'groceries' },
    ]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h1',
        amountMinorUnits: -500,
        time: 1,
        source: 'monobank',
        description: 'ATB Market',
        category: 'other',
        externalId: 'e1',
      },
      {
        holdingId: 'h1',
        amountMinorUnits: -700,
        time: 2,
        source: 'monobank',
        description: 'Coffee',
        category: 'dining',
        externalId: 'e2',
      },
    ]);

    const inserted = captured.inserted ?? [];
    expect(inserted[0]).toMatchObject({ description: 'ATB Market', category: 'groceries' });
    // no rule for Coffee — its mapped category is left untouched
    expect(inserted[1]).toMatchObject({ description: 'Coffee', category: 'dining' });
  });

  it('matches a Cyrillic case-variant name against its rule', async () => {
    const { tx, captured } = makeAddManyTx([{ normalizedName: 'атб', category: 'groceries' }]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h1',
        amountMinorUnits: -500,
        time: 1,
        source: 'monobank',
        description: 'АТБ',
        category: 'other',
        externalId: 'e1',
      },
    ]);

    const inserted = captured.inserted ?? [];
    expect(inserted[0]).toMatchObject({ description: 'АТБ', category: 'groceries' });
  });

  it('skips empty-description rows and inserts nothing when the input is empty', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([]);
    expect(captured.inserted).toBeUndefined();
  });
});

const syncedRow = (overrides: Record<string, unknown> = {}) => ({
  holdingId: 'h1',
  amountMinorUnits: -10_000,
  time: 1,
  source: 'monobank' as const,
  description: 'Cafe',
  category: 'dining',
  mcc: 5812,
  hold: true,
  externalId: 'e1',
  ...overrides,
});

// A re-fetched Monobank item must REFRESH the row it already wrote — a
// `hold: true` authorization imports at a provisional amount and re-syncs at
// its settled one — while every column the USER owns survives untouched.
describe('transactionsRepo.addManyDedup upsert', () => {
  it('refreshes exactly the bank-owned columns on a (source, external id) conflict', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([syncedRow()]);

    expect(captured.conflict?.target).toEqual([transactions.source, transactions.externalId]);
    // `category` (the user's override, or a name rule's rewrite) and `comment`
    // (the user's note) are absent by design, as is every structural column.
    expect(Object.keys(captured.conflict?.set ?? {})).toEqual([
      'amountMinorUnits',
      'description',
      'hold',
      'mcc',
      'counterIban',
      'time',
    ]);
  });

  it('emits an upsert that copies the excluded row into the bank-owned columns only', async () => {
    const statements: string[] = [];
    // The real Drizzle SQLite dialect, driven through the proxy driver, so this
    // asserts over the SQL that actually ships rather than over a fake's
    // arguments.
    mockTx = drizzle(async (query: string) => {
      statements.push(query);

      return { rows: [] };
    });

    await transactionsRepo.addManyDedup([syncedRow()]);

    const upsert = statements.find((statement) => statement.startsWith('insert')) ?? '';

    // Drizzle qualifies the conflict target; SQLite still matches it to the
    // `transactions_source_external` unique index (verified against 3.51, the
    // version op-sqlite bundles).
    expect(upsert).toContain(
      'on conflict ("transactions"."source", "transactions"."external_id") do update set',
    );
    expect(upsert).toContain('"amount_minor_units" = excluded.amount_minor_units');
    expect(upsert).toContain('"hold" = excluded.hold');
    expect(upsert).not.toContain('"category" = excluded');
    expect(upsert).not.toContain('"comment" = excluded');
  });

  it('collapses a repeated statement id inside one batch, keeping the later item', async () => {
    // SQLite refuses to upsert the same conflict target twice in one statement,
    // so a payload that repeats an id (overlapping statement pages) is folded in
    // JS first — keeping the LAST copy, which is the more settled one.
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    const inserted = await transactionsRepo.addManyDedup([
      syncedRow({ amountMinorUnits: -10_000, hold: true }),
      syncedRow({ amountMinorUnits: -12_500, hold: false }),
    ]);

    expect(captured.inserted).toHaveLength(1);
    expect(captured.inserted?.[0]).toMatchObject({ amountMinorUnits: -12_500, hold: false });
    expect(inserted).toBe(1);
  });

  it('counts only the rows that were new, not the ones it refreshed', async () => {
    const { tx } = makeAddManyTx([], [{ source: 'monobank', externalId: 'e1' }]);
    mockTx = tx;

    const inserted = await transactionsRepo.addManyDedup([
      syncedRow({ externalId: 'e1' }),
      syncedRow({ externalId: 'e2' }),
    ]);

    expect(inserted).toBe(1);
  });

  it('never conflates two manual rows with a null external id', async () => {
    // SQLite treats every NULL as distinct in a unique index, so two manual rows
    // never conflict with each other — the JS fold must not collapse them either.
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    const inserted = await transactionsRepo.addManyDedup([
      { holdingId: 'h-1', amountMinorUnits: -100, time: 1, source: 'manual' },
      { holdingId: 'h-1', amountMinorUnits: -200, time: 2, source: 'manual' },
    ]);

    expect(captured.inserted).toHaveLength(2);
    expect(inserted).toBe(2);
  });
});

describe('transactionsRepo.remove', () => {
  it('deletes a manual transaction and reverses its balance effect', async () => {
    // Holding balance is 102500 after a +2500 manual top-up; removing the
    // transaction must reverse the effect, restoring 102500 - 2500 = 100000.
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: 2500,
        source: 'manual',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 102500 },
    });
    mockTx = tx;

    await transactionsRepo.remove('txn-1');

    expect(captured.deletedFrom).toContain(transactions);
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 100000 });
  });

  it('reverses a negative-amount transaction by adding the amount back', async () => {
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: -1000,
        source: 'manual',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 4000 },
    });
    mockTx = tx;

    await transactionsRepo.remove('txn-1');

    // balance - amount = 4000 - (-1000) = 5000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: 5000 });
  });

  it('refuses a synced (monobank) transaction and leaves it in place', async () => {
    const { tx, captured } = makeRemoveTx({
      transaction: {
        id: 'txn-1',
        holdingId: 'hold-1',
        amountMinorUnits: 2500,
        source: 'monobank',
      },
      holding: { id: 'hold-1', balanceMinorUnits: 102500 },
    });
    mockTx = tx;

    await expect(transactionsRepo.remove('txn-1')).rejects.toThrow(/synced/);
    expect(captured.deletedFrom).toEqual([]);
    expect(captured.holdingSet).toBeUndefined();
  });

  it('does nothing when the target transaction does not exist', async () => {
    const { tx, captured } = makeRemoveTx({ transaction: null, holding: null });
    mockTx = tx;

    await transactionsRepo.remove('missing');

    expect(captured.deletedFrom).toEqual([]);
    expect(captured.holdingSet).toBeUndefined();
  });
});

// A valid term_deposit metadata fixture, matching the shape `holdings.repo.test.ts`
// uses for `appendDepositContribution` — parseable by `asTermDepositMeta`.
const depositMeta = {
  contributions: [{ amountMinorUnits: 100_000, date: 1000 }],
  annualRatePct: 10,
  termMonths: 12,
  recapitalization: true,
  compounding: 'monthly',
};

// Build a fake tx for `recordExchange`. `select(...).from(...).where(...)`
// resolves the next queued row set in call order — the source balance read,
// then the destination read (a balance row for a plain leg, or the deposit
// row `appendDepositContributionTx` reads for a term_deposit leg). The
// returned object answers BOTH calling conventions the two paths use: a
// chained `.limit(1)` (as `recordManualTx` calls it) and a bare `await
// where(...)` with no `.limit()` (as `appendDepositContributionTx` calls
// it). Every insert value and every (table -> set) update is captured in
// call order, so a test can prove both legs landed independently.
const makeExchangeTx = (
  selectQueue: unknown[][],
): {
  tx: unknown;
  inserts: Record<string, unknown>[];
  updates: { table: unknown; values: Record<string, unknown> }[];
} => {
  const inserts: Record<string, unknown>[] = [];
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const queue = [...selectQueue];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = queue.shift() ?? [];
          // A real Promise, resolving `rows` directly (as
          // `appendDepositContributionTx` awaits `where(...)` with no
          // `.limit()`), with `.limit()` attached so `recordManualTx`'s
          // chained `.where(...).limit(1)` resolves the same rows.
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });
        },
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: () => Promise.resolve() };
      },
    }),
  };

  return { tx, inserts, updates };
};

describe('transactionsRepo.recordExchange', () => {
  it('writes both legs as independent ledger rows and updates both balances for a plain destination', async () => {
    const { tx, inserts, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 10_000 }],
      [{ balanceMinorUnits: 2_000 }],
    ]);
    mockTx = tx;

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'src-1',
      valueOutMinorUnits: 3_000,
      destinationHoldingId: 'dst-1',
      destinationType: 'card',
      valueInMinorUnits: 7_000,
      time: 123,
    });

    // Two ledger rows, tied STRUCTURALLY: each leg stores the OTHER leg's
    // holding id and persists NO description — the label is resolved at render
    // time from that marker (see transactions/exchange-description.ts).
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'src-1',
        amountMinorUnits: -3_000,
        time: 123,
        description: '',
        exchangeCounterpartHoldingId: 'dst-1',
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'dst-1',
        amountMinorUnits: 7_000,
        time: 123,
        description: '',
        exchangeCounterpartHoldingId: 'src-1',
        source: 'manual',
      }),
    ]);
    // base 10_000 - 3_000 = 7_000 (source); base 2_000 + 7_000 = 9_000 (destination)
    expect(updates).toEqual([
      { table: holdings, values: { balanceMinorUnits: 7_000 } },
      { table: holdings, values: { balanceMinorUnits: 9_000 } },
    ]);
  });

  it('routes a term_deposit destination through a contribution metadata rewrite, not a second ledger row', async () => {
    const { tx, inserts, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 10_000 }],
      [{ type: 'term_deposit', metadata: depositMeta }],
    ]);
    mockTx = tx;

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'src-1',
      valueOutMinorUnits: 3_000,
      destinationHoldingId: 'dep-1',
      destinationType: 'term_deposit',
      valueInMinorUnits: 5_000,
      time: 456,
    });

    // Only the source leg is a ledger insert — the deposit receive never
    // inserts a transaction row. That single leg still carries the marker, so
    // the spending chart drops it with no counterpart row to pair against.
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'src-1',
        amountMinorUnits: -3_000,
        time: 456,
        description: '',
        exchangeCounterpartHoldingId: 'dep-1',
        source: 'manual',
      }),
    ]);
    // Two updates: the source balance, then the deposit's rewritten metadata
    // — the new contribution inserted and the list re-sorted by date.
    expect(updates).toEqual([
      { table: holdings, values: { balanceMinorUnits: 7_000 } },
      {
        table: holdings,
        values: {
          metadata: {
            contributions: [
              { amountMinorUnits: 5_000, date: 456 },
              { amountMinorUnits: 100_000, date: 1000 },
            ],
            annualRatePct: 10,
            termMonths: 12,
            recapitalization: true,
            compounding: 'monthly',
          },
        },
      },
    ]);
  });

  it('rejects when the destination equals the source', async () => {
    mockTx = {};

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'same-1',
        valueOutMinorUnits: 100,
        destinationHoldingId: 'same-1',
        destinationType: 'cash',
        valueInMinorUnits: 100,
        time: 1,
      }),
    ).rejects.toThrow();
  });

  it('rejects an excluded destination type (bond/jar)', async () => {
    const { tx } = makeExchangeTx([[{ balanceMinorUnits: 10_000 }]]);
    mockTx = tx;

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'src-1',
        valueOutMinorUnits: 100,
        destinationHoldingId: 'dst-1',
        destinationType: 'bond',
        valueInMinorUnits: 100,
        time: 1,
      }),
    ).rejects.toThrow(/not a valid destination/);
  });

  it('rolls back both legs when the destination read fails mid-transaction', async () => {
    // The source leg's balance read (select call 1) resolves normally and its
    // insert/update land in the fake; the destination read (select call 2)
    // throws, so the rejection propagates out of `write` and op-sqlite rolls
    // back the whole transaction — including the source leg the fake already
    // recorded. The in-memory capture below only proves propagation, not a
    // partial commit.
    let selectCalls = 0;
    const updates: { table: unknown; values: Record<string, unknown> }[] = [];
    mockTx = {
      select: () => ({
        from: () => ({
          where: () => {
            selectCalls += 1;
            if (selectCalls === 2) {
              throw new Error('forced destination failure');
            }

            return { limit: () => Promise.resolve([{ balanceMinorUnits: 10_000 }]) };
          },
        }),
      }),
      insert: () => ({ values: () => Promise.resolve() }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });

          return { where: () => Promise.resolve() };
        },
      }),
    };

    await expect(
      transactionsRepo.recordExchange({
        sourceHoldingId: 'src-1',
        valueOutMinorUnits: 100,
        destinationHoldingId: 'dst-1',
        destinationType: 'card',
        valueInMinorUnits: 100,
        time: 1,
      }),
    ).rejects.toThrow('forced destination failure');
    expect(updates).toHaveLength(1);
  });
});

describe('transactionsRepo.recordExchangeCounterpart', () => {
  it('records a POSITIVE plain destination leg for an expense-sourced convert (record-destination)', async () => {
    const inserts: Record<string, unknown>[] = [];
    const updates: { table: unknown; values: Record<string, unknown> }[] = [];
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);

          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 2_000 }]) }),
        }),
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          updates.push({ table, values });

          return { where: () => Promise.resolve() };
        },
      }),
    };

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dst-1',
      counterpartType: 'cash',
      amountMinorUnits: 7_000,
      existingTransactionId: 'existing-tx-1',
      existingHoldingId: 'existing-1',
      time: 123,
    });

    // Exactly ONE new ledger row: a positive receipt marked with the EXISTING
    // leg's holding id and no persisted description — the label resolves at
    // render time (see transactions/exchange-description.ts).
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'dst-1',
        amountMinorUnits: 7_000,
        time: 123,
        description: '',
        exchangeCounterpartHoldingId: 'existing-1',
        source: 'manual',
      }),
    ]);
    expect(inserts).toHaveLength(1);
  });

  it('records a NEGATIVE plain source leg for an income-sourced convert (record-source)', async () => {
    const inserts: Record<string, unknown>[] = [];
    mockTx = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserts.push(values);

          return Promise.resolve();
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 5_000 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-source',
      counterpartHoldingId: 'src-1',
      counterpartType: 'card',
      amountMinorUnits: 3_000,
      existingTransactionId: 'existing-tx-1',
      existingHoldingId: 'existing-1',
      time: 456,
    });

    // A source leg is ALWAYS a plain NEGATIVE transaction, never a contribution
    // — and it carries the same structural marker as a destination leg.
    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'src-1',
        amountMinorUnits: -3_000,
        time: 456,
        description: '',
        exchangeCounterpartHoldingId: 'existing-1',
        source: 'manual',
      }),
    ]);
  });

  it("marks the EXISTING manual row with the new leg's holding, in the same transaction", async () => {
    // The existing row is the other half of the same money movement, so it must
    // carry the marker too — otherwise a CROSS-CURRENCY convert leaves the
    // original expense in the spending pie (nothing pairs it: the matched-pair
    // matcher requires one currency).
    const { tx, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 2_000 }], // the new leg's balance read
      [{ source: 'manual' }], // the existing row, read INSIDE the transaction
    ]);
    mockTx = tx;

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dst-1',
      counterpartType: 'cash',
      amountMinorUnits: 7_000,
      existingTransactionId: 'existing-tx-1',
      existingHoldingId: 'existing-1',
      time: 123,
    });

    expect(updates).toContainEqual({
      table: transactions,
      values: { exchangeCounterpartHoldingId: 'dst-1' },
    });
  });

  it('never marks a SYNCED existing row (the bank owns it)', async () => {
    const { tx, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 2_000 }],
      [{ source: 'monobank' }],
    ]);
    mockTx = tx;

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dst-1',
      counterpartType: 'cash',
      amountMinorUnits: 7_000,
      existingTransactionId: 'existing-tx-1',
      existingHoldingId: 'existing-1',
      time: 123,
    });

    // Only the new leg's holding balance moved; the `transactions` table was
    // never written. A synced bank debit converted to another currency stays in
    // the spending pie — the documented residual (see schema.ts).
    expect(updates.every((update) => update.table !== transactions)).toBe(true);
  });

  it('records a term_deposit destination as a contribution (metadata rewrite, no new ledger row)', async () => {
    // Reuse the call-ordered `makeExchangeTx` select fake: the destination
    // read (the only select call this path makes) returns the term_deposit
    // row `appendDepositContributionTx` expects.
    const { tx, inserts } = makeExchangeTx([[{ type: 'term_deposit', metadata: depositMeta }]]);
    mockTx = tx;

    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'dep-1',
      counterpartType: 'term_deposit',
      amountMinorUnits: 5_000,
      existingTransactionId: 'existing-tx-1',
      existingHoldingId: 'existing-1',
      time: 1,
    });

    expect(inserts).toHaveLength(0); // a deposit receive writes NO ledger row
  });

  it('throws for an income-sourced convert into a term_deposit (a source leg is never a contribution)', async () => {
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 0 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchangeCounterpart({
        direction: 'record-source',
        counterpartHoldingId: 'dep-1',
        counterpartType: 'term_deposit',
        amountMinorUnits: 1_000,
        existingTransactionId: 'existing-tx-1',
        existingHoldingId: 'existing-1',
        time: 1,
      }),
    ).rejects.toThrow();
  });

  it('throws for a bond/jar destination (excluded)', async () => {
    mockTx = {
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([{ balanceMinorUnits: 0 }]) }),
        }),
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };

    await expect(
      transactionsRepo.recordExchangeCounterpart({
        direction: 'record-destination',
        counterpartHoldingId: 'bond-1',
        counterpartType: 'bond',
        amountMinorUnits: 1_000,
        existingTransactionId: 'existing-tx-1',
        existingHoldingId: 'existing-1',
        time: 1,
      }),
    ).rejects.toThrow();
  });
});
