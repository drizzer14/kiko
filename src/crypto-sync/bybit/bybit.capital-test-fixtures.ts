import type { HoldingRow } from '@kiko/db';
import type { ExchangeHolding } from '@kiko/holdings/repo';
import type { ExchangeStateDeps } from '@kiko/crypto-sync/exchange/walk';

import { createBybitHistoryRun } from './bybit.history-budget';
import { syncBybitCapitalHistory } from './bybit.capital-history';
import { API_KEY, NOW, SECRET, envelopeOf } from './bybit.client-test-fixtures';

export const ACCOUNT_ID = 'acc-1';

export type CapitalSeries = 'deposit' | 'internal' | 'withdraw';

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

const SERIES_OF_PATH: Record<string, CapitalSeries> = {
  '/v5/asset/deposit/query-record': 'deposit',
  '/v5/asset/deposit/query-internal-record': 'internal',
  '/v5/asset/withdraw/query-record': 'withdraw',
};

type PageOrder = 'ascending' | 'descending' | 'scrambled';

type FakeOptions = {
  pageSize?: number;
  order?: PageOrder;
  /** A window that starts inside a second holds the rows of that whole second. */
  secondLevelStart?: boolean;
  /** Answers every call of a series with this code instead of its rows. */
  refuse?: { series: CapitalSeries; retCode: number };
  /** Answers a series with a body that holds no list. */
  malformed?: CapitalSeries;
};

export type SentRead = {
  series: CapitalSeries;
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
 * A Bybit that answers the three capital routes from `world`, a page of `pageSize` rows at a time
 * with the offset as its cursor, and records every read it was sent. The world is changed between
 * runs by assigning its lists.
 */
export const fakeBybit = (options: FakeOptions = {}) => {
  const { pageSize = 50, order = 'ascending', secondLevelStart = false } = options;
  const world: Record<CapitalSeries, ServedRow[]> = { deposit: [], internal: [], withdraw: [] };
  const reads: SentRead[] = [];

  const inWindow = (held: ServedRow, startTime: number, endTime: number): boolean => {
    const from = secondLevelStart ? Math.floor(startTime / 1_000) * 1_000 : startTime;

    return held.at !== undefined && from <= held.at && held.at <= endTime;
  };

  const bodyOf = (series: CapitalSeries, startTime: number, endTime: number, offset: number) => {
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
      rows: held.slice(offset, next).map(({ row }) => row),
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

export const readsOf = (reads: SentRead[], series: CapitalSeries): SentRead[] =>
  reads.filter((read) => read.series === series);

/** A stored row, as the in-memory repository keeps it. */
type StoredCapitalRow = {
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  source: 'bybit';
  externalId: string;
  description: string;
};

type SyncDeps = NonNullable<Parameters<typeof syncBybitCapitalHistory>[1]>;

type WorldOptions = {
  /** The walk state of the account: a `walkStateFake`, made by the test. */
  state: {
    deps: ExchangeStateDeps;
    marksOf: (walkName: 'capital') => Record<string, unknown>;
  };
  fake?: FakeOptions;
  now?: number;
  /** Replaces a dependency of the walk (a page reader, say). */
  overrides?: Partial<SyncDeps>;
};

/**
 * One account's capital walk on a fake Bybit and in-memory repositories: the rows it adds and
 * removes, the holdings it creates, and the walk state it writes.
 */
export const capitalWalkOf = (worldOptions: WorldOptions) => {
  const bybit = fakeBybit(worldOptions.fake);
  const { state } = worldOptions;
  const holdings: HoldingRow[] = [];
  const stored = new Map<string, StoredCapitalRow>();
  const calls: string[] = [];
  const clock = { now: worldOptions.now ?? NOW };

  const deps: SyncDeps = {
    ...state.deps,
    patchExchangeState: jest.fn(
      async (...patch: Parameters<ExchangeStateDeps['patchExchangeState']>) => {
        calls.push('mark');

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
    addTransactions: jest.fn(async (rows: StoredCapitalRow[]) => {
      calls.push('add');

      return rows.filter((row) => {
        const isNew = !stored.has(row.externalId);

        stored.set(row.externalId, row);

        return isNew;
      }).length;
    }),
    removeTransactions: jest.fn(async (externalIds: readonly string[]) => {
      calls.push('remove');

      return externalIds.filter((externalId) => stored.delete(externalId)).length;
    }),
    ...worldOptions.overrides,
  };

  const run = (accountId = ACCOUNT_ID) =>
    syncBybitCapitalHistory(
      {
        targetAccountId: accountId,
        run: createBybitHistoryRun({ now: () => clock.now, sleep: async () => undefined }),
      },
      deps,
    );

  return {
    ...bybit,
    deps,
    clock,
    holdings,
    calls,
    run,
    rows: (): StoredCapitalRow[] => [...stored.values()],
    keys: (): string[] => [...stored.keys()],
    marks: () => state.marksOf('capital'),
  };
};
