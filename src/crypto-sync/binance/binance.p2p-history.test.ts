import { DAY_MS } from '@kiko/dates';
import {
  coinListPatchesOf,
  numberMarkWritesOfAnyWalk,
  walkStateFake,
} from '@kiko/test-support/walk-marks';
import type { HoldingRow } from '@kiko/db';
import { createExchangeRun } from '@kiko/crypto-sync/exchange/budget';

import {
  type BinanceP2pHistoryDeps,
  P2P_WINDOW_MS,
  syncBinanceP2pHistory,
} from './binance.p2p-history';
import {
  P2P_CREATED_AT,
  P2P_ORDER_NUMBER,
  p2pOrderOf,
  p2pPageOf,
  p2pServerOf,
} from './binance.p2p-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { HISTORY_FLOOR_MS, RESYNC_OVERLAP_MS } from './binance.transactions';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';
import { type BinanceP2pOrder, BinanceHistoryParseError } from './binance.history-client';
import { type BinanceRunBudget, COSTS, createBinanceHistoryRun } from './binance.history-budget';

const HOUR_MS = 3_600_000;

type Query = { side: string; start: number; end: number; page: number };

type Span = { start: number; end: number };

type AddedRow = {
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  untrackedCounterpart?: string;
  comment?: string;
  operation: string;
};

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case uses its own
// account id.
let accountSequence = 0;

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const FUNDING_HOLDINGS = [
  holdingWith('h-uah-funding', { binanceAsset: 'UAH:funding' }),
  holdingWith('h-usdt-funding', { binanceAsset: 'USDT:funding' }),
];

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

/** A run with no call cap, so a case can read as many requests as it needs in one run. */
const wideRun = () => {
  const budget: BinanceRunBudget = { canAfford: () => true, record: jest.fn() };

  return createExchangeRun({
    intervalMs: 0,
    clock: { now: () => NOW, sleep: async () => undefined },
    budget,
  });
};

/** A connected account with its walk state, and the walk's deps over that one state. */
const worldOf = () => {
  accountSequence += 1;
  const accountId = `acc-p2p-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside: FUNDING_HOLDINGS });
  const depsOf = (over: Partial<BinanceP2pHistoryDeps> = {}): BinanceP2pHistoryDeps => ({
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
    ensureHoldings: jest.fn(async () => undefined),
    addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
    fetchP2pOrders: p2pServerOf([]),
    ...fake.freshDeps(),
    listHoldings: fake.listHoldings,
    ...over,
  });
  const walk = (deps: BinanceP2pHistoryDeps, run = freshRun()) =>
    syncBinanceP2pHistory({ targetAccountId: accountId, run }, deps);

  return { accountId, fake, depsOf, walk };
};

/** A world whose walk is an hour behind, so one run reads the orders of the last hour. */
const recentWorld = () => {
  const world = worldOf();

  world.fake.seed('p2p', { cursor: NOW - HOUR_MS });

  return world;
};

const HEAD_START = NOW - P2P_WINDOW_MS;

// The overlap day behind the head belongs to the re-scan, so the owed ground ends a day before it.
const OWED_END = HEAD_START - RESYNC_OVERLAP_MS;

// The walk builds the owed windows from the end of the owed ground, so a window's place from the
// top (1 is the newest) fixes its span whatever the ground below it is.
const owedWindowOf = (rank: number): Span => ({
  start: OWED_END - rank * P2P_WINDOW_MS,
  end: OWED_END - (rank - 1) * P2P_WINDOW_MS,
});

const queriesOf = (deps: BinanceP2pHistoryDeps): Query[] =>
  (deps.fetchP2pOrders as jest.Mock).mock.calls.map(
    ([, , side, span, page]) => ({ side, start: span.start, end: span.end, page }) as Query,
  );

const addedRows = (deps: BinanceP2pHistoryDeps): AddedRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap(([rows]) => rows as AddedRow[]);

const cursorOf = (world: ReturnType<typeof worldOf>) => world.fake.marksOf('p2p').cursor;

const pendingOf = (world: ReturnType<typeof worldOf>): unknown[] =>
  (world.fake.marksOf('p2p').pending as unknown[] | undefined) ?? [];

const pointOf = (time: number, series: string) => ({
  start: time - 1,
  end: time + 1,
  kind: 'point',
  series,
  since: NOW,
});

let warn: jest.SpyInstance;

const stopCodes = (): string[] => warn.mock.calls.map(([, detail]) => detail.code);

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

const OPEN_STATUSES = ['PENDING', 'TRADING', 'BUYER_PAYED', 'DISTRIBUTING', 'IN_APPEAL'];

describe('a run that does not start', () => {
  it('makes no request while the account is cooling down', async () => {
    const { accountId, depsOf, walk } = worldOf();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const deps = depsOf();

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchP2pOrders).not.toHaveBeenCalled();
  });

  it('reads nothing while the account is cooling down, not even its credentials or its marks', async () => {
    const { accountId, depsOf, walk } = worldOf();
    setBinanceCooldownUntil(accountId, NOW + 60_000);
    const readCredentials = jest.fn(async () => ({ apiKey: 'api-key', secret: 'secret' }));
    const deps = depsOf({ readCredentials });

    await walk(deps);

    expect(readCredentials).not.toHaveBeenCalled();
    expect(deps.readExchangeState).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
  });

  it('makes no request without credentials and reports complete', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ readCredentials: async () => undefined });

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(deps.fetchP2pOrders).not.toHaveBeenCalled();
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['a state of another version', '{"version":2,"walks":{}}'],
  ])('rejects before it reads Binance or writes the state, for %s', async (_label, text) => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ readExchangeState: async () => text });

    await expect(walk(deps)).rejects.toMatchObject({ code: 'exchange-state-malformed' });

    expect(deps.fetchP2pOrders).not.toHaveBeenCalled();
    expect(deps.patchExchangeState).not.toHaveBeenCalled();
  });

  it('reads nothing and reports unfinished when the clock stands at the history floor', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf({ now: () => HISTORY_FLOOR_MS });

    const result = await walk(deps);

    expect(result).toEqual({ imported: 0, complete: false });
    expect(deps.fetchP2pOrders).not.toHaveBeenCalled();
  });
});

describe('the P2P walk windows', () => {
  it('reads the 30-day head window first, then the owed windows behind it newest first, both sides of each', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf();

    await walk(deps);

    const queries = queriesOf(deps);
    expect(queries).toHaveLength(20);
    expect(queries.map(({ side }) => side)).toEqual(
      Array.from({ length: 10 }, () => ['BUY', 'SELL']).flat(),
    );
    expect(queries.slice(0, 2).map(({ start, end }) => [start, end])).toEqual([
      [HEAD_START, NOW],
      [HEAD_START, NOW],
    ]);
    expect(
      queries
        .slice(2, 18)
        .filter(({ side }) => side === 'BUY')
        .map(({ start, end }) => [start, end]),
    ).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => [owedWindowOf(rank).start, owedWindowOf(rank).end]),
    );
    expect(queries.slice(18).map(({ start, end }) => [start, end])).toEqual([
      [HEAD_START - RESYNC_OVERLAP_MS, HEAD_START],
      [HEAD_START - RESYNC_OVERLAP_MS, HEAD_START],
    ]);
    expect(queries.every(({ page }) => page === 1)).toBe(true);
  });

  it('reads every empty window behind the head and imports an order behind eight of them on the second run', async () => {
    const world = worldOf();
    const ninth = p2pOrderOf({ createTime: owedWindowOf(9).start + 5 * DAY_MS });
    const first = world.depsOf({ fetchP2pOrders: p2pServerOf([ninth]) });

    await world.walk(first);

    const windowsRead = (deps: BinanceP2pHistoryDeps, side: string) =>
      queriesOf(deps)
        .filter((query) => query.side === side)
        .map(({ start }) => start);

    expect(windowsRead(first, 'BUY')).toEqual(
      expect.arrayContaining([1, 2, 3, 4, 5, 6, 7, 8].map((rank) => owedWindowOf(rank).start)),
    );
    expect(windowsRead(first, 'SELL')).toEqual(windowsRead(first, 'BUY'));
    expect(windowsRead(first, 'BUY')).not.toContain(owedWindowOf(9).start);
    expect(addedRows(first)).toHaveLength(0);

    const second = world.depsOf({ fetchP2pOrders: p2pServerOf([ninth]) });

    await world.walk(second);

    expect(windowsRead(second, 'BUY')[0]).toBe(owedWindowOf(9).start);
    expect(addedRows(second)).toHaveLength(1);
    expect(world.fake.notImported()).toEqual([]);
  });
});

describe('a first walk of the shape of an account with 113 windows', () => {
  const FIRST = p2pOrderOf({
    orderNumber: 'first',
    createTime: HISTORY_FLOOR_MS + 74 * P2P_WINDOW_MS + 5 * DAY_MS,
  });
  const NEWEST = p2pOrderOf({ orderNumber: 'newest', createTime: NOW - 2 * DAY_MS });

  const walkRuns = async (count: number) => {
    const world = worldOf();
    const runs: { deps: BinanceP2pHistoryDeps; ids: string[]; complete: boolean }[] = [];

    for (let run = 0; run < count; run += 1) {
      const deps = world.depsOf({ fetchP2pOrders: p2pServerOf([FIRST, NEWEST]) });
      const { complete } = await world.walk(deps);

      runs.push({ deps, complete, ids: addedRows(deps).map(({ externalId }) => externalId) });
    }

    return runs;
  };

  it('puts the first order in window 75 and the newest in window 113 of 113', () => {
    const windowOf = (time: number) => Math.floor((time - HISTORY_FLOOR_MS) / P2P_WINDOW_MS) + 1;

    expect(windowOf(FIRST.createTime)).toBe(75);
    expect(windowOf(NEWEST.createTime)).toBe(113);
    expect(Math.ceil((NOW - HISTORY_FLOOR_MS) / P2P_WINDOW_MS)).toBe(113);
  });

  // The first order sits 38 owed windows from the top; the pending pass enters at least 8 windows a
  // run, so its run is at most the fifth. A bound, not the measured run.
  it('imports the newest order on run 1 and the first UA-1 order by run 5 at the lane cap', async () => {
    const runs = await walkRuns(13);
    const importedAt = (orderNumber: string) =>
      runs.findIndex(({ ids }) => ids.some((id) => id.includes(`:p2p:${orderNumber}:`))) + 1;

    expect(importedAt('newest')).toBe(1);
    expect(importedAt('first')).toBeGreaterThan(1);
    expect(importedAt('first')).toBeLessThanOrEqual(5);
    expect(runs.every(({ deps }) => queriesOf(deps).length <= 20)).toBe(true);
  });

  it('spends the whole lane on each of the first 11 runs and reports none of them finished', async () => {
    const runs = (await walkRuns(12)).slice(0, 11);

    expect(runs.map(({ deps }) => queriesOf(deps).length)).toEqual(runs.map(() => 20));
    expect(runs.map(({ complete }) => complete)).toEqual(runs.map(() => false));
  });

  it('reads the whole ground on both sides, newest first behind the head, before it is current', async () => {
    const runs = await walkRuns(14);
    const oldestStartOf = ({ deps }: (typeof runs)[number]) =>
      Math.min(...queriesOf(deps).map(({ start }) => start));
    const oldestStarts = runs.map(oldestStartOf);
    const reachedFloor = oldestStarts.findIndex((start) => start <= HISTORY_FLOOR_MS);

    expect(queriesOf(runs[0].deps)[0]).toMatchObject({ start: HEAD_START, end: NOW });
    expect(reachedFloor).toBeGreaterThan(0);
    expect(oldestStarts.slice(0, reachedFloor + 1)).toEqual(
      [...oldestStarts.slice(0, reachedFloor + 1)].sort((left, right) => right - left),
    );
    expect(new Set(oldestStarts.slice(0, reachedFloor + 1)).size).toBe(reachedFloor + 1);

    for (const side of ['BUY', 'SELL']) {
      const spans = runs
        .flatMap(({ deps }) => queriesOf(deps))
        .filter((query) => query.side === side)
        .sort((left, right) => left.start - right.start);
      let covered = HISTORY_FLOOR_MS;

      for (const { start, end } of spans) {
        if (start <= covered) {
          covered = Math.max(covered, end);
        }
      }

      expect(covered).toBeGreaterThanOrEqual(NOW);
    }
  });
});

describe('when the P2P walk is current', () => {
  it('reports complete once every window up to now is read and nothing is owed', async () => {
    const { depsOf, walk } = recentWorld();

    const result = await walk(depsOf());

    expect(result.complete).toBe(true);
  });

  it('reports unfinished while an order that waits is owed', async () => {
    const { depsOf, walk } = recentWorld();

    const result = await walk(
      depsOf({ fetchP2pOrders: p2pServerOf([p2pOrderOf({ orderStatus: 'TRADING' })]) }),
    );

    expect(result.complete).toBe(false);
  });
});

describe('what the P2P walk imports', () => {
  it('imports a completed taker buy on the Funding holding with the total as its marker', async () => {
    const world = recentWorld();
    const deps = world.depsOf({ fetchP2pOrders: p2pServerOf([p2pOrderOf()]) });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-usdt-funding',
        amountMinorUnits: 9_990_000_000,
        time: P2P_CREATED_AT,
        source: 'binance',
        externalId: `${world.accountId}:p2p:${P2P_ORDER_NUMBER}:USDT:funding`,
        description: '',
        comment: '4150 UAH',
        untrackedCounterpart: 'p2p:UAH:4150.00',
        operation: 'p2p',
      },
    ]);
    expect(cursorOf(world)).toBe(NOW);
  });

  it('imports the buys of a window whose sale series is empty', async () => {
    const world = recentWorld();
    const deps = world.depsOf({ fetchP2pOrders: p2pServerOf([p2pOrderOf()]) });

    await world.walk(deps);

    expect(queriesOf(deps).map(({ side }) => side)).toContain('SELL');
    expect(addedRows(deps)).toHaveLength(1);
    expect(world.fake.notImported()).toEqual([]);
    expect(pendingOf(world)).toEqual([]);
  });

  it('counts an asset Kiko does not track, lists its ticker and writes no row', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf({ asset: 'XYZ' })]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(0);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
    expect(cursorOf(world)).toBe(NOW);
  });

  it('writes a sale, an advertiser order and an unrecognized one as entries, and goes past them', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([
        p2pOrderOf({ orderNumber: 'sale', tradeType: 'SELL' }),
        p2pOrderOf({ orderNumber: 'maker', advertisementRole: 'MAKER' }),
        p2pOrderOf({ orderNumber: 'odd', orderStatus: 'REFUNDED' }),
        p2pOrderOf({ orderNumber: 'amount', takerAmount: '99.8' }),
      ]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(0);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect([...world.fake.notImported()].sort()).toEqual(
      [
        `p2p-advertiser:maker:${P2P_CREATED_AT}`,
        `p2p-amount:amount:${P2P_CREATED_AT}`,
        `p2p-sale:sale:${P2P_CREATED_AT}`,
        `p2p-unrecognized:odd:${P2P_CREATED_AT}`,
      ].sort(),
    );
    expect(cursorOf(world)).toBe(NOW);
    expect(pendingOf(world)).toEqual([]);
  });

  it.each([
    ['a blank fiat', ''],
    ['a fiat that holds the separator', 'U:AH'],
  ])('lists a buy with %s as not recognized and owes no point', async (_name, fiat) => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf({ orderNumber: 'odd-fiat', fiat })]),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([`p2p-unrecognized:odd-fiat:${P2P_CREATED_AT}`]);
    expect(cursorOf(world)).toBe(NOW);
    expect(pendingOf(world)).toEqual([]);
  });

  it('writes nothing for a cancelled order', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([
        p2pOrderOf({ orderNumber: 'c1', orderStatus: 'CANCELLED', takerCommission: '0.5' }),
        p2pOrderOf({ orderNumber: 'c2', orderStatus: 'CANCELLED_BY_SYSTEM', tradeType: 'SELL' }),
      ]),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([]);
    expect(pendingOf(world)).toEqual([]);
  });

  it('keeps one entry when the re-scan reads a listed sale again', async () => {
    const world = recentWorld();
    const sale = p2pOrderOf({ tradeType: 'SELL' });

    await world.walk(world.depsOf({ fetchP2pOrders: p2pServerOf([sale]) }));
    const second = world.depsOf({ fetchP2pOrders: p2pServerOf([sale]) });
    await world.walk(second);

    const reads = queriesOf(second).filter(
      ({ side, start, end }) => side === 'SELL' && start <= P2P_CREATED_AT && P2P_CREATED_AT <= end,
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(world.fake.notImported()).toEqual([`p2p-sale:${P2P_ORDER_NUMBER}:${P2P_CREATED_AT}`]);
  });

  it('stops at a total with a digit past the fiat scale and owes its point', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([
        p2pOrderOf({ orderNumber: 'precise', totalPrice: '4150.001' }),
        p2pOrderOf({ orderNumber: 'fine', createTime: P2P_CREATED_AT + 1_000 }),
      ]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:p2p:fine:USDT:funding`,
    ]);
    expect(pendingOf(world)).toContainEqual(pointOf(P2P_CREATED_AT, 'BUY'));
    expect(cursorOf(world)).toBe(NOW);
    expect(stopCodes()).toContain('amount-precision');
  });

  it('lists the coin of an amount past the safe integer as oversized, and owes the point', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf({ takerAmount: '90071992.54740992' })]),
    });

    await world.walk(deps);

    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'oversizedCoins', list: 'history', tickers: ['USDT'] },
    ]);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(pendingOf(world)).toContainEqual(pointOf(P2P_CREATED_AT, 'BUY'));
  });

  it('owes the point of an order whose holding cannot be resolved, naming that stop', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      listHoldings: async () => [],
      fetchP2pOrders: p2pServerOf([p2pOrderOf()]),
    });

    await world.walk(deps);

    expect(stopCodes()).toEqual(['p2p-holding-missing']);
    expect(deps.addTransactions).not.toHaveBeenCalled();
  });
});

describe('an order that waits on Binance', () => {
  it.each(OPEN_STATUSES)(
    'owes the point of a buy in %s and imports it once a later read sees it completed',
    async (orderStatus) => {
      const world = recentWorld();

      const first = world.depsOf({
        fetchP2pOrders: p2pServerOf([p2pOrderOf({ orderStatus })]),
      });
      await world.walk(first);

      expect(first.addTransactions).not.toHaveBeenCalled();
      expect(pendingOf(world)).toContainEqual(pointOf(P2P_CREATED_AT, 'BUY'));
      expect(cursorOf(world)).toBe(NOW);
      expect(stopCodes()).toContain('p2p-not-settled');

      const second = world.depsOf({ fetchP2pOrders: p2pServerOf([p2pOrderOf()]) });
      await world.walk(second);

      expect(new Set(addedRows(second).map(({ externalId }) => externalId)).size).toBe(1);
      expect(pendingOf(world)).toEqual([]);
    },
  );

  it('owes an open sale and lists it once it is completed', async () => {
    const world = recentWorld();

    const first = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf({ tradeType: 'SELL', orderStatus: 'TRADING' })]),
    });
    await world.walk(first);

    expect(world.fake.notImported()).toEqual([]);
    expect(pendingOf(world)).toContainEqual(pointOf(P2P_CREATED_AT, 'SELL'));

    const second = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf({ tradeType: 'SELL' })]),
    });
    await world.walk(second);

    expect(world.fake.notImported()).toEqual([`p2p-sale:${P2P_ORDER_NUMBER}:${P2P_CREATED_AT}`]);
    expect(pendingOf(world)).toEqual([]);
    expect(second.addTransactions).not.toHaveBeenCalled();
  });

  it('still imports the other orders of the window of an order that waits', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([
        p2pOrderOf({ orderNumber: 'waits', orderStatus: 'TRADING' }),
        p2pOrderOf({ orderNumber: 'done', createTime: P2P_CREATED_AT + 1_000 }),
      ]),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(cursorOf(world)).toBe(NOW);
  });
});

describe('an order the client cannot read', () => {
  it('owes the point of an order it cannot read and imports the rest of its window', async () => {
    const world = recentWorld();
    const server = p2pServerOf([
      p2pOrderOf({ orderNumber: 'good', createTime: P2P_CREATED_AT + 1_000 }),
    ]);
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(
        async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
          const found = await server(apiKey, secret, side, span, page);
          const holdsBroken = side === 'BUY' && span.start <= P2P_CREATED_AT;

          return holdsBroken && P2P_CREATED_AT <= span.end
            ? {
                ...found,
                unreadable: [{ time: P2P_CREATED_AT }],
                gathered: found.gathered + 1,
                total: found.total + 1,
              }
            : found;
        },
      ),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(pendingOf(world)).toContainEqual(pointOf(P2P_CREATED_AT, 'BUY'));
    expect(cursorOf(world)).toBe(NOW);
    expect(stopCodes()).toContain('p2p-order-unreadable');
  });

  it('holds the walk at the window of an unreadable order with no time', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(async () =>
        p2pPageOf([], { unreadable: [{ time: undefined }], gathered: 1, total: 1 }),
      ),
    });

    const result = await world.walk(deps);

    expect(result.complete).toBe(false);
    expect(cursorOf(world)).toBe(NOW - HOUR_MS);
    expect(stopCodes()).toContain('p2p-order-unreadable');
  });
});

describe('a side with more orders than a page shows', () => {
  it('reads the first half of the span instead', async () => {
    const { depsOf, walk } = recentWorld();
    const fetchP2pOrders = jest
      .fn()
      .mockResolvedValueOnce(p2pPageOf([], { gathered: 100, total: 150 }))
      .mockResolvedValue(p2pPageOf());
    const deps = depsOf({ fetchP2pOrders });

    await walk(deps);

    const [whole, half] = queriesOf(deps);
    expect(half).toMatchObject({ side: 'BUY', start: whole.start });
    expect(half.end).toBe(whole.start + Math.floor((whole.end - whole.start) / 2));
  });
});

describe('a start Binance refuses', () => {
  const KEPT_MS = 100 * DAY_MS;

  const keeping = (orders: BinanceP2pOrder[]) => {
    const server = p2pServerOf(orders);

    return jest.fn(
      async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
        if (span.start < NOW - KEPT_MS) {
          throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
        }

        return server(apiKey, secret, side, span, page);
      },
    );
  };

  it('narrows a start Binance refuses as too old and walks on, newest first behind the head', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: NOW - 120 * DAY_MS });
    const deps = world.depsOf({
      fetchP2pOrders: keeping([
        p2pOrderOf({ orderNumber: 'refused', createTime: NOW - 110 * DAY_MS }),
        p2pOrderOf({ orderNumber: 'kept', createTime: NOW - 50 * DAY_MS }),
        p2pOrderOf({ orderNumber: 'newest', createTime: NOW - 10 * DAY_MS }),
      ]),
    });

    await world.walk(deps, wideRun());

    expect(queriesOf(deps)[0]).toMatchObject({ start: HEAD_START, end: NOW });
    expect(
      addedRows(deps)
        .map(({ externalId }) => externalId)
        .sort(),
    ).toEqual([
      `${world.accountId}:p2p:kept:USDT:funding`,
      `${world.accountId}:p2p:newest:USDT:funding`,
    ]);
    expect(cursorOf(world)).toBe(NOW);
    expect(pendingOf(world)).toEqual([]);
    expect(stopCodes()).toEqual([]);
  });

  it('keeps the window and the cursor on any other refusal code and reads it again next run', async () => {
    const world = recentWorld();
    const failing = world.depsOf({
      fetchP2pOrders: jest.fn(async () => {
        throw new Error('Binance request failed: 400: -1127');
      }),
    });

    await expect(world.walk(failing)).rejects.toThrow('-1127');

    const next = world.depsOf({ fetchP2pOrders: p2pServerOf([p2pOrderOf()]) });
    const result = await world.walk(next);

    expect(queriesOf(next)[0].start).toBe(NOW - HOUR_MS);
    expect(cursorOf(world)).toBe(NOW);
    expect(result.imported).toBe(1);
  });
});

describe('a window whose page cannot be read', () => {
  const CURSOR_AT = NOW - 45 * DAY_MS;
  const EARLY = p2pOrderOf({ orderNumber: 'early', createTime: NOW - 40 * DAY_MS });
  const LATE = p2pOrderOf({ orderNumber: 'late', createTime: NOW - 10 * DAY_MS });

  const unreadableHeadWindow = (orders: BinanceP2pOrder[]) => {
    const server = p2pServerOf(orders);

    return jest.fn(
      async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
        if (span.start >= HEAD_START) {
          throw new BinanceHistoryParseError();
        }

        return server(apiKey, secret, side, span, page);
      },
    );
  };

  const worldBehind = () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: CURSOR_AT });

    return world;
  };

  it('rejects the walk, moves no mark past the head window and still writes the rows of the owed ground when its page cannot be read', async () => {
    const world = worldBehind();
    const deps = world.depsOf({ fetchP2pOrders: unreadableHeadWindow([EARLY, LATE]) });

    await expect(world.walk(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);

    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:p2p:early:USDT:funding`,
    ]);
    expect(cursorOf(world)).toBe(HEAD_START);
    expect(Math.max(...numberMarkWritesOfAnyWalk(deps))).toBe(HEAD_START);
  });

  it('reads a head window whose page cannot be read again on every run, never passing it', async () => {
    const world = worldBehind();
    const runs: BinanceP2pHistoryDeps[] = [];

    for (let run = 0; run < 3; run += 1) {
      const deps = world.depsOf({ fetchP2pOrders: unreadableHeadWindow([EARLY, LATE]) });

      runs.push(deps);
      await expect(world.walk(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);
    }

    expect(runs.map((deps) => queriesOf(deps)[0].start)).toEqual([
      HEAD_START,
      HEAD_START,
      HEAD_START,
    ]);
    expect(runs.map((deps) => addedRows(deps).length)).toEqual([1, 0, 0]);
    expect(cursorOf(world)).toBe(HEAD_START);
  });
});

describe('a failure of the P2P walk', () => {
  it('writes the windows read before the limit, sets the cooldown and resolves', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: NOW - 75 * DAY_MS });
    const server = p2pServerOf([p2pOrderOf({ orderNumber: 'one', createTime: NOW - 5 * DAY_MS })]);
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(
        async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
          if (side === 'SELL' && span.start === owedWindowOf(1).start) {
            throw new BinanceRateLimitError(429, 30_000);
          }

          return server(apiKey, secret, side, span, page);
        },
      ),
    });

    const result = await world.walk(deps);

    expect(result).toEqual({ imported: 1, complete: false });
    expect(cursorOf(world)).toBe(NOW);
    expect(isBinanceCoolingDown(world.accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(world.accountId, NOW + 30_000)).toBe(false);
  });

  it('moves no mark past a window whose rows fail to write and rethrows', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: p2pServerOf([p2pOrderOf()]),
      addTransactions: jest.fn(async () => {
        throw new Error('the rows could not be written');
      }),
    });

    await expect(world.walk(deps)).rejects.toThrow('the rows could not be written');

    expect(cursorOf(world)).toBe(NOW - HOUR_MS);
    expect(numberMarkWritesOfAnyWalk(deps)).toEqual([]);
  });

  it('does not set a cooldown on a failure that is not a rate limit', async () => {
    const world = worldOf();
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(async () => {
        throw new Error('Binance request failed: 403');
      }),
    });

    await expect(world.walk(deps, wideRun())).rejects.toThrow('403');
    expect(isBinanceCoolingDown(world.accountId, NOW)).toBe(false);
  });
});

describe('the P2P walk and its budget', () => {
  const spend = (run: ReturnType<typeof freshRun>, calls: number): void => {
    for (let call = 0; call < calls; call += 1) {
      run.budget.record('p2p', { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
    }
  };

  it('reads both sides of a window or neither', async () => {
    // [calls the lane has left, windows read with both sides]
    const rooms = [
      [20, 10],
      [4, 2],
      [3, 1],
      [2, 1],
      [1, 0],
      [0, 0],
    ];

    for (const [room, windows] of rooms) {
      const { depsOf, walk } = worldOf();
      const deps = depsOf();
      const run = freshRun();
      spend(run, 20 - room);

      await walk(deps, run);

      const queries = queriesOf(deps);
      expect(queries.map(({ side }) => side)).toEqual(
        Array.from({ length: windows }, () => ['BUY', 'SELL']).flat(),
      );
      expect(queries.filter(({ side }) => side === 'BUY').map(({ start }) => start)).toEqual(
        queries.filter(({ side }) => side === 'SELL').map(({ start }) => start),
      );
    }
  });

  it('keeps a read of both sides for the re-scan beside the owed ground it reads first', async () => {
    const world = recentWorld();
    world.fake.seed('p2p', { pending: [{ start: NOW - 100 * DAY_MS, end: NOW - 99 * DAY_MS }] });
    const deps = world.depsOf();
    const run = freshRun();
    spend(run, 15);

    await world.walk(deps, run);

    expect(queriesOf(deps).map(({ side, start, end }) => [side, start - NOW, end - NOW])).toEqual([
      ['BUY', -HOUR_MS, 0],
      ['SELL', -HOUR_MS, 0],
      ['BUY', -30 * DAY_MS, -HOUR_MS],
      ['SELL', -30 * DAY_MS, -HOUR_MS],
    ]);
  });

  it('asks for, and records, every call on the p2p lane at the p2p cost', async () => {
    const world = recentWorld();
    const page = p2pPageOf([p2pOrderOf()]);
    const spy = {
      canAfford: jest.fn<boolean, Parameters<BinanceRunBudget['canAfford']>>(() => true),
      record: jest.fn<void, Parameters<BinanceRunBudget['record']>>(),
    };
    const run = createExchangeRun({
      intervalMs: 0,
      clock: { now: () => NOW, sleep: async () => undefined },
      budget: spy,
    });

    await world.walk(world.depsOf({ fetchP2pOrders: jest.fn(async () => page) }), run);

    expect(spy.canAfford.mock.calls.length).toBeGreaterThan(0);
    expect(spy.canAfford.mock.calls.map(([lane, cost]) => [lane, cost])).toEqual(
      spy.canAfford.mock.calls.map(() => ['p2p', COSTS.p2p]),
    );
    expect(spy.record.mock.calls.length).toBeGreaterThan(0);
    expect(spy.record.mock.calls).toEqual(spy.record.mock.calls.map(() => ['p2p', page, false]));
  });

  it('reads no other window once Binance has rate limited it, though the budget has calls left', async () => {
    const world = recentWorld();
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(async () => {
        throw new BinanceRateLimitError(429, 30_000);
      }),
    });

    const result = await world.walk(deps, wideRun());

    expect(queriesOf(deps)).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(isBinanceCoolingDown(world.accountId, NOW + 1_000)).toBe(true);
  });
});

describe('the ground behind the head window, an account whose cursor is older than 30 days', () => {
  const OLD_WINDOWS = 20;
  const OLD_CURSOR = HEAD_START - OLD_WINDOWS * P2P_WINDOW_MS;
  const RUNS = 4;

  const orderInWindow = (rank: number) =>
    p2pOrderOf({
      orderNumber: `window-${rank}`,
      createTime: owedWindowOf(rank).start + 5 * DAY_MS,
    });

  const ranksOf = (deps: BinanceP2pHistoryDeps): number[] =>
    addedRows(deps).map(({ externalId }) =>
      Number(externalId.split(':p2p:window-')[1].split(':')[0]),
    );

  // A read of any span inside a failing window answers a body that is no order envelope.
  const failingIn = (failingRanks: number[], orders: BinanceP2pOrder[]) => {
    const server = p2pServerOf(orders);
    const failing = failingRanks.map(owedWindowOf);

    return jest.fn(
      async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
        if (failing.some(({ start, end }) => span.start >= start && span.end <= end)) {
          throw new BinanceHistoryParseError();
        }

        return server(apiKey, secret, side, span, page);
      },
    );
  };

  const runsOf = async (failingRanks: number[], orderRanks: number[]) => {
    const world = worldOf();

    world.fake.seed('p2p', { cursor: OLD_CURSOR });

    const orders = orderRanks.map(orderInWindow);
    const runs: { deps: BinanceP2pHistoryDeps; rejected: boolean }[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      const deps = world.depsOf({ fetchP2pOrders: failingIn(failingRanks, orders) });
      const rejected = await world.walk(deps).then(
        () => false,
        (error) => {
          expect(error).toBeInstanceOf(BinanceHistoryParseError);

          return true;
        },
      );

      runs.push({ deps, rejected });
    }

    return { world, runs };
  };

  const ranksBetween = (first: number, last: number): number[] =>
    Array.from({ length: last - first + 1 }, (_unused, offset) => first + offset);

  it('writes the owed range, the jump of the cursor and the reset of the range cursor in one write', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: OLD_CURSOR, rangeCursor: owedWindowOf(10).end });
    const deps = world.depsOf();

    await world.walk(deps);

    const [firstWrite] = (deps.patchExchangeState as jest.Mock).mock.calls;
    const patches = firstWrite[1] as { field: string; value: unknown }[];
    const patchValueOf = (name: string): unknown =>
      patches.find(({ field }) => field === name)?.value;

    expect(patches.map(({ field }) => field).sort()).toEqual(['cursor', 'pending', 'rangeCursor']);
    expect(patchValueOf('pending')).toEqual([{ start: OLD_CURSOR, end: HEAD_START }]);
    expect(patchValueOf('cursor')).toBe(HEAD_START);
  });

  it('reads the newest owed window first, whatever range cursor an older build stored', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: OLD_CURSOR, rangeCursor: owedWindowOf(10).end });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(deps)[0]).toMatchObject({ start: HEAD_START, end: NOW });
    expect(queriesOf(deps)[2].start).toBe(owedWindowOf(1).start);
  });

  it('moves past one owed window that fails every run, so the windows behind it import', async () => {
    const { world, runs } = await runsOf([1], ranksBetween(2, OLD_WINDOWS));

    expect(queriesOf(runs[0].deps)[2].start).toBe(owedWindowOf(1).start);
    expect(runs[0].rejected).toBe(true);
    expect(ranksOf(runs[0].deps)).toContain(2);
    expect(queriesOf(runs[1].deps)[0].start).not.toBe(owedWindowOf(1).start);
    expect(runs[RUNS - 1].rejected).toBe(true);
    expect(runs.flatMap(({ deps }) => ranksOf(deps)).sort((left, right) => left - right)).toEqual(
      ranksBetween(2, OLD_WINDOWS),
    );
    expect(pendingOf(world)).toEqual([{ start: owedWindowOf(1).start, end: owedWindowOf(1).end }]);
  });

  it('moves past more failing windows than a run reads, so the windows behind them import', async () => {
    const { world, runs } = await runsOf(ranksBetween(1, 9), ranksBetween(10, OLD_WINDOWS));

    expect(runs.flatMap(({ deps }) => ranksOf(deps)).sort((left, right) => left - right)).toEqual(
      ranksBetween(10, OLD_WINDOWS),
    );
    expect(pendingOf(world)).toEqual([{ start: owedWindowOf(9).start, end: owedWindowOf(1).end }]);
  });
});

describe('a first run after the upgrade, a stored cursor of 2024-01-01 and one owed point', () => {
  const STORED_CURSOR = Date.UTC(2024, 0, 1);
  const POINT_AT = Date.UTC(2023, 5, 1);
  const ORDERS = [
    p2pOrderOf({ orderNumber: 'head', createTime: NOW - 3 * DAY_MS }),
    p2pOrderOf({ orderNumber: 'middle', createTime: Date.UTC(2025, 10, 10) }),
    p2pOrderOf({ orderNumber: 'deep', createTime: Date.UTC(2024, 5, 1) }),
    p2pOrderOf({ orderNumber: 'point', createTime: POINT_AT }),
  ];

  it('reads the head window, keeps the point owed and the old ground in pending, then imports every order once', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: STORED_CURSOR, pending: [pointOf(POINT_AT, 'BUY')] });
    const imported = new Map<string, number>();

    for (let run = 0; run < 8; run += 1) {
      const deps = world.depsOf({ fetchP2pOrders: p2pServerOf(ORDERS) });

      await world.walk(deps);

      for (const { externalId } of addedRows(deps)) {
        imported.set(externalId, (imported.get(externalId) ?? 0) + 1);
      }

      if (run === 0) {
        expect(queriesOf(deps)[0]).toMatchObject({ start: HEAD_START, end: NOW });
        expect(cursorOf(world)).toBe(NOW);
        expect(pendingOf(world)).toContainEqual(pointOf(POINT_AT, 'BUY'));
        expect(pendingOf(world)).toContainEqual(
          expect.objectContaining({ start: STORED_CURSOR, end: expect.any(Number) }),
        );
        expect([...imported.keys()]).toEqual([`${world.accountId}:p2p:head:USDT:funding`]);
      }
    }

    expect(Object.fromEntries(imported)).toEqual(
      Object.fromEntries(
        ORDERS.map(({ orderNumber }) => [`${world.accountId}:p2p:${orderNumber}:USDT:funding`, 1]),
      ),
    );
    expect(pendingOf(world)).toEqual([]);
  });
});
