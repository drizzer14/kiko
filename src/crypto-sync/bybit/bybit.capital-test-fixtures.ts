import type { ExchangeHolding } from '@kiko/holdings/repo';
import type { FundingMatchRow, HoldingRow } from '@kiko/db';
import type { ExchangeStateDeps } from '@kiko/crypto-sync/exchange/walk';

import { createBybitHistoryRun } from './bybit.history-budget';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { API_KEY, NOW, SECRET, envelopeOf } from './bybit.client-test-fixtures';

export const ACCOUNT_ID = 'acc-1';

export type CapitalSeries = 'deposit' | 'internal' | 'withdraw';

/** The series the fake serves: the three capital routes, the transfer route and the log. */
export type BybitSeries = CapitalSeries | 'transfer' | 'log';

/**
 * A row the fake exchange holds, and the instant its window test uses for the row: the instant a
 * route filters on, which a test sets apart from the row's own fields. No instant is a row that no
 * window holds.
 */
type ServedRow = { row: Record<string, unknown>; at: number | undefined };

export const served = (at: number | undefined, row: Record<string, unknown>): ServedRow => ({
  row,
  at,
});

const SERIES_OF_PATH: Record<string, BybitSeries> = {
  '/v5/asset/deposit/query-record': 'deposit',
  '/v5/asset/deposit/query-internal-record': 'internal',
  '/v5/asset/withdraw/query-record': 'withdraw',
  '/v5/asset/transfer/query-inter-transfer-list': 'transfer',
  '/v5/account/transaction-log': 'log',
};

type PageOrder = 'ascending' | 'descending' | 'scrambled';

type FakeOptions = {
  pageSize?: number;
  order?: PageOrder;
  /** A window that starts inside a second holds the rows of that whole second. */
  secondLevelStart?: boolean;
  /** Answers every call of a series with this code instead of its rows. */
  refuse?: { series: BybitSeries; retCode: number };
  /** Answers a series with a body that holds no list. */
  malformed?: BybitSeries;
};

export type SentRead = {
  series: BybitSeries;
  startTime: number;
  endTime: number;
  cursor: string | undefined;
};

const SCRAMBLE = 7_919;

// A cursor token no other field of a test can equal, so a test can look for it in stored state.
export const CURSOR_PREFIX = 'next-page-';

const orderedBy = (rows: ServedRow[], order: PageOrder): ServedRow[] => {
  const ascending = [...rows].sort((left, right) => (left.at ?? 0) - (right.at ?? 0));

  if (order === 'descending') {
    return ascending.reverse();
  }

  return order === 'scrambled'
    ? ascending
        .map((row, index) => ({ row, key: (index * SCRAMBLE) % (ascending.length + 1) }))
        .sort((left, right) => left.key - right.key)
        .map(({ row }) => row)
    : ascending;
};

/**
 * A Bybit that answers the three capital routes and the transfer route from `world`, a page of
 * `pageSize` rows at a time with the offset as its cursor, and records every read it was sent. The
 * world is changed between runs by assigning its lists.
 */
export const fakeBybit = (options: FakeOptions = {}) => {
  const { pageSize = 50, order = 'ascending', secondLevelStart = false } = options;
  const world: Record<BybitSeries, ServedRow[]> = {
    deposit: [],
    internal: [],
    withdraw: [],
    transfer: [],
    log: [],
  };
  const reads: SentRead[] = [];

  const inWindow = (held: ServedRow, startTime: number, endTime: number): boolean => {
    const from = secondLevelStart ? Math.floor(startTime / 1_000) * 1_000 : startTime;

    return held.at !== undefined && from <= held.at && held.at <= endTime;
  };

  const bodyOf = (series: BybitSeries, startTime: number, endTime: number, offset: number) => {
    if (options.refuse?.series === series) {
      return envelopeOf(options.refuse.retCode);
    }

    if (options.malformed === series) {
      return envelopeOf(0, {});
    }

    const held = orderedBy(
      world[series].filter((row) => inWindow(row, startTime, endTime)),
      order,
    );
    const next = offset + pageSize;

    return envelopeOf(0, {
      [series === 'transfer' || series === 'log' ? 'list' : 'rows']: held
        .slice(offset, next)
        .map(({ row }) => row),
      nextPageCursor: next < held.length ? `${CURSOR_PREFIX}${next}` : '',
    });
  };

  const fetchImpl = (async (input: string) => {
    const url = new URL(input);
    const series = SERIES_OF_PATH[url.pathname];
    const startTime = Number(url.searchParams.get('startTime'));
    const endTime = Number(url.searchParams.get('endTime'));
    const cursor = url.searchParams.get('cursor') ?? undefined;

    reads.push({ series, startTime, endTime, cursor });

    const offset = cursor === undefined ? 0 : Number(cursor.slice(CURSOR_PREFIX.length));
    const body = bodyOf(series, startTime, endTime, offset);

    return { ok: true, status: 200, headers: new Headers(), json: async () => body };
  }) as unknown as typeof fetch;

  return { world, reads, fetchImpl };
};

export const readsOf = (reads: SentRead[], series: BybitSeries): SentRead[] =>
  reads.filter((read) => read.series === series);

/** The run budget of a walk whose clock a test moves, and whose waits take no time. */
export const historyRunAt = (clock: { now: number }) =>
  createBybitHistoryRun({ now: () => clock.now, sleep: async () => undefined });

/** A stored row, as the in-memory repository keeps it. */
type StoredRow = {
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  source: 'bybit';
  externalId: string;
  description: string;
  exchangePairId?: string;
  exchangeCounterpartHoldingId?: string;
  untrackedCounterpart?: string;
  operation?: string;
};

type WalkWorldOptions = {
  /** The walk state of the account: a `walkStateFake`, made by the test. */
  state: { deps: ExchangeStateDeps };
  fake?: FakeOptions;
  now?: number;
  /**
   * Called before each write that outlives a restart (rows added or removed, marks moved), with
   * the number of writes the world has taken including this one. A test throws here to kill a run
   * just before that write.
   */
  beforeWrite?: (writeNumber: number) => void;
};

/**
 * A fake Bybit and in-memory repositories for one account's history walk: the rows it adds, the
 * holdings it creates, and the walk state it writes. The deps are what every Bybit walk reads
 * through, and a walk adds its own.
 */
export const inMemoryWalkOf = (worldOptions: WalkWorldOptions) => {
  const bybit = fakeBybit(worldOptions.fake);
  const { state } = worldOptions;
  const holdings: HoldingRow[] = [];
  const stored = new Map<string, StoredRow>();
  const sources = new Map<string, FundingMatchRow>();
  const calls: string[] = [];
  // `calls` with the store double's writes in it: the order of a row, its record and the marks.
  const sequence: string[] = [];
  const clock = { now: worldOptions.now ?? NOW };
  let writes = 0;

  const record = (call: 'add' | 'remove' | 'mark'): void => {
    calls.push(call);
    sequence.push(call);
    writes += 1;
    worldOptions.beforeWrite?.(writes);
  };

  const addTransactions = jest.fn(async (rows: StoredRow[]) => {
    record('add');

    return rows.filter((row) => {
      const isNew = !stored.has(row.externalId);

      stored.set(row.externalId, row);

      return isNew;
    }).length;
  });
  const removeTransactions = jest.fn(async (externalIds: readonly string[]) => {
    record('remove');

    return externalIds.filter((externalId) => stored.delete(externalId)).length;
  });
  const writeFundingSources = jest.fn(async (records: FundingMatchRow[]) => {
    sequence.push('source-add');

    for (const row of records) {
      sources.set(row.recordKey, row);
    }
  });
  const removeFundingSources = jest.fn(
    async (_accountId: string, recordKeys: readonly string[]) => {
      sequence.push('source-remove');

      for (const recordKey of recordKeys) {
        sources.delete(recordKey);
      }
    },
  );

  const deps = {
    ...state.deps,
    patchExchangeState: jest.fn(
      async (...patch: Parameters<ExchangeStateDeps['patchExchangeState']>) => {
        record('mark');

        return state.deps.patchExchangeState(...patch);
      },
    ),
    now: () => clock.now,
    fetchImpl: bybit.fetchImpl,
    readCredentials: async () => ({ apiKey: API_KEY, secret: SECRET }),
    listHoldings: async () => holdings,
    ensureHoldings: jest.fn(async (created: ExchangeHolding[]) => {
      for (const holding of created) {
        holdings.push({
          id: `holding-${holding.metadataKey}`,
          accountId: holding.accountId,
          name: holding.name,
          currency: holding.currency,
          balanceMinorUnits: holding.balanceMinorUnits ?? 0,
          metadata: { [holding.metadataField]: holding.metadataKey },
        } as unknown as HoldingRow);
      }
    }),
    addTransactions,
    removeTransactions,
    writeFundingSources,
    removeFundingSources,
    // The store double has no transaction to share: the one `add` and `remove` the walk makes is
    // the row double's call and the record double's call, in the order the real write runs them.
    addRowsAndFundingSources: jest.fn(async (rows: StoredRow[], records: FundingMatchRow[]) => {
      await writeFundingSources(records);

      return addTransactions(rows);
    }),
    removeRowsAndFundingSources: jest.fn(
      async (accountId: string, externalIds: readonly string[]) => {
        const removed = await removeTransactions(externalIds);

        await removeFundingSources(accountId, externalIds);

        return removed;
      },
    ),
  };

  return {
    ...bybit,
    deps,
    clock,
    record,
    holdings,
    calls,
    sequence,
    stored,
    /** The records of the Funding ledger's stored set that the walk wrote, by key. */
    fundingSources: (): FundingMatchRow[] => [...sources.values()],
    rows: (): StoredRow[] => [...stored.values()],
    keys: (): string[] => [...stored.keys()],
  };
};

type SyncDeps = NonNullable<Parameters<typeof syncBybitCapitalHistory>[1]>;

type WorldOptions = WalkWorldOptions & {
  state: { marksOf: (walkName: 'capital') => Record<string, unknown> };
  /** Replaces a dependency of the walk (a page reader, say). */
  overrides?: Partial<SyncDeps>;
};

/**
 * One account's capital walk on the in-memory world: the rows it adds and removes, the holdings
 * it creates, and the walk state it writes.
 */
export const capitalWalkOf = (worldOptions: WorldOptions) => {
  const world = inMemoryWalkOf(worldOptions);
  const { clock } = world;

  const deps = { ...world.deps, ...worldOptions.overrides };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitCapitalHistory({ targetAccountId: accountId, run: historyRunAt(clock) }, deps);

  return {
    ...world,
    deps,
    run,
    marks: () => worldOptions.state.marksOf('capital'),
  };
};
