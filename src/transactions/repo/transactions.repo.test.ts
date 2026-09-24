// `recordManual` runs its insert + balance read + balance update through
// the `write` helper (one op-sqlite transaction). Override `write` to run
// the callback against a fake transaction handle so the test can capture
// what was inserted and what balance was written, proving the read-modify-
// write of the balance happens inside the same unit and uses the DB-read
// base (5000) + amount, not a caller-supplied snapshot.
let mockTx: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { drizzle } from 'drizzle-orm/sqlite-proxy';

import { accountsRepo } from '../../accounts/accounts.repo';
import { accounts, categoryOverrides, holdings, transactions } from '../../db/schema';

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

  it('includes the change group id in the joined all-transactions projection', () => {
    const sql = transactionsRepo.listAllWithContextQuery().toSQL().sql;

    expect(sql).toContain('change_group_id');
  });

  it('includes the source in the joined all-transactions projection, so Home can tell a synced row from a manual one', () => {
    const sql = transactionsRepo.listAllWithContextQuery().toSQL().sql;

    expect(sql).toContain('"transactions"."source"');
  });

  it('builds a DISTINCT manual-descriptions query ordered newest-first (D1 autocomplete)', () => {
    const { sql } = transactionsRepo.distinctDescriptionsQuery().toSQL();
    const lower = sql.toLowerCase();

    // DISTINCT so a repeated merchant name is offered once, projecting only the
    // description column the suggestion row consumes.
    expect(lower).toContain('select distinct');
    expect(lower).toContain('"description"');
    // Newest-first (recency, not frequency): ordered by the transaction time,
    // descending.
    expect(lower).toContain('order by');
    expect(lower).toContain('"transactions"."time" desc');
  });

  it('restricts the distinct-descriptions query to MANUAL rows with a non-empty description', () => {
    const { sql, params } = transactionsRepo.distinctDescriptionsQuery().toSQL();

    // Synced/bank descriptions are excluded — only the user's own manual rows
    // seed the suggestion list.
    expect(sql).toContain('"transactions"."source"');
    expect(params).toContain('manual');
    // The empty-description rows (a blank manual row, a description-less
    // exchange leg) are filtered out in SQL via `<> ''`.
    expect(sql).toContain('<>');
    expect(params).toContain('');
  });

  it('builds a most-recent-manual-holding query: source manual, time desc, single row (B)', () => {
    const { sql, params } = transactionsRepo.latestManualHoldingQuery().toSQL();
    const lower = sql.toLowerCase();

    // The default primary-leg holding for a global add comes from the newest
    // MANUAL transaction's holding, so the query projects only `holding_id`,
    // filters the manual source, orders newest-first, and takes a single row.
    expect(lower).toContain('"holding_id"');
    expect(lower).toContain('"transactions"."source"');
    expect(params).toContain('manual');
    expect(lower).toContain('"transactions"."time" desc');
    expect(lower).toContain('limit');
    expect(params).toContain(1);
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

  // A binance import row carries the stable 'BTC' description (item 12). It rides
  // the SAME shared upsert as Monobank, which already refreshes `description`, so
  // an already-imported crypto row whose description was '' gains 'BTC' on the
  // next sync — with no repo change. These two guard that the behavior B3 relies
  // on stays intact.
  const binanceRow = (overrides: Record<string, unknown> = {}) => ({
    holdingId: 'h-spot',
    amountMinorUnits: 50_000_000,
    time: 1,
    source: 'binance' as const,
    description: 'BTC',
    externalId: 'deposit:1',
    ...overrides,
  });

  it('refreshes an imported binance description on re-sync while preserving a user category override', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([binanceRow()]);

    // `description` is refreshed from the incoming row, so a stored '' becomes
    // 'BTC' on re-sync; `category` (a user's pick) and `comment` stay out of the
    // set, so a re-sync never clobbers them.
    const setKeys = Object.keys(captured.conflict?.set ?? {});
    expect(setKeys).toContain('description');
    expect(setKeys).not.toContain('category');
    expect(setKeys).not.toContain('comment');
  });

  it('keys the upsert on (source, external id) so a binance import never touches a monobank row', async () => {
    const { tx, captured } = makeAddManyTx([]);
    mockTx = tx;

    await transactionsRepo.addManyDedup([binanceRow()]);

    // The conflict target includes `source`, so a binance row can only ever
    // refresh another binance row — never a monobank merchant row, and never a
    // manual row (null external id, which never conflicts). This separation is
    // what protects a Monobank/user description from the binance 'BTC' label.
    expect(captured.conflict?.target).toEqual([transactions.source, transactions.externalId]);
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

// A STORE-backed fake transaction handle for `addManyDedup`, unlike
// `makeAddManyTx` above (which only CAPTURES the issued insert/conflict
// config for one call). `insert(...).onConflictDoUpdate(...)` here actually
// applies the real `(source, external_id)` unique-index semantics against a
// plain array — merging into an existing row on a match, pushing a new one
// otherwise — so a test can run `addManyDedup` TWICE against the SAME store
// (mirroring two providers' own syncs) and read back what actually persisted,
// not just the SQL shape a single call would have issued.
const makeAddManyStoreTx = (store: Record<string, unknown>[]) => ({
  select: () => ({
    from: (table: unknown) => ({
      // `categoryOverrides` never carries a matching rule here (no test row
      // seeded), and the countNewRows existing-rows probe over `transactions`
      // does not need to be clause-accurate — mirrors `holdings.repo.test.ts`'s
      // `makeTx`, which resolves the whole table rather than interpreting
      // `.where(...)`.
      where: async () => (table === categoryOverrides ? [] : store),
    }),
  }),
  insert: () => ({
    values: (values: Record<string, unknown>[]) => ({
      onConflictDoUpdate: () => {
        for (const row of values) {
          const existingIndex = store.findIndex(
            (stored) => stored.source === row.source && stored.externalId === row.externalId,
          );

          if (existingIndex >= 0) {
            store[existingIndex] = { ...store[existingIndex], ...row };
          } else {
            store.push(row);
          }
        }

        return Promise.resolve();
      },
    }),
  }),
});

describe('transactionsRepo.addManyDedup cross-provider externalId namespacing', () => {
  // Global Constraints invariant: `externalId` is namespaced
  // `${accountId}:${providerStatementId}`, so two DIFFERENT providers can
  // legitimately land on the identical namespaced string (e.g. Monobank's
  // statement id "1" and Binance's transfer id "1" on the SAME internal
  // account id) without colliding, because the unique index is
  // `(source, external_id)`, not `external_id` alone.
  it('keeps both rows when two different providers report the SAME namespaced externalId, because source differs', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeAddManyStoreTx(store);

    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h-monobank',
        amountMinorUnits: -150,
        time: 1,
        source: 'monobank',
        description: 'Coffee',
        externalId: 'acc-1:1',
      },
    ]);
    await transactionsRepo.addManyDedup([
      {
        holdingId: 'h-binance',
        amountMinorUnits: 5000,
        time: 2,
        source: 'binance',
        description: 'Salary',
        externalId: 'acc-1:1',
      },
    ]);

    expect(store).toHaveLength(2);
    const monobankRow = store.find((row) => row.source === 'monobank');
    const binanceRow = store.find((row) => row.source === 'binance');
    expect(monobankRow?.externalId).toBe('acc-1:1');
    expect(monobankRow?.amountMinorUnits).toBe(-150);
    expect(binanceRow?.externalId).toBe('acc-1:1');
    expect(binanceRow?.amountMinorUnits).toBe(5000);
  });
});

describe('transactionsRepo.setCategory', () => {
  it("rewrites ONLY the target row's category inside one transaction, with no source gate", async () => {
    const captured: { table?: unknown; set?: Record<string, unknown>; whereArg?: unknown } = {};
    mockTx = {
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          captured.table = table;
          captured.set = values;

          return {
            where: (arg: unknown) => {
              captured.whereArg = arg;

              return Promise.resolve();
            },
          };
        },
      }),
    };

    await transactionsRepo.setCategory({ transactionId: 'txn-7', category: 'dining' });

    // A direct UPDATE on the transactions table, touching category and nothing
    // else (no balance write, no other row) — the "just for this one" override.
    expect(captured.table).toBe(transactions);
    expect(captured.set).toEqual({ category: 'dining' });
    // It is scoped to the single row by id (a filter was applied); it never
    // gates on `source`, so a synced bank row is categorizable too.
    expect(captured.whereArg).toBeDefined();
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

describe('transactionsRepo.recordManualWithReturns', () => {
  it('writes the payment + N return rows sharing ONE changeGroupId in one transaction', async () => {
    const { tx, inserts, updates } = makeExchangeTx([
      [{ balanceMinorUnits: 50_000 }], // payer balance read
      [{ balanceMinorUnits: 1_000 }], // return holding B balance read
      [{ balanceMinorUnits: 2_000 }], // return holding C balance read
    ]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: {
        holdingId: 'payer-1',
        amountMinorUnits: -21_200,
        time: 123,
        category: 'groceries',
      },
      returns: [
        { holdingId: 'hold-b', amountMinorUnits: 20 },
        { holdingId: 'hold-c', amountMinorUnits: 8 },
      ],
    });

    // One shared group id across all three rows.
    const groupIds = inserts.map((row) => row.changeGroupId);
    expect(new Set(groupIds).size).toBe(1);
    expect(groupIds[0]).toEqual(expect.any(String));

    expect(inserts).toEqual([
      expect.objectContaining({
        holdingId: 'payer-1',
        amountMinorUnits: -21_200,
        time: 123,
        category: 'groceries',
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'hold-b',
        amountMinorUnits: 20,
        time: 123,
        source: 'manual',
      }),
      expect.objectContaining({
        holdingId: 'hold-c',
        amountMinorUnits: 8,
        time: 123,
        source: 'manual',
      }),
    ]);

    // base 50_000 - 21_200 = 28_800 (payer); 1_000 + 20 = 1_020; 2_000 + 8 = 2_008
    expect(updates).toEqual([
      { table: holdings, values: { balanceMinorUnits: 28_800 } },
      { table: holdings, values: { balanceMinorUnits: 1_020 } },
      { table: holdings, values: { balanceMinorUnits: 2_008 } },
    ]);
  });

  it('writes only the payment row when there are no returns', async () => {
    const { tx, inserts, updates } = makeExchangeTx([[{ balanceMinorUnits: 50_000 }]]);
    mockTx = tx;

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'payer-1', amountMinorUnits: -5_000, time: 7, category: 'transport' },
      returns: [],
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual(
      expect.objectContaining({ holdingId: 'payer-1', amountMinorUnits: -5_000 }),
    );
    expect(updates).toEqual([{ table: holdings, values: { balanceMinorUnits: 45_000 } }]);
  });
});

// A minimal fake for `importRows`: dispatches every `select` by the table it
// targets, distinguishing the two no-`.limit()` `transactions` reads (the
// sync-boundary aggregate vs. the dedup partition probe) by the PROJECTED
// field set `select(fields)` is called with — `{ time }` for the aggregate,
// `{ source, externalId }` for the probe — since both share the same table
// identity and neither chains `.limit()`. `holdings`/`accounts` reads chain
// `.limit(1)`; every read here resolves either way, mirroring
// `makeExchangeTx`'s dual-calling-convention trick. `syncBoundaryTime`
// answers the sync-source aggregate (boundary source (b)) — the hand-set
// boundary (source (a)) comes straight off `holding.balanceSetAt` instead,
// no separate query.
//
// Review follow-up: `import-statement.test.ts` has its own, similarly-shaped
// `makeImportTx` — deliberately NOT shared with this one. That file's fake
// applies the upsert for real against a persistent `store` (its re-import
// test spans TWO `importStatement` calls and asserts the SECOND sees the
// first's real dedup effect), while every test here needs only a static,
// per-call answer (`existing`/`syncBoundaryTime`) to drive one `importRows`
// decision in isolation — the two fakes solve different fidelity problems,
// so unifying them would force the simpler suite to carry a live store it
// never needs.
type ImportRowsTxOpts = {
  holding?: Record<string, unknown>;
  account?: Record<string, unknown>;
  syncBoundaryTime?: number | null;
  existing?: { source: string; externalId: string }[];
};

const resolveImportRowsSelect = (
  opts: ImportRowsTxOpts,
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
    const time = opts.syncBoundaryTime;

    return time === undefined || time === null ? [] : [{ time }];
  }

  return opts.existing ?? [];
};

const makeImportRowsTx = (
  opts: ImportRowsTxOpts,
): { tx: unknown; captured: { holdingSet?: Record<string, unknown> } } => {
  const captured: { holdingSet?: Record<string, unknown> } = {};
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  const tx = {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveImportRowsSelect(opts, table, fields)),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
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

const baseHolding = {
  id: 'hold-1',
  accountId: 'acc-1',
  currency: 'UAH',
  balanceMinorUnits: 0,
  balanceSetAt: null,
  metadata: null,
};

const unsyncedAccount = { institution: null };

describe('transactionsRepo.importRows', () => {
  // Review follow-up (ponytail): a missing holding used to fall back to a
  // plain dedup insert with no balance write — replaced with a throw, since
  // the real caller (`importStatement`) already validates the holding
  // exists before this ever runs.
  it('throws when the target holding cannot be found', async () => {
    const { tx } = makeImportRowsTx({ account: unsyncedAccount });
    mockTx = tx;

    await expect(
      transactionsRepo.importRows({
        holdingId: 'missing-holding',
        rows: [
          { holdingId: 'missing-holding', amountMinorUnits: -1_000, time: 1, source: 'import' },
        ],
      }),
    ).rejects.toThrow('Target holding not found: missing-holding');
  });

  it('moves a 0-balance holding by the net of the imported rows', async () => {
    const { tx, captured } = makeImportRowsTx({ holding: baseHolding, account: unsyncedAccount });
    mockTx = tx;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        { holdingId: 'hold-1', amountMinorUnits: -5_000, time: 1, source: 'import' },
        { holdingId: 'hold-1', amountMinorUnits: -12_000, time: 2, source: 'import' },
      ],
    });

    expect(imported).toBe(2);
    // -5_000 + -12_000 = -17_000
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: -17_000 });
  });

  it('leaves the balance untouched on a re-import where every row already exists (net of new rows is 0)', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -17_000 },
      account: unsyncedAccount,
      existing: [{ source: 'import', externalId: 'e1' }],
    });
    mockTx = tx;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        {
          holdingId: 'hold-1',
          amountMinorUnits: -5_000,
          time: 1,
          source: 'import',
          externalId: 'e1',
        },
      ],
    });

    expect(imported).toBe(0);
    expect(captured.holdingSet).toBeUndefined();
  });

  it('adds only the net of the genuinely new rows on a partial overlap', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      existing: [{ source: 'import', externalId: 'e1' }],
    });
    mockTx = tx;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        {
          holdingId: 'hold-1',
          amountMinorUnits: -5_000,
          time: 1,
          source: 'import',
          externalId: 'e1',
        },
        {
          holdingId: 'hold-1',
          amountMinorUnits: -3_000,
          time: 2,
          source: 'import',
          externalId: 'e2',
        },
      ],
    });

    expect(imported).toBe(1);
    // base -5_000 + only the new row's -3_000 = -8_000 (the already-existing
    // e1 row contributes 0, even though it rides in the same batch).
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: -8_000 });
  });

  it('sets the balance to the closing balance when it is newer than the newest existing transaction', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      syncBoundaryTime: 1_000,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 2_000, source: 'import' }],
      closingBalance: { minorUnits: -50_000, currency: 'UAH', asOfSeconds: 2 },
    });

    // asOfSeconds 2 -> 2_000ms >= syncBoundaryTime 1_000, so the closing
    // balance wins outright instead of base + net (-6_000); applying it also
    // stamps `balanceSetAt` (2_000ms) as this holding's boundary source (a)
    // for a later import.
    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: -50_000,
      balanceSetAt: 2_000,
    });
  });

  it('ignores an OLDER closing balance and adds the net of new rows instead, when the rows themselves are AT/AFTER the boundary', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      syncBoundaryTime: 5_000,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        // The row's own time (6_000) is AT/AFTER the boundary (5_000), so it
        // is "current" and its full amount is added — this test isolates "an
        // older closing balance is ignored" from the separate history-row
        // rule (covered by its own tests below).
        { holdingId: 'hold-1', amountMinorUnits: -1_000, time: 6_000, source: 'import' },
      ],
      // asOfSeconds 2 -> 2_000ms < syncBoundaryTime 5_000: the statement is
      // OLDER than what the holding already has, so its closing balance is
      // ignored and the net of the new row is added instead.
      closingBalance: { minorUnits: -999_999, currency: 'UAH', asOfSeconds: 2 },
    });

    expect(captured.holdingSet).toEqual({ balanceMinorUnits: -6_000 });
  });

  it('ignores a closing balance in the WRONG currency and adds the net of new rows instead', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 1, source: 'import' }],
      closingBalance: { minorUnits: 777_777, currency: 'USD', asOfSeconds: 999_999_999 },
    });

    expect(captured.holdingSet).toEqual({ balanceMinorUnits: -6_000 });
  });

  it('never moves a SYNCED holding’s balance, even with new rows and a fresh closing balance', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, metadata: { monobankId: 'mono-1' } },
      account: { institution: 'monobank' },
      syncBoundaryTime: 1,
    });
    mockTx = tx;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 2, source: 'import' }],
      closingBalance: { minorUnits: -777_777, currency: 'UAH', asOfSeconds: 2 },
    });

    // The rows still import (they're real ledger history), but the sync
    // pipeline stays the sole owner of this holding's displayed balance.
    expect(imported).toBe(1);
    expect(captured.holdingSet).toBeUndefined();
  });

  it('treats a holding with no prior transactions as always eligible for the closing balance', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: 0 },
      account: unsyncedAccount,
      syncBoundaryTime: null,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 1, source: 'import' }],
      // Review follow-up (M5): deliberately DIFFERENT from base + net
      // (0 + -1_000 = -1_000) — the old fixture used -1_000 here too, so a
      // regression that fell back to the net-delta rule would still have
      // passed this assertion by coincidence.
      closingBalance: { minorUnits: -5_000, currency: 'UAH', asOfSeconds: 1 },
    });

    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: -5_000,
      balanceSetAt: 1_000,
    });
  });

  // Review follow-up (M5): the eligibility check is `asOfSeconds * 1000 >=
  // syncBoundaryTime` — an exact equality (the statement's own closing
  // balance is as of precisely the holding's newest existing row) must still
  // win, not just a strictly-newer statement.
  it('uses the closing balance when it is exactly as of the newest existing transaction (the >= boundary)', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      syncBoundaryTime: 2_000,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 2_000, source: 'import' }],
      closingBalance: { minorUnits: -50_000, currency: 'UAH', asOfSeconds: 2 },
    });

    // asOfSeconds 2 -> 2_000ms === syncBoundaryTime 2_000: the closing
    // balance wins outright instead of base + net (-6_000).
    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: -50_000,
      balanceSetAt: 2_000,
    });
  });

  // A row dated BEFORE the boundary is history — it still inserts, but
  // contributes 0 to the balance. See `importRows`'s own doc comment for
  // the full rule.
  it('treats a row dated BEFORE the boundary as history: it inserts but contributes 0 to the balance', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      syncBoundaryTime: 5_000,
    });
    mockTx = tx;

    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: 1_000, source: 'import' }],
    });

    // Genuinely new (imported: 1) — it lands as real ledger history — but
    // its own time (1_000) is before the boundary (5_000), so it moves
    // nothing: a backfill of older history can never move a balance the
    // ledger has already moved past.
    expect(imported).toBe(1);
    expect(captured.holdingSet).toBeUndefined();
  });

  it('moves the balance by only the rows AT/AFTER the boundary, when a batch mixes history and current rows', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: -5_000 },
      account: unsyncedAccount,
      syncBoundaryTime: 5_000,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        { holdingId: 'hold-1', amountMinorUnits: -1_000, time: 1_000, source: 'import' }, // history: +0
        { holdingId: 'hold-1', amountMinorUnits: -2_000, time: 5_000, source: 'import' }, // AT the boundary: counts
        { holdingId: 'hold-1', amountMinorUnits: -3_000, time: 6_000, source: 'import' }, // after: counts
      ],
    });

    // base -5_000 + (-2_000 + -3_000) = -10_000; the 1_000-dated row's
    // -1_000 is excluded as history.
    expect(captured.holdingSet).toEqual({ balanceMinorUnits: -10_000 });
  });

  it('adds the net of new rows dated AFTER the closing balance’s own as-of, on top of the closing balance itself', async () => {
    const { tx, captured } = makeImportRowsTx({
      holding: { ...baseHolding, balanceMinorUnits: 0 },
      account: unsyncedAccount,
      syncBoundaryTime: null,
    });
    mockTx = tx;

    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        { holdingId: 'hold-1', amountMinorUnits: -500, time: 1_000, source: 'import' }, // at the as-of, not after
        { holdingId: 'hold-1', amountMinorUnits: -300, time: 2_000, source: 'import' }, // after the as-of
      ],
      closingBalance: { minorUnits: -5_000, currency: 'UAH', asOfSeconds: 1 },
    });

    // closingBalance (-5_000) + only the row dated AFTER its own as-of
    // (-300) = -5_300. Normally a statement's own closing balance is drawn
    // from its OWN newest row, so no row is ever after it (see
    // `resolveClosingBalance`) — this proves the rule still adds correctly
    // on the rare batch where one is.
    expect(captured.holdingSet).toEqual({
      balanceMinorUnits: -5_300,
      balanceSetAt: 1_000,
    });
  });

  // User ruling (D-I2): `holdingsRepo.create` stamps `holdings.balanceSetAt`
  // at create time for a non-zero typed opening balance, and
  // `holdingsRepo.updateWithBalanceDelta` stamps it at edit time for a
  // non-zero manual balance edit (both verified in `holdings.repo.test.ts`)
  // — `importRows` reads that column straight off the holding row, no
  // separate query. This suite simulates that pre-condition directly (the
  // holding's own `balanceSetAt` already set) rather than re-driving
  // `holdingsRepo`'s own `write` mock.
  describe('the boundary a hand-set balance leaves behind', () => {
    const HAND_SET_TIME = 10_000;

    it('a typed-balance create leaves an OLDER statement’s balance untouched', async () => {
      const { tx, captured } = makeImportRowsTx({
        holding: { ...baseHolding, balanceMinorUnits: 250_00, balanceSetAt: HAND_SET_TIME },
        account: unsyncedAccount,
      });
      mockTx = tx;

      const imported = await transactionsRepo.importRows({
        holdingId: 'hold-1',
        rows: [
          {
            holdingId: 'hold-1',
            amountMinorUnits: -1_000,
            time: HAND_SET_TIME - 1,
            source: 'import',
          },
        ],
      });

      expect(imported).toBe(1);
      expect(captured.holdingSet).toBeUndefined();
    });

    it('a manual balance edit keeps its edited value when a later-imported statement is OLDER', async () => {
      const { tx, captured } = makeImportRowsTx({
        holding: { ...baseHolding, balanceMinorUnits: 500_00, balanceSetAt: HAND_SET_TIME },
        account: unsyncedAccount,
      });
      mockTx = tx;

      await transactionsRepo.importRows({
        holdingId: 'hold-1',
        rows: [
          {
            holdingId: 'hold-1',
            amountMinorUnits: 9_999,
            time: HAND_SET_TIME - 500,
            source: 'import',
          },
        ],
      });

      expect(captured.holdingSet).toBeUndefined();
    });

    it('a statement NEWER than the last hand-set time moves the balance by its own net', async () => {
      const { tx, captured } = makeImportRowsTx({
        holding: { ...baseHolding, balanceMinorUnits: 500_00, balanceSetAt: HAND_SET_TIME },
        account: unsyncedAccount,
      });
      mockTx = tx;

      await transactionsRepo.importRows({
        holdingId: 'hold-1',
        rows: [
          {
            holdingId: 'hold-1',
            amountMinorUnits: -100_00,
            time: HAND_SET_TIME + 1,
            source: 'import',
          },
        ],
      });

      expect(captured.holdingSet).toEqual({ balanceMinorUnits: 400_00 });
    });

    it('a statement NEWER than the last hand-set time, carrying its own closing balance, writes that closing balance', async () => {
      const { tx, captured } = makeImportRowsTx({
        holding: { ...baseHolding, balanceMinorUnits: 500_00, balanceSetAt: HAND_SET_TIME },
        account: unsyncedAccount,
      });
      mockTx = tx;

      await transactionsRepo.importRows({
        holdingId: 'hold-1',
        rows: [
          {
            holdingId: 'hold-1',
            amountMinorUnits: -100_00,
            time: HAND_SET_TIME + 1,
            source: 'import',
          },
        ],
        closingBalance: {
          minorUnits: 12_345,
          currency: 'UAH',
          asOfSeconds: (HAND_SET_TIME + 1) / 1000,
        },
      });

      expect(captured.holdingSet).toEqual({
        balanceMinorUnits: 12_345,
        balanceSetAt: HAND_SET_TIME + 1,
      });
    });
  });
});

// A STATEFUL fake, unlike `makeImportRowsTx` above (a static, per-call
// answer): `holding` is a shared, mutable object a `holdings` write
// actually mutates, and `store` is a shared, mutable transactions array a
// row upsert actually appends to — so two SEQUENTIAL `importRows` calls
// against the SAME pair see each other's real effects, the way two real
// statement imports into the same holding would. Needed by every describe
// block below that spans more than one `importRows` call in a single test
// (order independence, and the R1(b)/D-I1/D-I2 boundary-source tests);
// every OTHER `importRows` test needs just one static decision, per the
// comment on `makeImportRowsTx`.
type OrderedStoreRow = { time: number; source: string; externalId: string | null };

type OrderedImportHolding = {
  id: string;
  accountId: string;
  currency: string;
  balanceMinorUnits: number;
  balanceSetAt: number | null;
};

type OrderedImportTxOpts = {
  holding: OrderedImportHolding;
  account: { institution: string | null };
  store: OrderedStoreRow[];
};

/** Mirrors `resolveImportRowsSelect`/`resolveImportSelect` in the sibling
 * fakes above and in `import-statement.test.ts`: dispatch by table identity,
 * and — for the two no-`.limit()` `transactions` reads sharing that table —
 * by the PROJECTED field set. Pulled out of the closure below purely to
 * stay under Biome's cognitive-complexity cap. The "time" read mirrors the
 * REAL query's own sync-source filter (`source NOT IN ('manual', 'import')`)
 * — the store's `manual`/`import`-sourced rows must NOT surface here, only a
 * sync row does; the hand-set boundary source comes back separately,
 * straight off `opts.holding.balanceSetAt`. */
const resolveOrderedSelect = (
  opts: OrderedImportTxOpts,
  table: unknown,
  fields: Record<string, unknown> | undefined,
): unknown[] => {
  if (table === categoryOverrides) {
    return [];
  }

  if (table === holdings) {
    return [opts.holding];
  }

  if (table === accounts) {
    return [opts.account];
  }

  if (table === transactions && fields && 'time' in fields) {
    const syncTimes = opts.store
      .filter((row) => row.source !== 'manual' && row.source !== 'import')
      .map((row) => row.time);

    return syncTimes.length > 0 ? [{ time: Math.max(...syncTimes) }] : [{ time: null }];
  }

  return opts.store.map((row) => ({ source: row.source, externalId: row.externalId }));
};

const makeOrderedImportTx = (opts: OrderedImportTxOpts) => {
  const resolveRows = (rows: unknown[]) =>
    Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

  return {
    select: (fields?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: () => resolveRows(resolveOrderedSelect(opts, table, fields)),
      }),
    }),
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoUpdate: async () => {
          for (const row of rows) {
            opts.store.push({
              time: row.time as number,
              source: row.source as string,
              externalId: (row.externalId as string | null) ?? null,
            });
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === holdings) {
          if ('balanceMinorUnits' in values) {
            opts.holding.balanceMinorUnits = values.balanceMinorUnits as number;
          }

          // Mirrors real Drizzle's `.set()`, which DROPS an undefined-valued
          // key — `'balanceSetAt' in values` alone would be true even when
          // the production code passed `balanceSetAt: undefined` (no closing
          // balance applied this call), wrongly erasing an earlier value.
          if (values.balanceSetAt !== undefined) {
            opts.holding.balanceSetAt = values.balanceSetAt as number;
          }
        }

        return { where: () => Promise.resolve() };
      },
    }),
  };
};

describe('transactionsRepo.importRows order independence (an applied closing balance)', () => {
  const APRIL_TIME = Date.UTC(2024, 3, 15);
  const MAY_TIME = Date.UTC(2024, 4, 15);
  const mayClosing = {
    minorUnits: -50_000,
    currency: 'UAH' as const,
    asOfSeconds: MAY_TIME / 1000,
  };
  const mayRows = [
    { holdingId: 'hold-1', amountMinorUnits: -1_000, time: MAY_TIME, source: 'import' as const },
  ];
  const aprilRows = [
    { holdingId: 'hold-1', amountMinorUnits: -2_000, time: APRIL_TIME, source: 'import' as const },
  ];

  it('reaches the same final balance whether May (with its own closing balance) is imported before or after April', async () => {
    const orderOneHolding = { ...baseHolding };
    const orderOneStore: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({
      holding: orderOneHolding,
      account: unsyncedAccount,
      store: orderOneStore,
    });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: mayRows,
      closingBalance: mayClosing,
    });
    mockTx = makeOrderedImportTx({
      holding: orderOneHolding,
      account: unsyncedAccount,
      store: orderOneStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: aprilRows });

    const orderTwoHolding = { ...baseHolding };
    const orderTwoStore: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({
      holding: orderTwoHolding,
      account: unsyncedAccount,
      store: orderTwoStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: aprilRows });
    mockTx = makeOrderedImportTx({
      holding: orderTwoHolding,
      account: unsyncedAccount,
      store: orderTwoStore,
    });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: mayRows,
      closingBalance: mayClosing,
    });

    // Both orders converge on May's own closing balance: April's rows are
    // history in one order (dated before the boundary May already
    // established) and superseded by May's own closing-balance write in the
    // other (April's net never survives past May's outright overwrite).
    expect(orderOneHolding.balanceMinorUnits).toBe(orderTwoHolding.balanceMinorUnits);
    expect(orderOneHolding.balanceMinorUnits).toBe(-50_000);
  });
});

// User ruling (R1, "(b)"): an earlier PLAIN import's own rows are NEVER a
// boundary source, whether or not a hand-set balance or a sync row exists
// (D-I1/D-I2 have their own describe blocks below for those two sources).
// These three tests are the ruling's own pinned cases.
describe('transactionsRepo.importRows boundary sources (R1 ruling b)', () => {
  const APRIL_TIME = Date.UTC(2024, 3, 15);
  const MAY_TIME = Date.UTC(2024, 4, 15);

  it('R1 test 1: an import-only holding (never hand-set, no closing balance) reaches the same final balance whether May or April imports first', async () => {
    const mayRows = [
      { holdingId: 'hold-1', amountMinorUnits: -1_000, time: MAY_TIME, source: 'import' as const },
    ];
    const aprilRows = [
      {
        holdingId: 'hold-1',
        amountMinorUnits: -2_000,
        time: APRIL_TIME,
        source: 'import' as const,
      },
    ];

    const orderOneHolding = { ...baseHolding };
    const orderOneStore: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({
      holding: orderOneHolding,
      account: unsyncedAccount,
      store: orderOneStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: mayRows });
    mockTx = makeOrderedImportTx({
      holding: orderOneHolding,
      account: unsyncedAccount,
      store: orderOneStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: aprilRows });

    const orderTwoHolding = { ...baseHolding };
    const orderTwoStore: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({
      holding: orderTwoHolding,
      account: unsyncedAccount,
      store: orderTwoStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: aprilRows });
    mockTx = makeOrderedImportTx({
      holding: orderTwoHolding,
      account: unsyncedAccount,
      store: orderTwoStore,
    });
    await transactionsRepo.importRows({ holdingId: 'hold-1', rows: mayRows });

    // Neither import ever hand-sets a balance or carries a closing balance,
    // so R1(b) leaves this holding with NO boundary at all, ever — every
    // row counts in both orders, converging on net_April + net_May
    // (-2_000 + -1_000 = -3_000) regardless of which statement lands first.
    expect(orderOneHolding.balanceMinorUnits).toBe(orderTwoHolding.balanceMinorUnits);
    expect(orderOneHolding.balanceMinorUnits).toBe(-3_000);
  });

  // M1 (review follow-up): rebuilt on the STATEFUL fake, with a NEWER plain
  // `import` row already sitting in the ledger, so this actually discriminates
  // — it proves the boundary is `balanceSetAt` alone, not "the newest row
  // in the store" (which the newer import row would otherwise satisfy).
  it('R1 test 2: a hand-set balance leaves an OLDER statement (every row before the hand-set time) unchanged, even with a newer plain import already in the ledger', async () => {
    const HAND_SET_TIME = 10_000;
    const holding = { ...baseHolding, balanceMinorUnits: 250_00, balanceSetAt: HAND_SET_TIME };
    const store: OrderedStoreRow[] = [
      { time: HAND_SET_TIME + 5_000, source: 'import', externalId: 'later-import' },
    ];

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [
        {
          holdingId: 'hold-1',
          amountMinorUnits: -1_000,
          time: HAND_SET_TIME - 1,
          source: 'import',
        },
      ],
    });

    expect(imported).toBe(1);
    expect(holding.balanceMinorUnits).toBe(250_00);
  });

  it('R1 test 3: an applied closing balance (which writes no ledger row of its own) leaves an OLDER non-closing statement unchanged', async () => {
    const holding = { ...baseHolding };
    const store: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [],
      closingBalance: { minorUnits: 100_000, currency: 'UAH', asOfSeconds: MAY_TIME / 1000 },
    });

    expect(holding.balanceMinorUnits).toBe(100_000);

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -2_000, time: APRIL_TIME, source: 'import' }],
    });

    // The first import applied its closing balance with NO row of its own —
    // the closing WRITE itself, not some inserted row's own time, must be
    // the boundary: April predates May's closing instant, so it lands as
    // history and the balance stays exactly the applied closing balance.
    expect(holding.balanceMinorUnits).toBe(100_000);
  });
});

// User ruling (D-I1): a row from a SYNC source (`source` not in ('manual',
// 'import')) counts as a boundary again, as on `0e445ff` — a disconnected
// Monobank holding keeps its synced balance when an older CSV is imported,
// with or without that CSV's own closing balance.
describe('transactionsRepo.importRows boundary sources (D-I1: a disconnected, formerly synced holding keeps its sync-set boundary)', () => {
  const SEP_20 = Date.UTC(2024, 8, 20);
  const JULY_15 = Date.UTC(2024, 6, 15);
  const julyRows = [
    { holdingId: 'hold-1', amountMinorUnits: -1_000, time: JULY_15, source: 'import' as const },
  ];

  it('a July statement with no closing balance leaves the sync-set balance unchanged; its rows still insert', async () => {
    const holding = { ...baseHolding, balanceMinorUnits: 500_000 };
    const store: OrderedStoreRow[] = [{ time: SEP_20, source: 'monobank', externalId: 'mono-1' }];

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    const imported = await transactionsRepo.importRows({ holdingId: 'hold-1', rows: julyRows });

    expect(imported).toBe(1);
    expect(store).toHaveLength(2);
    expect(holding.balanceMinorUnits).toBe(500_000);
  });

  it('a July statement WITH its own closing balance also leaves the sync-set balance unchanged (the statement is older than the boundary)', async () => {
    const holding = { ...baseHolding, balanceMinorUnits: 500_000 };
    const store: OrderedStoreRow[] = [{ time: SEP_20, source: 'monobank', externalId: 'mono-1' }];

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    const imported = await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: julyRows,
      closingBalance: {
        minorUnits: 999_999,
        currency: 'UAH',
        asOfSeconds: Date.UTC(2024, 6, 31) / 1000,
      },
    });

    expect(imported).toBe(1);
    expect(holding.balanceMinorUnits).toBe(500_000);
  });
});

// User ruling (D-I2): ONLY a TRUE hand-set balance is a boundary —
// `recordManual`, an exchange leg, or a change-return row all write a
// `source: 'manual'` transaction but never stamp `holdings.balanceSetAt`,
// so none of them is a boundary source. `holdings.repo.test.ts` pins that
// `holdingsRepo.create`/`updateWithBalanceDelta` DO stamp it; this suite
// pins `importRows`'s own read of it.
describe('transactionsRepo.importRows boundary sources (D-I2: only a TRUE hand-set balance is a boundary)', () => {
  const APRIL_15 = Date.UTC(2024, 3, 15);
  const MAY_15 = Date.UTC(2024, 4, 15);
  const JUN_5 = Date.UTC(2024, 5, 5);

  // Reviewer's scenario: an ordinary manual row (simulating an exchange leg,
  // written by `recordExchange`/`recordExchangeCounterpart` — never through
  // `importRows`) sits BETWEEN May and April in the ledger, but never stamps
  // `balanceSetAt`, so it is not a boundary: April's full net still counts.
  it('an ordinary manual row (an exchange leg) is never a boundary: May, an exchange on 5 Jun, then April all count', async () => {
    const holding = { ...baseHolding };
    const store: OrderedStoreRow[] = [];

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -1_000, time: MAY_15, source: 'import' }],
    });

    // The 5 Jun exchange leg itself: a real `source: 'manual'` ledger row,
    // applied directly here (as `recordExchange` would) rather than through
    // `importRows`, which never sees it.
    holding.balanceMinorUnits -= 500;
    store.push({ time: JUN_5, source: 'manual', externalId: null });

    mockTx = makeOrderedImportTx({ holding, account: unsyncedAccount, store });
    await transactionsRepo.importRows({
      holdingId: 'hold-1',
      rows: [{ holdingId: 'hold-1', amountMinorUnits: -2_000, time: APRIL_15, source: 'import' }],
    });

    // -1_000 (May) + -500 (the 5 Jun exchange) + -2_000 (April) = -3_500 —
    // April counts in full because the exchange leg never stamped
    // `balanceSetAt`; no boundary was ever established.
    expect(holding.balanceMinorUnits).toBe(-3_500);
  });
});

// N1 (round-1 re-review): `accountsRepo.createCashAccount`'s typed starting
// balance IS a hand-set balance, the same as `holdingsRepo.create`'s — it
// must stamp `balanceSetAt` too, or an import-only-looking holding (never
// touched through `holdingsRepo`) loses its boundary. This is a real
// cross-repo integration test — it drives BOTH real `accountsRepo` and
// `transactionsRepo` functions against one shared, mutable store — rather
// than simulating the pre-condition, because the bug was exactly that
// `createCashAccount` DIDN'T do what its sibling create path does.
describe('createCashAccount + importRows integration (N1)', () => {
  type IntegrationStore = {
    accounts: Record<string, unknown>[];
    holdings: Record<string, unknown>[];
    transactions: Record<string, unknown>[];
  };

  const keyOf = (table: unknown): keyof IntegrationStore => {
    if (table === accounts) {
      return 'accounts';
    }

    return table === holdings ? 'holdings' : 'transactions';
  };

  /** Serves BOTH `accountsRepo.createCashAccount` (a bare `nextSortOrder`
   * select, three single-row inserts) and `transactionsRepo.importRows`
   * (`.where().limit(1)` reads, the sync-boundary aggregate, the dedup
   * upsert, the balance update) against one shared `store` — the two real
   * repos see each other's writes, the way two real app actions would. */
  const makeIntegrationTx = (store: IntegrationStore) => {
    const resolveRows = (rows: unknown[]) =>
      Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows) });

    return {
      select: (fields?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          // `nextSortOrder` (accounts.repo.ts): a bare, un-`.where()`'d
          // `select({ value }).from(accounts)`.
          if (table === accounts && fields && 'value' in fields) {
            return Promise.resolve([{ value: -1 }]);
          }

          if (table === transactions && fields && 'time' in fields) {
            const syncTimes = store.transactions
              .filter((row) => row.source !== 'manual' && row.source !== 'import')
              .map((row) => row.time as number);

            return {
              where: () =>
                resolveRows(syncTimes.length > 0 ? [{ time: Math.max(...syncTimes) }] : []),
            };
          }

          return { where: () => resolveRows(store[keyOf(table)]) };
        },
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
          if (Array.isArray(values)) {
            return {
              onConflictDoUpdate: async () => {
                store.transactions.push(...values);
              },
            };
          }

          // A real SQLite `holdings` row column with no explicit value on
          // INSERT reads back as `null` (its schema default), never
          // `undefined` — normalize here so a fix that OMITS `balanceSetAt`
          // entirely (rather than passing `null`) still red-fails.
          store[keyOf(table)].push(table === holdings ? { balanceSetAt: null, ...values } : values);

          return Promise.resolve();
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            if (table === holdings) {
              store.holdings = store.holdings.map((row) => ({ ...row, ...values }));
            }
          },
        }),
      }),
    };
  };

  it('a cash account created with a typed starting balance keeps it after importing an OLDER statement', async () => {
    const store: IntegrationStore = { accounts: [], holdings: [], transactions: [] };

    mockTx = makeIntegrationTx(store);
    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalanceMinorUnits: 5_000,
    });

    const holdingId = store.holdings[0].id as string;

    mockTx = makeIntegrationTx(store);
    const imported = await transactionsRepo.importRows({
      holdingId,
      rows: [
        {
          holdingId,
          amountMinorUnits: -1_000,
          time: Date.UTC(2020, 0, 1),
          source: 'import',
        },
      ],
    });

    // The older statement's row still inserts as real ledger history, but
    // `createCashAccount`'s own typed starting balance already set
    // `balanceSetAt`, so it lands as history and moves nothing.
    expect(imported).toBe(1);
    expect(store.holdings[0].balanceMinorUnits).toBe(5_000);
  });
});
