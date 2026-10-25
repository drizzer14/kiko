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
import { HISTORY_FLOOR_MS } from './binance.transactions';
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
  it('reads 30-day windows forward from the history floor, oldest first, both sides of each', async () => {
    const { depsOf, walk } = worldOf();
    const deps = depsOf();

    await walk(deps);

    const queries = queriesOf(deps);
    expect(queries).toHaveLength(20);
    expect(queries.map(({ side }) => side)).toEqual(
      Array.from({ length: 10 }, () => ['BUY', 'SELL']).flat(),
    );

    for (const [index, query] of queries.entries()) {
      const window = Math.floor(index / 2);

      expect(query.start).toBe(HISTORY_FLOOR_MS + window * P2P_WINDOW_MS);
      expect(query.end - query.start).toBe(P2P_WINDOW_MS);
      expect(query.page).toBe(1);
    }
  });

  it('reads every empty window and imports an order behind eight of them', async () => {
    const world = worldOf();
    const ninth = p2pOrderOf({ createTime: HISTORY_FLOOR_MS + 8 * P2P_WINDOW_MS + 5 * DAY_MS });
    const deps = world.depsOf({ fetchP2pOrders: p2pServerOf([ninth]) });

    await world.walk(deps);

    const windowsRead = (side: string) => [
      ...new Set(
        queriesOf(deps)
          .filter((query) => query.side === side)
          .map(({ start }) => (start - HISTORY_FLOOR_MS) / P2P_WINDOW_MS),
      ),
    ];

    expect(windowsRead('BUY').slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(windowsRead('SELL').slice(0, 9)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(addedRows(deps)).toHaveLength(1);
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

  it('reaches the first UA-1 order by run 8 and the newest by run 12 at the lane cap', async () => {
    const runs = await walkRuns(13);
    const importedAt = (orderNumber: string) =>
      runs.findIndex(({ ids }) => ids.some((id) => id.includes(`:p2p:${orderNumber}:`))) + 1;

    expect(importedAt('first')).toBe(8);
    expect(importedAt('newest')).toBe(12);
    expect(runs.every(({ deps }) => queriesOf(deps).length <= 20)).toBe(true);
  });

  it('spends the whole lane on each of the first 11 runs and reports none of them finished', async () => {
    const runs = (await walkRuns(12)).slice(0, 11);

    expect(runs.map(({ deps }) => queriesOf(deps).length)).toEqual(runs.map(() => 20));
    expect(runs.map(({ complete }) => complete)).toEqual(runs.map(() => false));
  });

  it('reads each of the 113 windows on both sides, 226 calls, before it is current', async () => {
    const runs = await walkRuns(12);
    const reads = new Set(
      runs.flatMap(({ deps }) =>
        queriesOf(deps)
          .filter(({ start }) => (start - HISTORY_FLOOR_MS) % P2P_WINDOW_MS === 0)
          .map(({ side, start }) => `${side}:${start}`),
      ),
    );

    expect(reads.size).toBe(226);
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

  it('narrows a start Binance refuses as too old and walks on forward', async () => {
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
  const SECOND_WINDOW_START = NOW - 15 * DAY_MS;
  const EARLY = p2pOrderOf({ orderNumber: 'early', createTime: NOW - 40 * DAY_MS });
  const LATE = p2pOrderOf({ orderNumber: 'late', createTime: NOW - 10 * DAY_MS });

  const unreadableSecondWindow = (orders: BinanceP2pOrder[]) => {
    const server = p2pServerOf(orders);

    return jest.fn(
      async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
        if (span.start >= SECOND_WINDOW_START) {
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

  it('rejects the walk, moves no mark past the window and writes none of its rows when its page cannot be read', async () => {
    const world = worldBehind();
    const deps = world.depsOf({ fetchP2pOrders: unreadableSecondWindow([EARLY, LATE]) });

    await expect(world.walk(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);

    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:p2p:early:USDT:funding`,
    ]);
    expect(cursorOf(world)).toBe(SECOND_WINDOW_START);
    expect(Math.max(...numberMarkWritesOfAnyWalk(deps))).toBe(SECOND_WINDOW_START);
  });

  it('reads a window whose page cannot be read again on every run, never passing it', async () => {
    const world = worldBehind();
    const runs: BinanceP2pHistoryDeps[] = [];

    for (let run = 0; run < 3; run += 1) {
      const deps = world.depsOf({ fetchP2pOrders: unreadableSecondWindow([EARLY, LATE]) });

      runs.push(deps);
      await expect(world.walk(deps)).rejects.toBeInstanceOf(BinanceHistoryParseError);
    }

    expect(runs.map((deps) => queriesOf(deps)[0].start)).toEqual([
      CURSOR_AT,
      SECOND_WINDOW_START,
      SECOND_WINDOW_START,
    ]);
    expect(runs.map((deps) => addedRows(deps).length)).toEqual([1, 0, 0]);
    expect(cursorOf(world)).toBe(SECOND_WINDOW_START);
  });
});

describe('a failure of the P2P walk', () => {
  it('writes the windows read before the limit, sets the cooldown and resolves', async () => {
    const world = worldOf();
    world.fake.seed('p2p', { cursor: NOW - 75 * DAY_MS });
    const server = p2pServerOf([p2pOrderOf({ orderNumber: 'one', createTime: NOW - 70 * DAY_MS })]);
    const deps = world.depsOf({
      fetchP2pOrders: jest.fn(
        async (apiKey: string, secret: string, side: 'BUY' | 'SELL', span: Span, page: number) => {
          if (side === 'SELL' && span.start === NOW - 45 * DAY_MS) {
            throw new BinanceRateLimitError(429, 30_000);
          }

          return server(apiKey, secret, side, span, page);
        },
      ),
    });

    const result = await world.walk(deps);

    expect(result).toEqual({ imported: 1, complete: false });
    expect(cursorOf(world)).toBe(NOW - 45 * DAY_MS);
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
