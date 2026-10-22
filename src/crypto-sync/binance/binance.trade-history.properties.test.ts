import { DAY_MS } from '@kiko/dates';
import {
  type ExchangeStatePatch,
  exchangeStatePatched,
  parseExchangeState,
} from '@kiko/crypto-sync/exchange/walk-state';

import {
  FIRST_FILL_AT,
  type FillServer,
  fillOf,
  fillReadsOf,
  holdingWith,
  listed,
} from './binance.trade-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { NO_WEIGHTS } from './binance.trade-symbols';
import { LANE_CALL_CAPS, createBinanceHistoryRun } from './binance.history-budget';
import { BinanceInvalidSymbolError, BinanceRateLimitError } from './binance.client';
import { type BinanceMyTrade, BinanceHistoryParseError } from './binance.history-client';
import { type BinanceTradeHistoryDeps, syncBinanceTradeHistory } from './binance.trade-history';

/**
 * The trade read driven over random exchanges through `syncBinanceTradeHistory` itself, in runs a
 * clock gap apart. Fills arrive between the runs and, while a run re-reads an order, on that
 * order; the lane has random room left, the page limit is random, one symbol throws in a run and
 * the exchange rate-limits a random request. Once no fill arrives and runs have passed, every
 * order must be stored once per key with the aggregate of all its fills, which the test works out
 * from the units it generated, never from the rows the read wrote.
 */

const HOUR_MS = 3_600_000;
const RUN_GAPS = [0, HOUR_MS, DAY_MS];
const STRESS_RUNS = 5;
const SETTLE_RUNS = 5;
const SEEDS = Array.from({ length: 36 }, (_unused, position) => 30 + position * 11);
const RETRY_AFTER_MS = 30_000;
const MOST_ORDER_NUMBERS = 150;
const FIRST_RUN_FILLS = 6;
const LATER_RUN_FILLS = 3;
const QUANTITY_DIGITS = 8;

type Spec = { symbol: string; baseAsset: string; quoteAsset: string };

const SPECS: Spec[] = [
  { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
  { symbol: 'ETHBTC', baseAsset: 'ETH', quoteAsset: 'BTC' },
  { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
  { symbol: 'PEPEUSDT', baseAsset: 'PEPE', quoteAsset: 'USDT' },
];
const TRACKED = ['BTC', 'ETH', 'USDT', 'BNB'];

/** The decimals each coin's amounts are sent with; BNB is stored one digit short. */
const DIGITS: Record<string, number> = { BTC: 8, ETH: 8, USDT: 8, PEPE: 8, BNB: 7 };

type MadeFill = {
  id: number;
  qtyUnits: number;
  quoteUnits: number;
  commissionUnits: number;
  commissionCoin: string;
};

type MadeOrder = {
  spec: Spec;
  orderId: number;
  isBuyer: boolean;
  open: boolean;
  fills: MadeFill[];
};

type StoredRow = Parameters<BinanceTradeHistoryDeps['addTransactions']>[0][number];

type RowShape = {
  units: number;
  holdingId: string;
  exchangePairId?: string;
  exchangeCounterpartHoldingId?: string;
  untrackedCounterpart?: string;
  operation: string | undefined;
  time: number;
};

/** A seeded generator (Lehmer), so a failing run replays; the first draws are burnt. */
const seededRandom = (seed: number): (() => number) => {
  let state = seed;
  const next = (): number => {
    state = (state * 48_271) % 2_147_483_647;

    return state / 2_147_483_647;
  };

  for (let burnt = 0; burnt < 5; burnt += 1) {
    next();
  }

  return next;
};

const pick = <Item>(random: () => number, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)] as Item;

const textOf = (units: number, digits: number): string => (units / 10 ** digits).toFixed(digits);

const COMMISSION_KINDS = ['base', 'quote', 'BNB', 'BNB'] as const;

const madeFillOf = (random: () => number, spec: Spec, id: number): MadeFill => {
  const qtyUnits = 1_000 + Math.floor(random() * 1_000_000);
  const quoteUnits = 1_000 + Math.floor(random() * 1_000_000_000);
  const kind = pick(random, COMMISSION_KINDS);
  const bound = { base: qtyUnits, quote: quoteUnits, BNB: 200_000 }[kind];

  return {
    id,
    qtyUnits,
    quoteUnits,
    commissionUnits: Math.floor((random() * bound) / 10),
    commissionCoin: { base: spec.baseAsset, quote: spec.quoteAsset, BNB: 'BNB' }[kind],
  };
};

const wireFillOf = (made: MadeFill, order: MadeOrder): BinanceMyTrade =>
  fillOf(made.id, order.orderId, {
    qty: textOf(made.qtyUnits, QUANTITY_DIGITS),
    quoteQty: textOf(made.quoteUnits, QUANTITY_DIGITS),
    commission: textOf(made.commissionUnits, DIGITS[made.commissionCoin] ?? QUANTITY_DIGITS),
    commissionAsset: made.commissionCoin,
    isBuyer: order.isBuyer,
  });

/** The exchange: the fills of each symbol in id order, and the orders they were made into. */
const exchangeOf = (random: () => number) => {
  const server: FillServer = {
    fills: Object.fromEntries(SPECS.map(({ symbol }): [string, BinanceMyTrade[]] => [symbol, []])),
    pageLimit: 1,
  };
  const orders: MadeOrder[] = [];
  const lastIds: Record<string, number> = {};

  const newOrderOf = (spec: Spec): MadeOrder => {
    const taken = new Set(
      orders.filter((order) => order.spec === spec).map(({ orderId }) => orderId),
    );
    let orderId = 1 + Math.floor(random() * MOST_ORDER_NUMBERS);

    while (taken.has(orderId)) {
      orderId = 1 + Math.floor(random() * MOST_ORDER_NUMBERS);
    }

    const order = { spec, orderId, isBuyer: random() < 0.5, open: true, fills: [] };

    orders.push(order);

    return order;
  };

  const fillOrder = (order: MadeOrder): void => {
    const { symbol } = order.spec;
    const id = (lastIds[symbol] ?? 0) + 1 + Math.floor(random() * 3);
    const made = madeFillOf(random, order.spec, id);

    lastIds[symbol] = id;
    order.fills.push(made);
    server.fills[symbol]?.push(wireFillOf(made, order));
    order.open = random() >= 0.4;
  };

  const openOrdersOf = (spec: Spec): MadeOrder[] =>
    orders.filter((order) => order.spec === spec && order.open);

  const arriveOn = (spec: Spec, count: number): void => {
    for (let arrived = 0; arrived < count; arrived += 1) {
      const open = openOrdersOf(spec);

      fillOrder(open.length > 0 && random() < 0.5 ? pick(random, open) : newOrderOf(spec));
    }
  };

  return {
    server,
    orders,
    arrive: (most: number): void => {
      for (const spec of SPECS) {
        arriveOn(spec, Math.floor(random() * (most + 1)));
      }
    },
    fillOpenOrder: (symbol: string, orderId: number): void => {
      const order = orders.find(
        (candidate) => candidate.spec.symbol === symbol && candidate.orderId === orderId,
      );

      if (order?.open) {
        fillOrder(order);
      }
    },
  };
};

const sumOf = (fills: MadeFill[], field: 'qtyUnits' | 'quoteUnits' | 'commissionUnits'): number =>
  fills.reduce((total, fill) => total + fill[field], 0);

const commissionIn = (order: MadeOrder, coin: string): number =>
  sumOf(
    order.fills.filter((fill) => fill.commissionCoin === coin),
    'commissionUnits',
  );

const holdingIdOf = (coin: string): string => `holding-${coin}`;

type Side = { coin: string; units: number };

/** The rows an order comes to, worked out from the units of its fills. */
const expectedRowsOf = (accountId: string, order: MadeOrder): Map<string, RowShape> => {
  const { spec, orderId, isBuyer, fills } = order;
  const pairId = `${accountId}:trade:${spec.symbol}:${orderId}`;
  const [spentCoin, receivedCoin] = isBuyer
    ? [spec.quoteAsset, spec.baseAsset]
    : [spec.baseAsset, spec.quoteAsset];
  const [spentGross, receivedGross] = isBuyer
    ? [sumOf(fills, 'quoteUnits'), sumOf(fills, 'qtyUnits')]
    : [sumOf(fills, 'qtyUnits'), sumOf(fills, 'quoteUnits')];
  const spent: Side = { coin: spentCoin, units: -(spentGross + commissionIn(order, spentCoin)) };
  const received: Side = {
    coin: receivedCoin,
    units: receivedGross - commissionIn(order, receivedCoin),
  };
  const time = FIRST_FILL_AT + (fills[0]?.id ?? 0);
  const rows = new Map<string, RowShape>();
  const rowOf = (side: Side, over: Partial<RowShape>): RowShape => ({
    units: side.units,
    holdingId: holdingIdOf(side.coin),
    operation: 'trade',
    time,
    ...over,
  });

  if (TRACKED.includes(spent.coin) && TRACKED.includes(received.coin)) {
    rows.set(
      `${pairId}:${spent.coin}`,
      rowOf(spent, {
        exchangePairId: pairId,
        exchangeCounterpartHoldingId: holdingIdOf(received.coin),
      }),
    );
    rows.set(
      `${pairId}:${received.coin}`,
      rowOf(received, {
        exchangePairId: pairId,
        exchangeCounterpartHoldingId: holdingIdOf(spent.coin),
      }),
    );
  } else {
    const [tracked, other] = TRACKED.includes(spent.coin) ? [spent, received] : [received, spent];

    rows.set(
      `${pairId}:${tracked.coin}`,
      rowOf(tracked, { untrackedCounterpart: `asset:${other.coin}` }),
    );
  }

  const feeUnits = commissionIn(order, 'BNB');

  if (feeUnits > 0) {
    rows.set(
      `${pairId}:fee:BNB`,
      rowOf(
        { coin: 'BNB', units: -feeUnits },
        {
          exchangePairId: pairId,
          operation: 'trade-fee',
          ...(TRACKED.includes(received.coin)
            ? { exchangeCounterpartHoldingId: holdingIdOf(received.coin) }
            : { untrackedCounterpart: `asset:${received.coin}` }),
        },
      ),
    );
  }

  return rows;
};

/** The store the read writes to: it upserts by key and keeps the first markers of a row. */
const storeOf = () => {
  const stored = new Map<string, StoredRow>();

  return {
    stored,
    importedOrderPrefixes: async (prefixes: string[]): Promise<Set<string>> =>
      new Set(
        prefixes.filter((prefix) => [...stored.keys()].some((key) => key.startsWith(prefix))),
      ),
    addTransactions: async (rows: StoredRow[]): Promise<number> => {
      const created = rows.filter(({ externalId }) => !stored.has(externalId)).length;

      for (const row of rows) {
        const earlier = stored.get(row.externalId);

        stored.set(
          row.externalId,
          earlier === undefined
            ? row
            : { ...earlier, amountMinorUnits: row.amountMinorUnits, time: row.time },
        );
      }

      return created;
    },
  };
};

const stateStoreOf = () => {
  const state = {
    text: JSON.stringify({
      version: 1,
      walks: {},
      untrackedCoins: { balance: [], history: ['PEPE'] },
    }),
  };

  return {
    state,
    readExchangeState: async (): Promise<string> => state.text,
    patchExchangeState: async (
      _accountId: string,
      patches: readonly ExchangeStatePatch[],
    ): Promise<void> => {
      state.text = exchangeStatePatched(state.text, patches) ?? state.text;
    },
  };
};

type RunCounts = {
  requests: number;
  trades: number;
  limited: boolean;
  thrown: boolean;
  reReads: Map<string, number>;
};

/** What the exchange does wrong in a run: a symbol that throws once, a request it limits. */
type Trouble = { thrower: string | undefined; limitedRequest: number };

type World = {
  accountId: string;
  exchange: ReturnType<typeof exchangeOf>;
  random: () => number;
  doomed: string | undefined;
  store: ReturnType<typeof storeOf>;
  stateStore: ReturnType<typeof stateStoreOf>;
};

type RunPlan = { at: number; stress: boolean };

const plansOf = (gapMs: number): RunPlan[] => [
  ...Array.from({ length: STRESS_RUNS }, (_unused, index) => ({
    at: NOW + index * gapMs,
    stress: true,
  })),
  ...Array.from({ length: SETTLE_RUNS }, (_unused, index) => ({
    at: NOW + STRESS_RUNS * gapMs + (index + 1) * DAY_MS,
    stress: false,
  })),
];

const exchangeReadsOf = (
  world: World,
  plan: RunPlan,
  trouble: Trouble,
  counts: RunCounts,
): Pick<BinanceTradeHistoryDeps, 'fetchExchangeSymbols' | 'fetchMyTrades' | 'fetchOrderFills'> => {
  const reads = fillReadsOf(world.exchange.server);
  const request = (): void => {
    counts.requests += 1;

    if (counts.requests === trouble.limitedRequest) {
      counts.limited = true;

      throw new BinanceRateLimitError(429, RETRY_AFTER_MS);
    }
  };

  return {
    fetchExchangeSymbols: async () => {
      request();

      return {
        symbols: SPECS.map(({ symbol, baseAsset, quoteAsset }) =>
          listed(symbol, baseAsset, quoteAsset),
        ),
        unreadable: 0,
        usedApiWeight1m: undefined,
      };
    },
    fetchMyTrades: async (apiKey, secret, symbol, fromId, options) => {
      request();
      counts.trades += 1;

      if (symbol === world.doomed) {
        throw new BinanceHistoryParseError();
      }

      if (symbol === trouble.thrower && !counts.thrown) {
        counts.thrown = true;

        throw new BinanceInvalidSymbolError('Invalid symbol.');
      }

      return reads.fetchMyTrades(apiKey, secret, symbol, fromId, options);
    },
    fetchOrderFills: async (apiKey, secret, symbol, orderId, fromId, options) => {
      request();
      counts.trades += 1;

      if (fromId === 0) {
        const order = `${symbol}:${orderId}`;

        counts.reReads.set(order, (counts.reReads.get(order) ?? 0) + 1);
      }

      const page = await reads.fetchOrderFills(apiKey, secret, symbol, orderId, fromId, options);

      if (plan.stress && world.random() < 0.25) {
        world.exchange.fillOpenOrder(symbol, orderId);
      }

      return page;
    },
  };
};

/**
 * One run of the read, with the assertions that hold for the run alone: no order is read whole
 * twice, the lane's cap holds, and a run inside a cooldown sends nothing while any other asks
 * the symbol list. Returns the rows it imported and whether the exchange limited it.
 */
const playRun = async (
  world: World,
  plan: RunPlan,
  coolingDown: boolean,
): Promise<{ imported: number; limited: boolean }> => {
  const { random, exchange, store, stateStore } = world;
  const spare = plan.stress ? Math.floor(random() * 99) : 0;
  const trouble: Trouble = {
    thrower: plan.stress && random() < 0.4 ? pick(random, SPECS).symbol : undefined,
    limitedRequest: plan.stress && random() < 0.25 ? 1 + Math.floor(random() * 6) : 0,
  };
  const counts: RunCounts = {
    requests: 0,
    trades: 0,
    limited: false,
    thrown: false,
    reReads: new Map(),
  };
  const run = createBinanceHistoryRun({ now: () => plan.at, sleep: async () => undefined });

  exchange.server.pageLimit = (plan.stress ? 1 : 2) + Math.floor(random() * 5);

  for (let used = 0; used < spare; used += 1) {
    run.budget.record('trades', NO_WEIGHTS);
  }

  const result = await syncBinanceTradeHistory(
    {
      targetAccountId: world.accountId,
      run,
      spotBalanceTexts: Object.fromEntries(
        TRACKED.map((coin) => [coin, `${1 + Math.floor(random() * 3)}/0`]),
      ),
    },
    {
      now: () => plan.at,
      pageLimit: exchange.server.pageLimit,
      readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
      listHoldings: async () => TRACKED.map(holdingWith),
      ensureHoldings: async () => undefined,
      readExchangeState: stateStore.readExchangeState,
      patchExchangeState: stateStore.patchExchangeState,
      importedOrderPrefixes: store.importedOrderPrefixes,
      addTransactions: store.addTransactions,
      ...exchangeReadsOf(world, plan, trouble, counts),
    },
  );

  expect([...counts.reReads].filter(([, reads]) => reads > 1)).toEqual([]);
  expect(counts.trades).toBeLessThanOrEqual(LANE_CALL_CAPS.trades - spare);

  if (coolingDown) {
    expect(counts.requests).toBe(0);
  } else {
    expect(counts.requests).toBeGreaterThanOrEqual(1);
  }

  return { imported: result.imported, limited: counts.limited };
};

const ownerOf = (order: MadeOrder): string => `${order.spec.symbol}:${order.orderId}`;

const shapeOf = (row: StoredRow): RowShape => ({
  units: row.amountMinorUnits,
  holdingId: row.holdingId,
  exchangePairId: row.exchangePairId,
  exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId,
  untrackedCounterpart: row.untrackedCounterpart,
  operation: row.operation,
  time: row.time,
});

/** The orders each pair id is found on, by the order the test generated each row key for. */
const ownersByPairOf = (
  stored: ReadonlyMap<string, StoredRow>,
  ownerOfKey: ReadonlyMap<string, string>,
): Map<string, Set<string>> => {
  const owners = new Map<string, Set<string>>();

  for (const [key, row] of stored) {
    if (row.exchangePairId !== undefined) {
      owners.set(
        row.exchangePairId,
        (owners.get(row.exchangePairId) ?? new Set()).add(ownerOfKey.get(key) ?? key),
      );
    }
  }

  return owners;
};

const playAllRuns = async (world: World, gapMs: number): Promise<number> => {
  let imported = 0;
  let limitedAt: number | undefined;

  for (const [index, plan] of plansOf(gapMs).entries()) {
    if (plan.stress) {
      world.exchange.arrive(index === 0 ? FIRST_RUN_FILLS : LATER_RUN_FILLS);
    }

    const coolingDown = limitedAt !== undefined && plan.at < limitedAt + RETRY_AFTER_MS;
    const played = await playRun(world, plan, coolingDown);

    imported += played.imported;
    limitedAt = played.limited ? plan.at : limitedAt;
  }

  return imported;
};

describe.each(RUN_GAPS)('the trade read over random exchanges, runs %i ms apart', (gapMs) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(SEEDS)(
    'stores each order of a readable symbol once per key with every fill summed, one order per pair id, and reads an order once per run: seed %i',
    async (seed) => {
      const random = seededRandom(seed);
      const world: World = {
        accountId: `acc-trade-properties-${gapMs}-${seed}`,
        exchange: exchangeOf(random),
        random,
        doomed: random() < 0.5 ? pick(random, SPECS).symbol : undefined,
        store: storeOf(),
        stateStore: stateStoreOf(),
      };

      const imported = await playAllRuns(world, gapMs);

      const readable = world.exchange.orders.filter(({ spec }) => spec.symbol !== world.doomed);
      const expected = new Map(
        readable.flatMap((order) => [...expectedRowsOf(world.accountId, order)]),
      );
      const ownerOfKey = new Map(
        readable.flatMap((order) =>
          [...expectedRowsOf(world.accountId, order).keys()].map((key): [string, string] => [
            key,
            ownerOf(order),
          ]),
        ),
      );
      const parsed = parseExchangeState(world.stateStore.state.text);

      expect(new Map([...world.store.stored].map(([key, row]) => [key, shapeOf(row)]))).toEqual(
        expected,
      );
      expect(imported).toBe(world.store.stored.size);
      expect(parsed.kind === 'parsed' ? parsed.trades.symbols : undefined).toEqual(
        Object.fromEntries(
          SPECS.filter(({ symbol }) => symbol !== world.doomed).map(({ symbol }) => [
            symbol,
            { fromId: expect.any(Number) },
          ]),
        ),
      );

      for (const [pairId, owners] of ownersByPairOf(world.store.stored, ownerOfKey)) {
        expect([pairId, [...owners]]).toEqual([
          pairId,
          [pairId.slice(`${world.accountId}:trade:`.length)],
        ]);
      }

      for (const [key, row] of world.store.stored) {
        expect(row.holdingId).toBe(holdingIdOf(key.slice(key.lastIndexOf(':') + 1)));
      }
    },
  );
});
