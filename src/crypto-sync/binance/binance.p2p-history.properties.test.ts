import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import {
  type CurrentRun,
  type Disturbances,
  disturbancesOf,
  readFailureOf,
  walkRuns,
} from '@kiko/test-support/walk-disturbances';
import { sweep } from '@kiko/test-support/property-sweep';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { NOW } from './binance.pay-test-fixtures';
import { p2pOrderOf, p2pPageOf } from './binance.p2p-test-fixtures';
import { type BinanceP2pOrder, P2P_PAGE_ROWS } from './binance.history-client';
import { P2P_OPEN_STATUSES, syncBinanceP2pHistory } from './binance.p2p-history';

/**
 * The P2P walk driven over random sets of orders through `syncBinanceP2pHistory` itself, in
 * several runs a clock gap apart. Orders are made after the first run, and some wait on Binance
 * (an open status) until a later run settles them or cancels them. The first runs are disturbed:
 * a random part of the lane is spent before the run, a window throws on some runs, some calls
 * answer a 429 (which starts the cooldown, and a run inside it sends nothing); the last runs are
 * quiet. The expected rows, entries and tickers are decided by the category an order is made from,
 * never read back from the walk.
 */

const HOUR_MS = 3_600_000;
const RUN_GAPS = [0, HOUR_MS, DAY_MS];
const NOISY_RUNS = 14;
const RUNS = 40;
const SEEDS = sweep(Array.from({ length: 35 }, (_unused, position) => 31 + position * 7));
const FIRST_RUN_AT = NOW;
const HISTORY_DAYS = 400;
const START_CURSOR = FIRST_RUN_AT - HISTORY_DAYS * DAY_MS;

type Category =
  | 'buy'
  | 'buyFiat'
  | 'buyNet'
  | 'sale'
  | 'advertiser'
  | 'unknownRole'
  | 'unknownSide'
  | 'noAmount'
  | 'uncarriableFiat'
  | 'cancelled'
  | 'unknownStatus'
  | 'untracked'
  | 'openThenCancelled';

/** A category twice in the list is drawn twice as often. */
const CATEGORIES: Category[] = [
  'buy',
  'buy',
  'buyFiat',
  'buyNet',
  'sale',
  'advertiser',
  'unknownRole',
  'unknownSide',
  'noAmount',
  'uncarriableFiat',
  'cancelled',
  'unknownStatus',
  'untracked',
  'openThenCancelled',
];

/** What an order comes to: the row it makes, the entry it is listed under, the ticker it names. */
type Expected = {
  key?: string;
  units?: number;
  marker?: string;
  entry?: string;
  untracked?: string;
};

type Made = {
  order: BinanceP2pOrder;
  expected: Expected;
  /** The run from which Binance shows the order as it is final; before it the order is open. */
  settlesAtRun: number | undefined;
  openStatus: string;
};

type StoredRow = { amountMinorUnits: number; untrackedCounterpart: string };

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const HOLDINGS = ['UAH:funding', 'USDT:funding'].map((key) =>
  holdingWith(`h-${key}`, { binanceAsset: key }),
);

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)];

const keyOf = (accountId: string, orderNumber: string, wallet: string): string =>
  `${accountId}:p2p:${orderNumber}:${wallet}`;

const entryOf = (kind: string, order: BinanceP2pOrder): string =>
  `${kind}:${order.orderNumber}:${order.createTime}`;

type CategoryInput = {
  accountId: string;
  base: Pick<BinanceP2pOrder, 'orderNumber' | 'createTime'>;
  /** A whole amount of the coin. */
  n: number;
  random: Random;
};

type Variant = { over: Partial<BinanceP2pOrder>; expected: (order: BinanceP2pOrder) => Expected };

const refusal =
  (kind: string) =>
  (order: BinanceP2pOrder): Expected => ({ entry: entryOf(kind, order) });

/** A completed taker buy of `n`.5 USDT with a commission of 0.25, paid for with `n` x 41 UAH. */
const usdtOrderOf = (base: CategoryInput['base'], n: number): Partial<BinanceP2pOrder> => ({
  ...base,
  amount: `${n}.5`,
  takerCommission: '0.25',
  takerAmount: `${n}.25`,
  totalPrice: `${n * 41}`,
});

const usdtRowOf = (accountId: string, base: CategoryInput['base'], n: number): Expected => ({
  key: keyOf(accountId, base.orderNumber, 'USDT:funding'),
  units: n * 100_000_000 + 25_000_000,
  marker: `p2p:UAH:${n * 41}.00`,
});

/** The orders of a category, as Binance sends them, and what each comes to. */
const VARIANTS: Record<Category, (input: CategoryInput) => Variant> = {
  buy: ({ accountId, base, n }) => ({ over: {}, expected: () => usdtRowOf(accountId, base, n) }),
  buyNet: ({ accountId, base, n }) => ({
    over: { takerAmount: undefined },
    expected: () => usdtRowOf(accountId, base, n),
  }),
  buyFiat: ({ accountId, base, n }) => ({
    over: {
      asset: 'UAH',
      fiat: 'UAH',
      amount: `${n}`,
      takerAmount: `${n}`,
      takerCommission: undefined,
      totalPrice: `${n}`,
    },
    expected: () => ({
      key: keyOf(accountId, base.orderNumber, 'UAH:funding'),
      units: n * 100,
      marker: `p2p:UAH:${n}.00`,
    }),
  }),
  sale: ({ random }) => ({
    over: { tradeType: 'SELL', advertisementRole: pick(random, ['TAKER', 'MAKER']) },
    expected: refusal('p2p-sale'),
  }),
  advertiser: () => ({
    over: { advertisementRole: 'MAKER' },
    expected: refusal('p2p-advertiser'),
  }),
  unknownRole: ({ random }) => ({
    over: { advertisementRole: pick(random, [undefined, 'OTHER']) },
    expected: refusal('p2p-unrecognized'),
  }),
  unknownSide: () => ({ over: { tradeType: 'TRANSFER' }, expected: refusal('p2p-unrecognized') }),
  noAmount: () => ({
    over: { takerAmount: undefined, amount: undefined },
    expected: refusal('p2p-amount'),
  }),
  uncarriableFiat: ({ random }) => ({
    over: { fiat: pick(random, ['', 'U:AH']) },
    expected: refusal('p2p-unrecognized'),
  }),
  cancelled: ({ random }) => ({
    over: { orderStatus: pick(random, ['CANCELLED', 'CANCELLED_BY_SYSTEM']) },
    expected: () => ({}),
  }),
  openThenCancelled: () => ({ over: { orderStatus: 'CANCELLED' }, expected: () => ({}) }),
  unknownStatus: () => ({
    over: { orderStatus: 'EXPIRED_SOMEHOW' },
    expected: refusal('p2p-unrecognized'),
  }),
  untracked: () => ({ over: { asset: 'XYZ' }, expected: () => ({ untracked: 'XYZ' }) }),
};

const madeOf = (input: {
  random: Random;
  index: number;
  accountId: string;
  gapMs: number;
}): Made => {
  const { random, index, accountId, gapMs } = input;
  const category = pick(random, CATEGORIES);
  const span = HISTORY_DAYS * DAY_MS + (RUNS - 1) * gapMs;
  const base = {
    orderNumber: `order-${index}`,
    createTime: START_CURSOR + Math.floor(random() * span),
  };
  const n = 1 + Math.floor(random() * 4_000);
  const variant = VARIANTS[category]({ accountId, base, n, random });
  const order = p2pOrderOf({ ...usdtOrderOf(base, n), ...variant.over });
  const waits =
    category === 'openThenCancelled' || (category !== 'unknownStatus' && random() < 0.3);

  return {
    order,
    expected: variant.expected(order),
    settlesAtRun: waits ? 1 + Math.floor(random() * (NOISY_RUNS - 2)) : undefined,
    openStatus: pick(random, P2P_OPEN_STATUSES),
  };
};

/** The order as Binance shows it at run `run`: still waiting before the run that settles it. */
const shownAt = ({ order, settlesAtRun, openStatus }: Made, run: number): BinanceP2pOrder =>
  settlesAtRun !== undefined && run < settlesAtRun ? { ...order, orderStatus: openStatus } : order;

/** Binance lists an order of a side it does not know under the buy series. */
const sideOf = (order: BinanceP2pOrder): 'BUY' | 'SELL' =>
  order.tradeType === 'SELL' ? 'SELL' : 'BUY';

type World = {
  accountId: string;
  gapMs: number;
  made: Made[];
  disturbances: Disturbances;
};

const worldOf = (seed: number, gapMs: number): World => {
  const random = seededRandom(seed);
  const accountId = `acc-p2p-properties-${gapMs}-${seed}`;
  const made = Array.from({ length: 12 + Math.floor(random() * 24) }, (_unused, index) =>
    madeOf({ random, index, accountId, gapMs }),
  );
  const disturbances = disturbancesOf({
    random,
    runs: RUNS,
    noisyRuns: NOISY_RUNS,
    lane: 'p2p',
    from: START_CURSOR,
    days: HISTORY_DAYS,
    errorOf: (run) => new Error(`window thrower ${run}`),
  });

  return { accountId, gapMs, made, disturbances };
};

type Outcome = {
  stored: Map<string, StoredRow>;
  fake: ReturnType<typeof walkStateFake>;
  last: { imported: number; complete: boolean } | undefined;
  finalClock: number;
};

/** The orders that wait on Binance at `run` and have left a row or an entry. */
const openOrdersWithTraces = (world: World, run: number, runNow: number, traces: string[]) =>
  world.made
    .filter(
      ({ order, settlesAtRun }) =>
        settlesAtRun !== undefined && run < settlesAtRun && order.createTime <= runNow,
    )
    .filter(({ expected }) =>
      traces.some((trace) => trace === expected.key || trace === expected.entry),
    )
    .map(({ order }) => order.orderNumber);

const runWorld = async (world: World): Promise<Outcome> => {
  const { accountId, gapMs, made, disturbances } = world;
  const fake = walkStateFake({ accountId, alongside: HOLDINGS });
  const stored = new Map<string, StoredRow>();
  const current: CurrentRun = { run: 0, now: FIRST_RUN_AT };
  let reads = 0;

  const fetchP2pOrders = async (
    _apiKey: string,
    _secret: string,
    side: 'BUY' | 'SELL',
    span: { start: number; end: number },
    page: number,
  ) => {
    reads += 1;
    const failure = readFailureOf(disturbances, current, span);

    if (failure !== undefined) {
      throw failure;
    }

    const found = made
      .map((item) => shownAt(item, current.run))
      .filter(
        (order) =>
          sideOf(order) === side &&
          order.createTime >= span.start &&
          order.createTime <= span.end &&
          order.createTime <= current.now,
      );

    return p2pPageOf(found.slice((page - 1) * P2P_PAGE_ROWS, page * P2P_PAGE_ROWS), {
      total: found.length,
    });
  };

  fake.seed('p2p', { cursor: START_CURSOR });

  const { last, finalClock } = await walkRuns({
    runs: RUNS,
    gapMs,
    firstRunAt: FIRST_RUN_AT,
    accountId,
    lane: 'p2p',
    disturbances,
    current,
    reads: () => reads,
    walk: ({ runNow, walkRun }) =>
      syncBinanceP2pHistory(
        { targetAccountId: accountId, run: walkRun },
        {
          now: () => runNow,
          readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
          fetchP2pOrders,
          ensureHoldings: async () => undefined,
          addTransactions: async (rows) => {
            for (const { externalId, amountMinorUnits, untrackedCounterpart } of rows) {
              stored.set(externalId, { amountMinorUnits, untrackedCounterpart });
            }

            return rows.length;
          },
          ...fake.freshDeps(),
          listHoldings: fake.listHoldings,
        },
      ),
    afterRun: (run, runNow) =>
      expect(
        openOrdersWithTraces(world, run, runNow, [...stored.keys(), ...fake.notImported()]),
      ).toEqual([]),
  });

  return { stored, fake, last, finalClock };
};

describe.each(RUN_GAPS)('the P2P walk over random orders, runs %i ms apart', (gapMs) => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it.each(SEEDS)(
    'imports each completed taker buy once at its exact amount, lists each refusal once, and ends current: seed %i',
    async (seed) => {
      const world = worldOf(seed, gapMs);
      const { stored, fake, last, finalClock } = await runWorld(world);
      const rowed = world.made.filter(({ expected }) => expected.key !== undefined);
      const listed = JSON.parse((await fake.deps.readExchangeState(world.accountId)) ?? '{}') as {
        untrackedCoins?: { history?: string[] };
      };

      expect([...stored.keys()].sort()).toEqual(rowed.map(({ expected }) => expected.key).sort());
      expect(rowed.map(({ expected }) => stored.get(expected.key ?? ''))).toEqual(
        rowed.map(({ expected }) => ({
          amountMinorUnits: expected.units,
          untrackedCounterpart: expected.marker,
        })),
      );
      expect([...fake.notImported()].sort()).toEqual(
        world.made.flatMap(({ expected }) => expected.entry ?? []).sort(),
      );
      expect(listed.untrackedCoins?.history ?? []).toEqual([
        ...new Set(world.made.flatMap(({ expected }) => expected.untracked ?? [])),
      ]);
      expect(last?.complete).toBe(true);
      expect(fake.marksOf('p2p').cursor).toBe(finalClock);
      expect((fake.marksOf('p2p').pending as unknown[] | undefined) ?? []).toEqual([]);
    },
  );
});
