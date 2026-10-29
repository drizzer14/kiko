import { DAY_MS } from '@kiko/dates';
import {
  coinListPatchesOf,
  numberMarkWritesOfAnyWalk,
  walkStateFake,
} from '@kiko/test-support/walk-marks';
import type { HoldingRow } from '@kiko/db';
import type { WalkResult } from '@kiko/crypto-sync/exchange/walk';
import { createExchangeRun } from '@kiko/crypto-sync/exchange/budget';

import {
  type BinanceFiatOrderHistoryDeps,
  type BinanceFiatPaymentHistoryDeps,
  FIAT_WINDOW_MS,
  syncBinanceFiatOrderHistory,
  syncBinanceFiatPaymentHistory,
} from './binance.fiat-history';
import {
  type BinanceFiatOrder,
  type BinanceFiatPayment,
  BinanceHistoryParseError,
  fetchFiatOrders,
  fetchFiatPayments,
  type FiatTransactionType,
} from './binance.history-client';
import {
  FIAT_CREATED_AT,
  FIAT_ORDER_NO,
  FIAT_PAYMENT_NO,
  fiatOrderOf,
  fiatPageOf,
  fiatPaymentOf,
  fiatServerOf,
} from './binance.fiat-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';
import { type BinanceRunBudget, COSTS, createBinanceHistoryRun } from './binance.history-budget';

const HOUR_MS = 3_600_000;

type AnyDeps = Partial<BinanceFiatOrderHistoryDeps & BinanceFiatPaymentHistoryDeps>;

type AnyRecord = BinanceFiatOrder | BinanceFiatPayment;

type Query = { type: string; start: number; end: number; page: number };

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

type FiatKind = {
  name: string;
  walkId: 'fiatOrders' | 'fiatPayments';
  readKey: 'fetchFiatOrders' | 'fetchFiatPayments';
  pageRows: number;
  laneCalls: number;
  /** The runs of a first walk up to its cursor at now, and which of them read forward. */
  runsToNow: number;
  forwardRuns: readonly number[];
  cost: (typeof COSTS)['fiatOrders' | 'fiatPayments'];
  keyPart: 'fiat' | 'fiatpay';
  coin: 'EUR' | 'BTC';
  settledWord: string;
  recordOf: (over?: Partial<Pick<AnyRecord, 'orderNo' | 'createTime' | 'status'>>) => AnyRecord;
  sync: (
    request: Parameters<typeof syncBinanceFiatOrderHistory>[0],
    overrides: AnyDeps,
  ) => Promise<WalkResult>;
};

const ORDERS: FiatKind = {
  name: 'fiat orders',
  walkId: 'fiatOrders',
  readKey: 'fetchFiatOrders',
  pageRows: 500,
  laneCalls: 3,
  runsToNow: 6,
  forwardRuns: [0, 1, 2, 3, 5],
  cost: COSTS.fiatOrders,
  keyPart: 'fiat',
  coin: 'EUR',
  settledWord: 'Successful',
  recordOf: fiatOrderOf,
  sync: syncBinanceFiatOrderHistory,
};

const PAYMENTS: FiatKind = {
  name: 'fiat payments',
  walkId: 'fiatPayments',
  readKey: 'fetchFiatPayments',
  pageRows: 100,
  laneCalls: 10,
  runsToNow: 1,
  forwardRuns: [0],
  cost: COSTS.fiatPayments,
  keyPart: 'fiatpay',
  coin: 'BTC',
  settledWord: 'Completed',
  recordOf: fiatPaymentOf,
  sync: syncBinanceFiatPaymentHistory,
};

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case uses its own
// account id.
let accountSequence = 0;

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

const SPOT_HOLDINGS = [
  holdingWith('h-eur-spot', { binanceAsset: 'EUR' }),
  holdingWith('h-uah-spot', { binanceAsset: 'UAH' }),
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
const worldOf = (kind: FiatKind) => {
  accountSequence += 1;
  const accountId = `acc-fiat-${accountSequence}`;
  const fake = walkStateFake({ accountId, alongside: SPOT_HOLDINGS });
  const serverOf = (byType: Partial<Record<FiatTransactionType, AnyRecord[]>> = {}): jest.Mock =>
    fiatServerOf(byType, kind.pageRows);
  const depsOf = (over: AnyDeps = {}): AnyDeps => ({
    now: () => NOW,
    fetchImpl: (async () => ({})) as unknown as typeof fetch,
    readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
    ensureHoldings: jest.fn(async () => undefined),
    addTransactions: jest.fn(async (rows: unknown[]) => rows.length),
    removeTransactions: jest.fn(async () => 0),
    [kind.readKey]: serverOf(),
    ...fake.freshDeps(),
    listHoldings: fake.listHoldings,
    ...over,
  });
  const walk = (deps: AnyDeps, run = freshRun()) =>
    kind.sync({ targetAccountId: accountId, run }, deps);
  const seed = (marks: Parameters<typeof fake.seed>[1]) => fake.seed(kind.walkId, marks);

  return { accountId, fake, serverOf, depsOf, walk, seed };
};

/** A world whose walk is an hour behind, so one run reads the records of the last hour. */
const recentWorld = (kind: FiatKind) => {
  const world = worldOf(kind);

  world.seed({ cursor: NOW - HOUR_MS });

  return world;
};

const queriesOf = (kind: FiatKind, deps: AnyDeps): Query[] =>
  (deps[kind.readKey] as jest.Mock).mock.calls.map(
    ([, , type, span, page]) => ({ type, start: span.start, end: span.end, page }) as Query,
  );

const addedRows = (deps: AnyDeps): AddedRow[] =>
  (deps.addTransactions as jest.Mock).mock.calls.flatMap(([rows]) => rows as AddedRow[]);

const cursorOf = (kind: FiatKind, world: ReturnType<typeof worldOf>) =>
  world.fake.marksOf(kind.walkId).cursor;

const pendingOf = (kind: FiatKind, world: ReturnType<typeof worldOf>): unknown[] =>
  (world.fake.marksOf(kind.walkId).pending as unknown[] | undefined) ?? [];

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

const entryOf = (orderNo: string) => `fiat-unrecognized:${orderNo}:${FIAT_CREATED_AT}`;

describe('a fiat walk refused before its first read', () => {
  describe.each([ORDERS, PAYMENTS])('$name: a run that does not start', (kind) => {
    it('makes no request while the account is cooling down, nor reads its credentials or marks', async () => {
      const { accountId, depsOf, walk } = worldOf(kind);
      setBinanceCooldownUntil(accountId, NOW + 60_000);
      const readCredentials = jest.fn(async () => ({ apiKey: 'api-key', secret: 'secret' }));
      const deps = depsOf({ readCredentials });

      const result = await walk(deps);

      expect(result).toEqual({ imported: 0, complete: false });
      expect(deps[kind.readKey]).not.toHaveBeenCalled();
      expect(readCredentials).not.toHaveBeenCalled();
      expect(deps.readExchangeState).not.toHaveBeenCalled();
      expect(deps.patchExchangeState).not.toHaveBeenCalled();
    });

    it('makes no request without credentials and reports complete', async () => {
      const { depsOf, walk } = worldOf(kind);
      const deps = depsOf({ readCredentials: async () => undefined });

      const result = await walk(deps);

      expect(result).toEqual({ imported: 0, complete: true });
      expect(deps[kind.readKey]).not.toHaveBeenCalled();
    });

    it.each([
      ['text that is not JSON', '{not json'],
      ['a state of another version', '{"version":2,"walks":{}}'],
    ])('rejects before it reads Binance or writes the state, for %s', async (_label, text) => {
      const { depsOf, walk } = worldOf(kind);
      const deps = depsOf({ readExchangeState: async () => text });

      await expect(walk(deps)).rejects.toMatchObject({ code: 'exchange-state-malformed' });

      expect(deps[kind.readKey]).not.toHaveBeenCalled();
      expect(deps.patchExchangeState).not.toHaveBeenCalled();
    });

    it('reads nothing and reports unfinished when the clock stands at the history floor', async () => {
      const { depsOf, walk } = worldOf(kind);
      const deps = depsOf({ now: () => HISTORY_FLOOR_MS });

      const result = await walk(deps);

      expect(result).toEqual({ imported: 0, complete: false });
      expect(deps[kind.readKey]).not.toHaveBeenCalled();
    });
  });
});

/** `count` runs, each on a fresh run object and its own deps, over the one stored state. */
const walkRuns = async (
  world: ReturnType<typeof worldOf>,
  count: number,
  over: () => AnyDeps = () => ({}),
) => {
  const runs: { deps: AnyDeps; result: WalkResult }[] = [];

  for (let run = 0; run < count; run += 1) {
    const deps = world.depsOf(over());

    runs.push({ deps, result: await world.walk(deps) });
  }

  return runs;
};

/** The queries of the runs of a first walk that read forward, in the order the runs ran. */
const forwardQueriesOf = (kind: FiatKind, runs: { deps: AnyDeps }[]): Query[] =>
  kind.forwardRuns.flatMap((index) => queriesOf(kind, runs[index].deps));

describe.each([ORDERS, PAYMENTS])('the $name walk windows', (kind) => {
  it('reads two-year windows forward from the history floor, oldest first, both types of each', async () => {
    const runs = await walkRuns(worldOf(kind), kind.runsToNow);

    const queries = forwardQueriesOf(kind, runs);
    expect(queries.map(({ type }) => type)).toEqual(
      Array.from({ length: 5 }, () => ['0', '1']).flat(),
    );

    for (const [index, query] of queries.entries()) {
      expect(query.start).toBe(HISTORY_FLOOR_MS + Math.floor(index / 2) * FIAT_WINDOW_MS);
      expect(query.end).toBe(Math.min(query.start + FIAT_WINDOW_MS, NOW));
      expect(query.page).toBe(1);
    }
  });

  it('reads every empty window and imports a record behind four of them', async () => {
    const world = worldOf(kind);
    const fifth = kind.recordOf({ createTime: HISTORY_FLOOR_MS + 4 * FIAT_WINDOW_MS + DAY_MS });

    const runs = await walkRuns(world, kind.runsToNow, () => ({
      [kind.readKey]: world.serverOf({ '0': [fifth] }),
    }));

    const queries = forwardQueriesOf(kind, runs);
    expect([...new Set(queries.map(({ start }) => start))]).toEqual(
      [0, 1, 2, 3, 4].map((window) => HISTORY_FLOOR_MS + window * FIAT_WINDOW_MS),
    );
    expect(
      new Set(runs.flatMap(({ deps }) => addedRows(deps).map(({ externalId }) => externalId))).size,
    ).toBe(1);
    expect(world.fake.notImported()).toEqual([]);
  });
});

describe('the first walk of an account that has never synced', () => {
  const firstWalk = async (kind: FiatKind, count: number) => {
    const world = worldOf(kind);
    const runs: { calls: number; complete: boolean; cursor: unknown }[] = [];

    for (let run = 0; run < count; run += 1) {
      const [{ deps, result }] = await walkRuns(world, 1);

      runs.push({
        calls: queriesOf(kind, deps).length,
        complete: result.complete,
        cursor: cursorOf(kind, world),
      });
    }

    return runs;
  };

  describe('of fiat orders, at a lane of three calls', () => {
    it('reads every two-year window from the floor, empty ones too', async () => {
      const runs = await firstWalk(ORDERS, ORDERS.runsToNow);

      expect(runs.map(({ calls }) => calls)).toEqual([2, 2, 2, 2, 2, 2]);
      expect(runs.map(({ cursor }) => cursor)).toEqual([
        HISTORY_FLOOR_MS + FIAT_WINDOW_MS,
        HISTORY_FLOOR_MS + 2 * FIAT_WINDOW_MS,
        HISTORY_FLOOR_MS + 3 * FIAT_WINDOW_MS,
        HISTORY_FLOOR_MS + 4 * FIAT_WINDOW_MS,
        HISTORY_FLOOR_MS + 4 * FIAT_WINDOW_MS,
        NOW,
      ]);
    });

    it('alternates the owed days and the last two years behind once it reaches now, until both are read', async () => {
      const runs = await firstWalk(ORDERS, 12);

      expect(runs.map(({ calls }) => calls)).toEqual(Array.from({ length: 12 }, () => 2));
      expect(runs.map(({ complete }) => complete)).toEqual([
        ...Array.from({ length: 9 }, () => false),
        ...Array.from({ length: 3 }, () => true),
      ]);
      expect(runs.at(-1)?.cursor).toBe(NOW);
    });
  });

  describe('of fiat payments, at a lane of ten calls', () => {
    it('reads every two-year window from the floor, empty ones too', async () => {
      const runs = await firstWalk(PAYMENTS, PAYMENTS.runsToNow);

      expect(runs).toEqual([{ calls: 10, complete: true, cursor: NOW }]);
    });
  });
});

describe('when the fiat payment walk is current', () => {
  it('reports complete once every window up to now is read and nothing is owed', async () => {
    const { depsOf, walk } = recentWorld(PAYMENTS);

    const result = await walk(depsOf());

    expect(result.complete).toBe(true);
  });

  it('reads forward and re-scans the last two years in the same run', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(PAYMENTS, deps)).toEqual([
      ...['0', '1'].map((type) => ({ type, start: NOW - HOUR_MS, end: NOW, page: 1 })),
      ...['0', '1'].map((type) => ({
        type,
        start: NOW - FIAT_WINDOW_MS,
        end: NOW - HOUR_MS,
        page: 1,
      })),
    ]);
    expect(cursorOf(PAYMENTS, world)).toBe(NOW);
    expect(pendingOf(PAYMENTS, world)).toEqual([]);
  });
});

describe('when the fiat order walk is current, at a lane of three calls', () => {
  const LATER_MS = 300_000;

  /** Orders the first run does not read: one from the last day and one from the last month. */
  const lateOrders = () => [
    ORDERS.recordOf({ orderNo: 'late-1', createTime: NOW - 2 * HOUR_MS }),
    ORDERS.recordOf({ orderNo: 'late-2', createTime: NOW - 30 * DAY_MS }),
  ];

  /** A world whose forward read just ran, so the next run is the first to read behind. */
  const afterForwardRun = async () => {
    const world = recentWorld(ORDERS);

    await world.walk(world.depsOf());

    return world;
  };

  it('re-scans the last two years on the run after a forward read, so a late record is imported', async () => {
    const world = await afterForwardRun();
    const behind = world.depsOf({
      now: () => NOW + LATER_MS,
      [ORDERS.readKey]: world.serverOf({ '0': lateOrders() }),
    });

    const result = await world.walk(behind);

    expect(queriesOf(ORDERS, behind)).toEqual(
      ['0', '1'].map((type) => ({
        type,
        start: NOW + LATER_MS - FIAT_WINDOW_MS,
        end: NOW,
        page: 1,
      })),
    );
    expect(
      addedRows(behind)
        .map(({ externalId }) => externalId)
        .sort(),
    ).toEqual([expect.stringContaining(':fiat:late-1:'), expect.stringContaining(':fiat:late-2:')]);
    expect(cursorOf(ORDERS, world)).toBe(NOW);
    expect(pendingOf(ORDERS, world)).toEqual([]);
    expect(result.complete).toBe(false);
  });

  it('reads forward again on the run after the re-scan, and reports complete', async () => {
    const world = await afterForwardRun();
    await world.walk(world.depsOf({ now: () => NOW + LATER_MS }));
    const forward = world.depsOf({ now: () => NOW + 2 * LATER_MS });

    const result = await world.walk(forward);

    expect(result).toEqual({ imported: 0, complete: true });
    expect(queriesOf(ORDERS, forward).map(({ start }) => start)).toEqual([NOW, NOW]);
    expect(cursorOf(ORDERS, world)).toBe(NOW + 2 * LATER_MS);
  });

  it('reads an owed point on the third call of a forward run and of a re-scan run', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: [pointOf(FIAT_CREATED_AT, '0')] });
    const runs = await walkRuns(world, 2, () => ({ now: () => NOW }));

    expect(runs.map(({ deps }) => queriesOf(ORDERS, deps).map(({ type }) => type))).toEqual([
      ['0', '1', '0'],
      ['0', '1', '0'],
    ]);
    expect(queriesOf(ORDERS, runs[0].deps).at(-1)).toEqual({
      type: '0',
      start: FIAT_CREATED_AT - 1,
      end: FIAT_CREATED_AT + 1,
      page: 1,
    });
    expect(queriesOf(ORDERS, runs[1].deps)[0].start).toBe(NOW - FIAT_WINDOW_MS);
  });

  it('reads forward when the list holds no range, though a point is owed', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: [pointOf(FIAT_CREATED_AT, '0')] });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps)[0]).toEqual({
      type: '0',
      start: NOW - HOUR_MS,
      end: NOW,
      page: 1,
    });
  });

  it.each([
    ['a finished pass', HISTORY_FLOOR_MS, true],
    ['no pass yet', undefined, true],
    ['a pass in the middle', NOW - 400 * DAY_MS, false],
  ])(
    'reports a forward read that starts with the re-scan at %s as complete: %s',
    async (_name, rescan, expected) => {
      const world = recentWorld(ORDERS);
      world.seed({ rescan });

      const result = await world.walk(world.depsOf());

      expect(result.complete).toBe(expected);
    },
  );
});

describe('when the stored list of owed fiat order ground cannot be read', () => {
  it('clears the repaired range over alternating owed and re-scan runs, then reports complete', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: 'unreadable' });
    const pair = (start: number) => [start, start];
    const rescan = pair(NOW - FIAT_WINDOW_MS);

    const runs = await walkRuns(world, 10);

    expect(runs.map(({ deps }) => queriesOf(ORDERS, deps).map(({ start }) => start))).toEqual([
      pair(HISTORY_FLOOR_MS),
      pair(NOW - HOUR_MS),
      rescan,
      pair(HISTORY_FLOOR_MS + FIAT_WINDOW_MS),
      rescan,
      pair(HISTORY_FLOOR_MS + 2 * FIAT_WINDOW_MS),
      rescan,
      pair(HISTORY_FLOOR_MS + 3 * FIAT_WINDOW_MS),
      rescan,
      rescan,
    ]);
    expect(runs.map(({ result }) => result.complete)).toEqual([
      ...Array.from({ length: 7 }, () => false),
      ...Array.from({ length: 3 }, () => true),
    ]);
    expect(pendingOf(ORDERS, world)).toEqual([]);
    expect(cursorOf(ORDERS, world)).toBe(NOW);
  });
});

describe('the turn of the fiat order walk across runs', () => {
  const LATER_MS = 300_000;

  it('stores that a behind run ran, and clears it on the forward run after', async () => {
    const world = recentWorld(ORDERS);
    const marks = () => world.fake.marksOf(ORDERS.walkId).behindRun;

    await world.walk(world.depsOf());
    expect(marks()).toBeUndefined();

    await world.walk(world.depsOf({ now: () => NOW + LATER_MS }));
    expect(marks()).toBe(true);

    await world.walk(world.depsOf({ now: () => NOW + 2 * LATER_MS }));
    expect(marks()).toBe(false);
  });

  it('reads forward when the last run read behind, though the list still holds a range', async () => {
    const world = recentWorld(ORDERS);
    world.seed({
      pending: [{ start: NOW - 3 * HOUR_MS, end: NOW - 2 * HOUR_MS }],
      behindRun: true,
    });
    const deps = world.depsOf();

    const result = await world.walk(deps);

    expect(queriesOf(ORDERS, deps)).toEqual(
      ['0', '1'].map((type) => ({ type, start: NOW - HOUR_MS, end: NOW, page: 1 })),
    );
    expect(result.complete).toBe(false);
    expect(world.fake.marksOf(ORDERS.walkId).behindRun).toBe(false);
  });

  describe('with an owed range that no read clears', () => {
    const OLD_RANGE = { start: NOW - 1_500 * DAY_MS, end: NOW - 1_499 * DAY_MS };

    const isOld = (span: Span) => span.start < NOW - FIAT_WINDOW_MS;

    const FRESH = ORDERS.recordOf({ orderNo: 'fresh', createTime: NOW - 30 * 60_000 });

    /**
     * `count` runs, five minutes apart, over a list that holds the old range from the start;
     * `recordsAt` is what Binance serves on the run of that index.
     */
    const runsOf = async (
      count: number,
      readOf: (server: jest.Mock) => jest.Mock,
      recordsAt: (index: number) => AnyRecord[] = () => [FRESH],
      seeded: Parameters<ReturnType<typeof worldOf>['seed']>[0] = {},
    ) => {
      const world = recentWorld(ORDERS);
      world.seed({ pending: [OLD_RANGE], ...seeded });
      const runs: { deps: AnyDeps; ended: WalkResult | unknown; marks: unknown }[] = [];

      for (let index = 0; index < count; index += 1) {
        const deps = world.depsOf({
          now: () => NOW + index * LATER_MS,
          [ORDERS.readKey]: readOf(world.serverOf({ '0': recordsAt(index) })),
        });
        const ended = await world.walk(deps).catch((error: unknown) => error);
        const { behindRun, rescanTurn } = world.fake.marksOf(ORDERS.walkId);

        runs.push({ deps, ended, marks: { behindRun, rescanTurn } });
      }

      return { world, runs };
    };

    const drifting = (server: jest.Mock) =>
      jest.fn(async (apiKey, secret, type, span: Span, page) =>
        isOld(span) ? fiatPageOf([], { total: 5 }) : server(apiKey, secret, type, span, page),
      );

    const startsOf = (deps: AnyDeps) => [
      ...new Set(queriesOf(ORDERS, deps).map(({ start }) => start)),
    ];

    it('reads forward after every behind run, so a new order imports on the second run', async () => {
      const { world, runs } = await runsOf(4, drifting);

      expect(runs.map(({ deps }) => addedRows(deps).length)).toEqual([0, 1, 1, 0]);
      expect(runs.map(({ deps }) => startsOf(deps))).toEqual([
        [OLD_RANGE.start],
        [NOW - HOUR_MS],
        [NOW + 2 * LATER_MS - FIAT_WINDOW_MS],
        [NOW + LATER_MS],
      ]);
      expect(cursorOf(ORDERS, world)).toBe(NOW + 3 * LATER_MS);
      expect(pendingOf(ORDERS, world)).toContainEqual(
        expect.objectContaining({ start: OLD_RANGE.start }),
      );
      expect(stopCodes()).toContain('fiat-page-drift');
    });

    it('alternates the owed range and the last two years on the behind runs, a forward run between', async () => {
      const { runs } = await runsOf(6, drifting);

      expect(runs.map(({ deps }) => startsOf(deps))).toEqual([
        [OLD_RANGE.start],
        [NOW - HOUR_MS],
        [NOW + 2 * LATER_MS - FIAT_WINDOW_MS],
        [NOW + LATER_MS],
        [OLD_RANGE.start],
        [NOW + 3 * LATER_MS],
      ]);
      expect(runs.map(({ marks }) => marks)).toEqual([
        { behindRun: true, rescanTurn: true },
        { behindRun: false, rescanTurn: true },
        { behindRun: true, rescanTurn: false },
        { behindRun: false, rescanTurn: false },
        { behindRun: true, rescanTurn: true },
        { behindRun: false, rescanTurn: true },
      ]);
    });

    it('imports a record written late on the re-scan run, though the owed range is never cleared', async () => {
      const late = ORDERS.recordOf({ orderNo: 'late-1', createTime: NOW - 30 * DAY_MS });

      const { runs } = await runsOf(4, drifting, (index) => (index === 0 ? [] : [late]));

      expect(runs.map(({ deps }) => addedRows(deps).length)).toEqual([0, 0, 1, 0]);
      expect(addedRows(runs[2].deps).map(({ externalId }) => externalId)).toEqual([
        expect.stringContaining(':fiat:late-1:'),
      ]);
    });

    it('reads a stored behind mark with no re-scan mark as a behind run, and reads the owed range after', async () => {
      const { runs } = await runsOf(3, drifting, undefined, { behindRun: true });

      expect(runs.map(({ deps }) => startsOf(deps))).toEqual([
        [NOW - HOUR_MS],
        [OLD_RANGE.start],
        [NOW],
      ]);
    });

    it('reads ground older than Binance serves as empty, one series on each owed run', async () => {
      const { world, runs } = await runsOf(6, (server) =>
        jest.fn(async (apiKey, secret, type, span: Span, page) => {
          if (span.start < NOW - 1_000 * DAY_MS) {
            throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
          }

          return server(apiKey, secret, type, span, page);
        }),
      );

      expect(
        runs.map(({ deps }) => queriesOf(ORDERS, deps).map(({ type, start }) => [type, start])),
      ).toEqual([
        [
          ['0', OLD_RANGE.start],
          ['0', OLD_RANGE.end],
        ],
        [
          ['0', NOW - HOUR_MS],
          ['1', NOW - HOUR_MS],
        ],
        [
          ['0', NOW + 2 * LATER_MS - FIAT_WINDOW_MS],
          ['1', NOW + 2 * LATER_MS - FIAT_WINDOW_MS],
        ],
        [
          ['0', NOW + LATER_MS],
          ['1', NOW + LATER_MS],
        ],
        [
          ['1', OLD_RANGE.start],
          ['1', OLD_RANGE.end],
        ],
        [
          ['0', NOW + 3 * LATER_MS],
          ['1', NOW + 3 * LATER_MS],
        ],
      ]);
      expect(runs.map(({ deps }) => addedRows(deps).length)).toEqual([0, 1, 1, 0, 0, 0]);
      expect(pendingOf(ORDERS, world)).not.toContainEqual(
        expect.objectContaining({ start: OLD_RANGE.start }),
      );
      expect(stopCodes()).toEqual([]);
    });

    it('fails the run on a window whose page cannot be read, and reads forward on the next', async () => {
      const { world, runs } = await runsOf(6, (server) =>
        jest.fn(async (apiKey, secret, type, span: Span, page) => {
          if (isOld(span)) {
            throw new BinanceHistoryParseError();
          }

          return server(apiKey, secret, type, span, page);
        }),
      );

      expect(runs.map(({ ended }) => ended instanceof BinanceHistoryParseError)).toEqual([
        true,
        false,
        false,
        false,
        true,
        false,
      ]);
      expect(runs.map(({ deps }) => addedRows(deps).length)).toEqual([0, 1, 1, 0, 0, 0]);
      expect(cursorOf(ORDERS, world)).toBe(NOW + 5 * LATER_MS);
      // The owed pass owes the day it halved to on both types it read.
      expect(pendingOf(ORDERS, world)).toEqual(
        expect.arrayContaining([
          { ...OLD_RANGE, series: '0' },
          { ...OLD_RANGE, series: '1' },
        ]),
      );
    });
  });
});

describe('the fiat order walk on a run with no forward ground to read', () => {
  const LATE = ORDERS.recordOf({ orderNo: 'late-1', createTime: NOW - 30 * DAY_MS });

  const lateIds = (deps: AnyDeps) => addedRows(deps).map(({ externalId }) => externalId);

  it('re-scans the last two years on every run while the clock stands, so a late record is imported', async () => {
    const world = recentWorld(ORDERS);
    await world.walk(world.depsOf());

    const runs: { deps: AnyDeps }[] = [];

    for (let index = 0; index < 4; index += 1) {
      const deps = world.depsOf({
        [ORDERS.readKey]: world.serverOf({ '0': index < 2 ? [] : [LATE] }),
      });

      await world.walk(deps);
      runs.push({ deps });
    }

    expect(runs.map(({ deps }) => queriesOf(ORDERS, deps).length)).toEqual([2, 2, 2, 2]);
    expect(runs.map(({ deps }) => lateIds(deps).length)).toEqual([0, 0, 1, 1]);
    expect(queriesOf(ORDERS, runs[3].deps).map(({ start }) => start)).toEqual([
      NOW - FIAT_WINDOW_MS,
      NOW - FIAT_WINDOW_MS,
    ]);
    expect(cursorOf(ORDERS, world)).toBe(NOW);
  });

  it('re-scans when the clock is set back to before the cursor, and leaves the cursor where it is', async () => {
    const world = worldOf(ORDERS);
    world.seed({ cursor: NOW + 2 * HOUR_MS });
    const deps = world.depsOf({ [ORDERS.readKey]: world.serverOf({ '0': [LATE] }) });

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps)).toEqual(
      ['0', '1'].map((type) => ({ type, start: NOW - FIAT_WINDOW_MS, end: NOW, page: 1 })),
    );
    expect(lateIds(deps)).toEqual([expect.stringContaining(':fiat:late-1:')]);
    expect(cursorOf(ORDERS, world)).toBe(NOW + 2 * HOUR_MS);
  });

  it('reads behind after a behind run too, as a forward turn with nothing to read gives way', async () => {
    const world = worldOf(ORDERS);
    world.seed({ cursor: NOW + HOUR_MS, behindRun: true });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([
      NOW - FIAT_WINDOW_MS,
      NOW - FIAT_WINDOW_MS,
    ]);
    expect(world.fake.marksOf(ORDERS.walkId).behindRun).toBe(true);
  });

  it('reports complete when the read leaves no range owed and the re-scan finished', async () => {
    const world = worldOf(ORDERS);
    world.seed({ cursor: NOW + HOUR_MS });

    const result = await world.walk(world.depsOf());

    expect(result).toEqual({ imported: 0, complete: true });
  });

  it('reports unfinished when a range is still owed after the read', async () => {
    const owed = { start: NOW - 1_500 * DAY_MS, end: NOW - 1_499 * DAY_MS };
    const world = worldOf(ORDERS);
    world.seed({ cursor: NOW + HOUR_MS, pending: [owed], rescanTurn: true });
    const deps = world.depsOf();

    const result = await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([
      NOW - FIAT_WINDOW_MS,
      NOW - FIAT_WINDOW_MS,
    ]);
    expect(result.complete).toBe(false);
    expect(pendingOf(ORDERS, world)).toContainEqual(owed);
  });

  it('resumes the re-scan at its stored mark, and reports complete once the pass is finished', async () => {
    const world = worldOf(ORDERS);
    world.seed({ cursor: NOW + HOUR_MS, rescan: NOW - 400 * DAY_MS });
    const deps = world.depsOf();

    const result = await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([
      NOW - 400 * DAY_MS,
      NOW - 400 * DAY_MS,
    ]);
    expect(result.complete).toBe(true);
  });
});

describe('when a read of the last two years of fiat orders fails', () => {
  const OWED = { start: NOW - 200 * DAY_MS, end: NOW - 199 * DAY_MS };

  const BEFORE = ORDERS.recordOf({ orderNo: 'before', createTime: NOW - 400 * DAY_MS });

  const AFTER = ORDERS.recordOf({ orderNo: 'after', createTime: NOW - 100 * DAY_MS });

  const holdsOwed = (span: Span) => span.start <= OWED.end && span.end >= OWED.start;

  /** A server whose page drifts, or cannot be parsed, on any span that touches the owed range. */
  const failingOn = (how: 'drift' | 'unreadable', server: jest.Mock) =>
    jest.fn(async (apiKey, secret, type, span: Span, page) => {
      if (holdsOwed(span) && how === 'drift') {
        return fiatPageOf([], { total: 5 });
      }

      if (holdsOwed(span)) {
        throw new BinanceHistoryParseError();
      }

      return server(apiKey, secret, type, span, page);
    });

  /** A world whose forward ground is empty, with the owed range inside the last two years. */
  const currentWorld = () => {
    const world = worldOf(ORDERS);

    world.seed({ cursor: NOW, pending: [OWED] });

    return world;
  };

  const rowsOf = (deps: AnyDeps) =>
    addedRows(deps).map(({ externalId }) => externalId.split(':')[2]);

  const spansOf = (deps: AnyDeps) =>
    queriesOf(ORDERS, deps).map(({ type, start, end }) => [type, start, end]);

  const stuckOf = (world: ReturnType<typeof worldOf>) =>
    world.fake.marksOf(ORDERS.walkId).rescanStuck;

  /** `count` runs over the one stored state, each on its own server and run object. */
  const failingRuns = async (
    world: ReturnType<typeof worldOf>,
    count: number,
    how: 'drift' | 'unreadable',
  ) => {
    const runs: { deps: AnyDeps; failed: boolean }[] = [];

    for (let index = 0; index < count; index += 1) {
      const deps = world.depsOf({
        [ORDERS.readKey]: failingOn(how, world.serverOf({ '0': [BEFORE, AFTER] })),
      });
      const failed = await world.walk(deps).then(
        () => false,
        () => true,
      );

      runs.push({ deps, failed });
    }

    return runs;
  };

  const WINDOW_START = NOW - FIAT_WINDOW_MS;

  const both = (start: number, end: number) => [
    ['0', start, end],
    ['1', start, end],
  ];

  it('marks the owed range stuck on a page that drifts, and reads the ground around it', async () => {
    const world = currentWorld();

    const runs = await failingRuns(world, 5, 'drift');

    expect(runs.map(({ deps }) => spansOf(deps))).toEqual([
      both(WINDOW_START, NOW),
      both(OWED.start, OWED.end),
      both(WINDOW_START, OWED.start - 1),
      both(OWED.start, OWED.end),
      both(OWED.end + 1, NOW),
    ]);
    expect(runs.map(({ deps }) => rowsOf(deps))).toEqual([[], [], ['before'], [], ['after']]);
    expect(runs.map(({ failed }) => failed)).toEqual([false, false, false, false, false]);
    expect(stuckOf(world)).toEqual([OWED]);
    expect(pendingOf(ORDERS, world)).toContainEqual(expect.objectContaining({ start: OWED.start }));
    expect(world.fake.marksOf(ORDERS.walkId).rescan).toBe(HISTORY_FLOOR_MS);
    expect(stopCodes()).toContain('fiat-rescan-stuck');
  });

  it('marks the owed range stuck on a page that cannot be read, without failing the re-scan run', async () => {
    const world = currentWorld();

    const runs = await failingRuns(world, 5, 'unreadable');

    expect(runs.map(({ deps }) => spansOf(deps))).toEqual([
      [['0', WINDOW_START, NOW], ...both(WINDOW_START, OWED.start - 1)],
      [['0', OWED.start, OWED.end]],
      both(OWED.end + 1, NOW),
      [['0', OWED.start, OWED.end]],
      both(WINDOW_START, OWED.start - 1),
    ]);
    expect(runs.map(({ failed }) => failed)).toEqual([false, true, false, true, false]);
    expect(runs.map(({ deps }) => rowsOf(deps))).toEqual([
      ['before'],
      [],
      ['after'],
      [],
      ['before'],
    ]);
    expect(stuckOf(world)).toEqual([OWED]);
  });

  it('reads the stuck range on its own in the owed runs, and reads over it once it is clear', async () => {
    const world = currentWorld();

    await failingRuns(world, 5, 'drift');

    const healed = world.depsOf({ [ORDERS.readKey]: world.serverOf({ '0': [BEFORE, AFTER] }) });
    await world.walk(healed);

    expect(spansOf(healed)).toEqual(both(OWED.start, OWED.end));
    expect(pendingOf(ORDERS, world)).not.toContainEqual(
      expect.objectContaining({ start: OWED.start }),
    );
    expect(stuckOf(world)).toEqual([OWED]);

    const reread = world.depsOf({ [ORDERS.readKey]: world.serverOf({ '0': [BEFORE, AFTER] }) });
    await world.walk(reread);

    expect(spansOf(reread)).toEqual(both(WINDOW_START, NOW));
    expect(stuckOf(world)).toEqual([]);
  });

  it('halves a span that fails and holds no owed range, down to the millisecond that fails', async () => {
    const world = worldOf(ORDERS);
    const point = NOW - 200 * DAY_MS + 12_345;
    const server = world.serverOf({ '0': [BEFORE, AFTER] });
    const holdsPoint = (span: Span) => span.start <= point && point <= span.end;
    const failingAtPoint = () =>
      jest.fn(async (apiKey, secret, type, span: Span, page) =>
        holdsPoint(span) ? fiatPageOf([], { total: 5 }) : server(apiKey, secret, type, span, page),
      );
    const imported: string[] = [];
    const firstSpans: number[][] = [];
    let isolatedAt = -1;

    world.seed({ cursor: NOW });

    for (let index = 0; index < 90; index += 1) {
      const deps = world.depsOf({ [ORDERS.readKey]: failingAtPoint() });

      await world.walk(deps);
      firstSpans.push(spansOf(deps).at(0)?.slice(1) as number[]);
      isolatedAt = isolatedAt < 0 && stuckOf(world) !== undefined ? index : isolatedAt;
      imported.push(...rowsOf(deps).map((orderNo) => `${orderNo}@${index}`));
    }

    expect(firstSpans.slice(0, 3)).toEqual([
      [WINDOW_START, NOW],
      [WINDOW_START, WINDOW_START + Math.floor(FIAT_WINDOW_MS / 2)],
      [WINDOW_START + Math.floor(FIAT_WINDOW_MS / 2), NOW],
    ]);
    expect(isolatedAt).toBe(72);
    expect(stuckOf(world)).toEqual([{ start: point - 1, end: point }]);
    expect(pendingOf(ORDERS, world)).toContainEqual(
      expect.objectContaining({ start: point - 1, end: point }),
    );
    expect(imported.slice(0, 2)).toEqual(['before@1', 'after@74']);
  });

  it('keeps a failure that is not an unreadable page, and fails the run on it', async () => {
    const world = currentWorld();
    const deps = world.depsOf({
      [ORDERS.readKey]: jest.fn(async () => {
        throw new Error('network down');
      }),
    });

    await expect(world.walk(deps)).rejects.toThrow('network down');
    expect(stuckOf(world)).toBeUndefined();
  });

  it('reads around the owed range in the one run of the payment walk, which has the calls for it', async () => {
    const world = worldOf(PAYMENTS);
    const server = world.serverOf({
      '0': [
        PAYMENTS.recordOf({ orderNo: 'before', createTime: BEFORE.createTime }),
        PAYMENTS.recordOf({ orderNo: 'after', createTime: AFTER.createTime }),
      ],
    });
    const deps = world.depsOf({
      [PAYMENTS.readKey]: jest.fn(async (apiKey, secret, type, span: Span, page) =>
        holdsOwed(span) ? fiatPageOf([], { total: 5 }) : server(apiKey, secret, type, span, page),
      ),
    });

    world.seed({ cursor: NOW, pending: [OWED] });
    await world.walk(deps);

    expect(queriesOf(PAYMENTS, deps).map(({ type, start, end }) => [type, start, end])).toEqual([
      ...both(WINDOW_START, NOW),
      ...both(WINDOW_START, OWED.start - 1),
      ...both(OWED.end + 1, NOW),
    ]);
    expect(rowsOf(deps)).toEqual(['before', 'after']);
    expect(world.fake.marksOf(PAYMENTS.walkId).rescanStuck).toEqual([OWED]);
  });
});

describe('when the fiat order walk is a whole window or more behind', () => {
  it('reads forward first and leaves the owed range for a later run', async () => {
    const world = worldOf(ORDERS);
    const cursor = NOW - 1_000 * DAY_MS;
    const owed = { start: NOW - 1_500 * DAY_MS, end: NOW - 1_499 * DAY_MS };
    world.seed({ cursor, pending: [owed] });
    const deps = world.depsOf();

    const result = await world.walk(deps);

    expect(queriesOf(ORDERS, deps)).toEqual(
      ['0', '1'].map((type) => ({ type, start: cursor, end: cursor + FIAT_WINDOW_MS, page: 1 })),
    );
    expect(cursorOf(ORDERS, world)).toBe(cursor + FIAT_WINDOW_MS);
    expect(pendingOf(ORDERS, world)).toContainEqual(owed);
    expect(result.complete).toBe(false);
  });

  it('reads forward at exactly one window behind, and is not complete while a range was owed', async () => {
    const world = worldOf(ORDERS);
    const cursor = NOW - FIAT_WINDOW_MS;
    world.seed({ cursor, pending: [{ start: cursor - DAY_MS, end: cursor }] });
    const deps = world.depsOf();

    const result = await world.walk(deps);

    expect(queriesOf(ORDERS, deps)).toEqual(
      ['0', '1'].map((type) => ({ type, start: cursor, end: NOW, page: 1 })),
    );
    expect(result.complete).toBe(false);
  });

  it('re-scans at a millisecond under one window behind', async () => {
    const world = worldOf(ORDERS);
    const cursor = NOW - FIAT_WINDOW_MS + 1;
    world.seed({ cursor, pending: [{ start: cursor - DAY_MS, end: cursor }] });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps)).toEqual(
      ['0', '1'].map((type) => ({ type, start: cursor - DAY_MS, end: cursor, page: 1 })),
    );
    expect(cursorOf(ORDERS, world)).toBe(cursor);
  });
});

describe('the span hints of the fiat order walk, which a run keeps for the passes it reads', () => {
  const hintsOf = (world: ReturnType<typeof worldOf>) =>
    world.fake.marksOf(ORDERS.walkId).spanHints;

  const NO_HINTS = { forward: [], pending: [], rescan: [], point: [] };

  const hintsWith = (pass: 'forward' | 'pending' | 'rescan', hint: Span) => ({
    ...NO_HINTS,
    [pass]: [hint],
  });

  const FORWARD_HINT = { start: NOW - HOUR_MS, end: NOW - HOUR_MS / 2 };

  const RESCAN_HINT = {
    start: NOW - FIAT_WINDOW_MS,
    end: NOW - FIAT_WINDOW_MS + 30 * DAY_MS,
  };

  const OWED = { start: HISTORY_FLOOR_MS + 100 * DAY_MS, end: HISTORY_FLOOR_MS + 101 * DAY_MS };

  /** The window of the owed range is read from its start, a hint of it begins right there. */
  const OWED_HINT = { start: OWED.start, end: OWED.start + HOUR_MS };

  it('keeps the forward hint on a re-scan run, and the forward read after it begins with it', async () => {
    const world = recentWorld(ORDERS);
    world.seed({
      pending: [{ start: NOW - 3 * HOUR_MS, end: NOW - 2 * HOUR_MS }],
      spanHints: hintsWith('forward', FORWARD_HINT),
    });
    const rescan = world.depsOf();

    await world.walk(rescan);

    expect(queriesOf(ORDERS, rescan).map(({ start }) => start)).toEqual([
      NOW - FIAT_WINDOW_MS,
      NOW - FIAT_WINDOW_MS,
    ]);
    expect(hintsOf(world)).toEqual(hintsWith('forward', FORWARD_HINT));

    const forward = world.depsOf({ now: () => NOW + 300_000 });
    await world.walk(forward);

    expect(queriesOf(ORDERS, forward)).toEqual(
      ['0', '1'].map((type) => ({
        type,
        start: FORWARD_HINT.start,
        end: FORWARD_HINT.end,
        page: 1,
      })),
    );
    expect(cursorOf(ORDERS, world)).toBe(FORWARD_HINT.end);
    expect(hintsOf(world)).toEqual(NO_HINTS);
  });

  it('keeps the forward hint on a run that reads the owed windows', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: [OWED], spanHints: hintsWith('forward', FORWARD_HINT) });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([OWED.start, OWED.start]);
    expect(hintsOf(world)).toEqual(hintsWith('forward', FORWARD_HINT));
  });

  it('keeps the owed hint on a forward run', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: [OWED], behindRun: true, spanHints: hintsWith('pending', OWED_HINT) });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([
      NOW - HOUR_MS,
      NOW - HOUR_MS,
    ]);
    expect(hintsOf(world)).toEqual(hintsWith('pending', OWED_HINT));
  });

  it('keeps the owed hint on a re-scan run', async () => {
    const world = recentWorld(ORDERS);
    world.seed({
      pending: [OWED],
      rescanTurn: true,
      spanHints: hintsWith('pending', OWED_HINT),
    });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([
      NOW - FIAT_WINDOW_MS,
      NOW - FIAT_WINDOW_MS,
    ]);
    expect(hintsOf(world)).toEqual(hintsWith('pending', OWED_HINT));
  });

  it('keeps the re-scan hint on a forward run', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ spanHints: hintsWith('rescan', RESCAN_HINT) });

    await world.walk(world.depsOf());

    expect(hintsOf(world)).toEqual(hintsWith('rescan', RESCAN_HINT));
  });

  it('keeps the re-scan hint on a run that reads the owed windows', async () => {
    const world = recentWorld(ORDERS);
    world.seed({ pending: [OWED], spanHints: hintsWith('rescan', RESCAN_HINT) });
    const deps = world.depsOf();

    await world.walk(deps);

    expect(queriesOf(ORDERS, deps).map(({ start }) => start)).toEqual([OWED.start, OWED.start]);
    expect(hintsOf(world)).toEqual(hintsWith('rescan', RESCAN_HINT));
  });
});

describe.each([ORDERS, PAYMENTS])('when the $name walk has a record that waits', (kind) => {
  it('reports unfinished while a record that waits is owed', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: 'Processing' })] }),
    });

    const result = await world.walk(deps);

    expect(result.complete).toBe(false);
  });
});

describe('what the fiat order walk imports', () => {
  it('credits a successful deposit to the Spot fiat holding with the bank total', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf()] }),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-eur-spot',
        amountMinorUnits: 10_000,
        time: FIAT_CREATED_AT,
        source: 'binance',
        externalId: `${world.accountId}:fiat:${FIAT_ORDER_NO}:EUR`,
        description: '',
        comment: '100.00 EUR',
        untrackedCounterpart: 'bank:EUR:100.00',
        operation: 'fiat',
      },
    ]);
    expect(cursorOf(ORDERS, world)).toBe(NOW);
    expect(pendingOf(ORDERS, world)).not.toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
  });

  it('debits a successful withdrawal by its amount and its total fee', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({
        '1': [fiatOrderOf({ indicatedAmount: '50.00', amount: '50.00', totalFee: '1.25' })],
      }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toMatchObject([
      {
        holdingId: 'h-eur-spot',
        amountMinorUnits: -5_125,
        comment: '50.00 EUR',
        untrackedCounterpart: 'bank:EUR:50.00',
        operation: 'fiat',
      },
    ]);
  });

  it('keeps the bank total at the fiat scale, however Binance wrote it', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf({ indicatedAmount: '100.0' })] }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toMatchObject([
      { comment: '100.0 EUR', untrackedCounterpart: 'bank:EUR:100.00' },
    ]);
  });

  it('imports a deposit when Binance leaves the fee out, as a deposit costs none', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf({ totalFee: undefined })] }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toMatchObject([{ amountMinorUnits: 10_000 }]);
  });

  it('counts a fiat Kiko does not track, lists its ticker and writes no row', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf({ fiatCurrency: 'XYZ' })] }),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(0);
    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
    expect(world.fake.notImported()).toEqual([]);
    expect(cursorOf(ORDERS, world)).toBe(NOW);
  });

  it.each([
    ['an amount', { amount: undefined }],
    ['an indicated amount', { indicatedAmount: undefined }],
    ['a fiat currency', { fiatCurrency: undefined }],
    ['a blank fiat currency', { fiatCurrency: '' }],
    ['an amount of zero', { amount: '0.00' }],
  ])(
    'lists a successful deposit with %s Kiko cannot use as not recognized',
    async (_name, over) => {
      const world = recentWorld(ORDERS);
      const deps = world.depsOf({
        fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf(over)] }),
      });

      await world.walk(deps);

      expect(deps.addTransactions).not.toHaveBeenCalled();
      expect(world.fake.notImported()).toEqual([entryOf(FIAT_ORDER_NO)]);
      expect(pendingOf(ORDERS, world)).not.toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    },
  );

  it('lists a successful withdrawal whose fee Binance leaves out, never guessing it', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '1': [fiatOrderOf({ totalFee: undefined })] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([entryOf(FIAT_ORDER_NO)]);
  });

  it('stops at an amount with a digit past the fiat scale and owes its point', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({
        '0': [
          fiatOrderOf({ orderNo: 'precise', amount: '100.001' }),
          fiatOrderOf({ orderNo: 'fine', createTime: FIAT_CREATED_AT + 1_000 }),
        ],
      }),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:fiat:fine:EUR`,
    ]);
    expect(pendingOf(ORDERS, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(cursorOf(ORDERS, world)).toBe(NOW);
    expect(stopCodes()).toContain('amount-precision');
  });

  it('stops at a bank total with a digit past the fiat scale and owes its point', async () => {
    const world = recentWorld(ORDERS);
    const deps = world.depsOf({
      fetchFiatOrders: world.serverOf({ '0': [fiatOrderOf({ indicatedAmount: '100.001' })] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(pendingOf(ORDERS, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(stopCodes()).toContain('amount-precision');
  });
});

describe('what the fiat payment walk imports', () => {
  it('imports a completed card buy on the Spot coin holding', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({ '0': [fiatPaymentOf()] }),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(addedRows(deps)).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: 100_000,
        time: FIAT_CREATED_AT,
        source: 'binance',
        externalId: `${world.accountId}:fiatpay:${FIAT_PAYMENT_NO}:BTC`,
        description: '',
        comment: '2600 UAH',
        untrackedCounterpart: 'card:UAH:2600.00',
        operation: 'card',
      },
    ]);
    expect(cursorOf(PAYMENTS, world)).toBe(NOW);
  });

  it('debits a completed card sale and marks the fiat it was sold for', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({
        '1': [fiatPaymentOf({ sourceAmount: '0.001', obtainAmount: '2590.50' })],
      }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toMatchObject([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -100_000,
        comment: '2590.50 UAH',
        untrackedCounterpart: 'card:UAH:2590.50',
        operation: 'card',
      },
    ]);
  });

  it('keeps a fiat Kiko has no scale for, with its total as Binance sent it', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({ '0': [fiatPaymentOf({ fiatCurrency: 'ZZZ' })] }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toMatchObject([
      { comment: '2600 ZZZ', untrackedCounterpart: 'card:ZZZ:2600' },
    ]);
  });

  it('counts a coin Kiko does not track, lists its ticker and writes no row', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({ '0': [fiatPaymentOf({ cryptoCurrency: 'XYZ' })] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(coinListPatchesOf(deps)).toEqual([
      { kind: 'coinList', coins: 'untrackedCoins', list: 'history', tickers: ['XYZ'] },
    ]);
  });

  it.each([
    ['a coin amount', { obtainAmount: undefined }],
    ['a fiat amount', { sourceAmount: undefined }],
    ['a fiat currency', { fiatCurrency: undefined }],
    ['a coin', { cryptoCurrency: undefined }],
    ['a coin amount of zero', { obtainAmount: '0' }],
  ])('lists a completed buy with %s Kiko cannot use as not recognized', async (_name, over) => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({ '0': [fiatPaymentOf(over)] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([entryOf(FIAT_PAYMENT_NO)]);
  });

  it.each([
    ['a blank fiat currency', ''],
    ['a fiat currency that holds the separator', 'U:AH'],
  ])('lists a buy and a sale with %s as not recognized and owes no point', async (_name, fiat) => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({
        '0': [fiatPaymentOf({ orderNo: 'buy', fiatCurrency: fiat })],
        '1': [
          fiatPaymentOf({
            orderNo: 'sale',
            fiatCurrency: fiat,
            sourceAmount: '0.001',
            obtainAmount: '2600',
          }),
        ],
      }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect([...world.fake.notImported()].sort()).toEqual([entryOf('buy'), entryOf('sale')].sort());
    expect(pendingOf(PAYMENTS, world)).toEqual([]);
    expect(cursorOf(PAYMENTS, world)).toBe(NOW);
    expect(stopCodes()).not.toContain('amount-malformed');
  });

  it('stops at a coin amount with a digit past the coin scale and owes its point', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({
        '0': [fiatPaymentOf({ obtainAmount: '0.0000000001' })],
      }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(pendingOf(PAYMENTS, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(stopCodes()).toContain('amount-precision');
  });

  it('stops at a fiat total with a digit past the fiat scale and owes its point', async () => {
    const world = recentWorld(PAYMENTS);
    const deps = world.depsOf({
      fetchFiatPayments: world.serverOf({ '0': [fiatPaymentOf({ sourceAmount: '2600.001' })] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(pendingOf(PAYMENTS, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(stopCodes()).toContain('amount-precision');
  });
});

describe.each([
  {
    kind: { ...ORDERS, noun: 'order' },
    unrecognized: [
      'Finished',
      'Refunding',
      'Refund Failed',
      'Order Partial Credit Stopped',
      'Failed',
      'Refunded',
      'an undocumented word',
    ],
    almost: [
      'successful',
      ' Successful',
      'Successful ',
      'Order Partial credit Stopped',
      'Refund  Failed',
      'SUCCESSFUL',
    ],
  },
  {
    kind: { ...PAYMENTS, noun: 'payment' },
    unrecognized: ['Failed', 'Refunded', 'an undocumented word'],
    almost: ['completed', 'Completed ', ' Completed', 'COMPLETED'],
  },
])('the status words of the $kind.name walk', ({ kind, unrecognized, almost }) => {
  it.each(unrecognized.map((status) => [kind.noun, status]))(
    'lists a fiat %s with status %s as not recognized',
    async (_noun, status) => {
      const world = recentWorld(kind);
      const deps = world.depsOf({
        [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status })] }),
      });

      await world.walk(deps);

      expect(deps.addTransactions).not.toHaveBeenCalled();
      expect(world.fake.notImported()).toEqual([entryOf(kind.recordOf().orderNo)]);
      expect(cursorOf(kind, world)).toBe(NOW);
      expect(pendingOf(kind, world)).not.toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    },
  );

  it('lists a record with no status as not recognized', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [{ ...kind.recordOf(), status: undefined }] }),
    });

    await world.walk(deps);

    expect(deps.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([entryOf(kind.recordOf().orderNo)]);
  });

  it.each(almost)(
    'settles only the exact allowlisted word, so %s is not recognized',
    async (status) => {
      const world = recentWorld(kind);
      const deps = world.depsOf({
        [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status })] }),
      });

      await world.walk(deps);

      expect(deps.addTransactions).not.toHaveBeenCalled();
      expect(world.fake.notImported()).toEqual([entryOf(kind.recordOf().orderNo)]);
    },
  );

  it('settles the allowlisted word into one row and no entry', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: kind.settledWord })] }),
    });

    await world.walk(deps);

    expect(addedRows(deps)).toHaveLength(1);
    expect(world.fake.notImported()).toEqual([]);
  });

  it.each([[kind.settledWord, 'Processing']])(
    'settles %s, owes %s and lists every word the doc does not show as moving no money',
    async (settled, open) => {
      const world = recentWorld(kind);
      const deps = world.depsOf({
        [kind.readKey]: world.serverOf({
          '0': [
            kind.recordOf({ orderNo: 'settled', status: settled, createTime: FIAT_CREATED_AT }),
            kind.recordOf({ orderNo: 'open', status: open, createTime: FIAT_CREATED_AT + 1_000 }),
            kind.recordOf({
              orderNo: 'failed',
              status: 'Failed',
              createTime: FIAT_CREATED_AT + 2_000,
            }),
            kind.recordOf({
              orderNo: 'refunded',
              status: 'Refunded',
              createTime: FIAT_CREATED_AT + 3_000,
            }),
          ],
        }),
      });

      await world.walk(deps);

      expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
        `${world.accountId}:${kind.keyPart}:settled:${kind.coin}`,
      ]);
      expect(pendingOf(kind, world)).toContainEqual(pointOf(FIAT_CREATED_AT + 1_000, '0'));
      expect([...world.fake.notImported()].sort()).toEqual([
        `fiat-unrecognized:failed:${FIAT_CREATED_AT + 2_000}`,
        `fiat-unrecognized:refunded:${FIAT_CREATED_AT + 3_000}`,
      ]);
    },
  );
});

describe.each([ORDERS, PAYMENTS])('a $name record that waits on Binance', (kind) => {
  it('owes the point of a Processing record and imports it once a later read sees it settled', async () => {
    const world = recentWorld(kind);

    const first = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: 'Processing' })] }),
    });
    await world.walk(first);

    expect(first.addTransactions).not.toHaveBeenCalled();
    expect(world.fake.notImported()).toEqual([]);
    expect(pendingOf(kind, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(cursorOf(kind, world)).toBe(NOW);
    expect(stopCodes()).toContain('fiat-not-settled');

    const second = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: kind.settledWord })] }),
    });
    await world.walk(second);

    expect(new Set(addedRows(second).map(({ externalId }) => externalId)).size).toBe(1);
    expect(pendingOf(kind, world)).not.toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
  });

  it('still imports the other records of the window of a record that waits', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: world.serverOf({
        '0': [
          kind.recordOf({ orderNo: 'waits', status: 'Processing' }),
          kind.recordOf({ orderNo: 'done', createTime: FIAT_CREATED_AT + 1_000 }),
        ],
      }),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(cursorOf(kind, world)).toBe(NOW);
  });

  it('keeps one entry when the re-scan reads a listed record again', async () => {
    const world = recentWorld(kind);
    const listed = kind.recordOf({ status: 'Finished' });

    await world.walk(world.depsOf({ [kind.readKey]: world.serverOf({ '0': [listed] }) }));
    const second = world.depsOf({ [kind.readKey]: world.serverOf({ '0': [listed] }) });
    await world.walk(second);

    const reads = queriesOf(kind, second).filter(
      ({ type, start, end }) => type === '0' && start <= FIAT_CREATED_AT && FIAT_CREATED_AT <= end,
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(world.fake.notImported()).toEqual([entryOf(kind.recordOf().orderNo)]);
  });
});

describe.each([ORDERS, PAYMENTS])('a $name record the client cannot read', (kind) => {
  it('owes the point of a record it cannot read and imports the rest of its window', async () => {
    const world = recentWorld(kind);
    const server = world.serverOf({
      '0': [kind.recordOf({ orderNo: 'good', createTime: FIAT_CREATED_AT + 1_000 })],
    });
    const deps = world.depsOf({
      [kind.readKey]: jest.fn(
        async (
          apiKey: string,
          secret: string,
          type: FiatTransactionType,
          span: Span,
          page: number,
        ) => {
          const found = await server(apiKey, secret, type, span, page);

          return type === '0' && span.start <= FIAT_CREATED_AT && FIAT_CREATED_AT <= span.end
            ? {
                ...found,
                unreadable: [{ time: FIAT_CREATED_AT }],
                gathered: found.gathered + 1,
                total: found.total + 1,
              }
            : found;
        },
      ),
    });

    const result = await world.walk(deps);

    expect(result.imported).toBe(1);
    expect(pendingOf(kind, world)).toContainEqual(pointOf(FIAT_CREATED_AT, '0'));
    expect(cursorOf(kind, world)).toBe(NOW);
    expect(stopCodes()).toContain('fiat-record-unreadable');
  });

  it('holds the walk at the window of an unreadable record with no time', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: jest.fn(async () =>
        fiatPageOf([], { unreadable: [{ time: undefined }], gathered: 1, total: 1 }),
      ),
    });

    const result = await world.walk(deps);

    expect(result.complete).toBe(false);
    expect(cursorOf(kind, world)).toBe(NOW - HOUR_MS);
    expect(stopCodes()).toContain('fiat-record-unreadable');
  });
});

describe.each([ORDERS, PAYMENTS])(
  'a $name record whose time holds a fraction of a millisecond',
  (kind) => {
    const FRACTIONAL_AT = FIAT_CREATED_AT + 0.5;
    const realRead = kind === ORDERS ? fetchFiatOrders : fetchFiatPayments;

    /**
     * Binance serves the one record with the fractional time, and answers a request whose time
     * is not a whole number with a 400, as it does for a time it cannot parse.
     */
    const serverOfFraction = () => {
      const requested: { beginTime: number; endTime: number }[] = [];
      const fetchImpl = (async (url: string) => {
        const query = new URL(url).searchParams;
        const beginTime = Number(query.get('beginTime'));
        const endTime = Number(query.get('endTime'));
        const reads = (time: number) => beginTime <= time && time <= endTime;
        const rows =
          query.get('transactionType') === '0'
            ? [
                kind.recordOf({ orderNo: 'fraction', createTime: FRACTIONAL_AT }),
                kind.recordOf({ orderNo: 'good', createTime: FIAT_CREATED_AT + 1_000 }),
              ].filter(({ createTime }) => reads(createTime))
            : [];

        requested.push({ beginTime, endTime });

        return Number.isInteger(beginTime) && Number.isInteger(endTime)
          ? {
              ok: true,
              status: 200,
              headers: new Headers(),
              json: async () => ({ code: '000000', total: rows.length, data: rows }),
            }
          : { ok: false, status: 400, headers: new Headers(), json: async () => ({ code: -1100 }) };
      }) as unknown as typeof fetch;

      return { fetchImpl, requested };
    };

    const RUNS = 6;

    it('reads its point in whole milliseconds, and no run is rejected for it', async () => {
      const world = recentWorld(kind);
      const { fetchImpl, requested } = serverOfFraction();
      const rejections: unknown[] = [];
      const imported: string[] = [];

      for (let index = 0; index < RUNS; index += 1) {
        const deps = world.depsOf({ fetchImpl, [kind.readKey]: realRead });

        await world.walk(deps).catch((error: unknown) => rejections.push(error));
        imported.push(...addedRows(deps).map(({ externalId }) => externalId));
      }

      expect(
        requested.filter(
          ({ beginTime, endTime }) => !Number.isInteger(beginTime) || !Number.isInteger(endTime),
        ),
      ).toEqual([]);
      expect(rejections).toEqual([]);
      expect(new Set(imported).size).toBe(1);
      expect(pendingOf(kind, world)).toContainEqual({
        start: Math.floor(FRACTIONAL_AT) - 1,
        end: Math.ceil(FRACTIONAL_AT) + 1,
        kind: 'point',
        series: '0',
        since: NOW,
      });
    });

    it('stamps its point with the time of the run that first owed it, and keeps it on every later run', async () => {
      const world = recentWorld(kind);
      const { fetchImpl } = serverOfFraction();

      for (const hours of [0, 5, 30]) {
        await world
          .walk(
            world.depsOf({
              fetchImpl,
              [kind.readKey]: realRead,
              now: () => NOW + hours * HOUR_MS,
            }),
          )
          .catch(() => undefined);
      }

      const points = pendingOf(kind, world) as { kind?: string; since?: number }[];

      expect(points.filter((ground) => ground.kind === 'point').map(({ since }) => since)).toEqual([
        NOW,
      ]);
    });
  },
);

describe.each([ORDERS, PAYMENTS])('a $name type with more records than a page shows', (kind) => {
  it('reads the first half of the span instead', async () => {
    const { depsOf, walk } = recentWorld(kind);
    const read = jest
      .fn()
      .mockResolvedValueOnce(fiatPageOf([], { gathered: kind.pageRows, total: kind.pageRows + 50 }))
      .mockResolvedValue(fiatPageOf());
    const deps = depsOf({ [kind.readKey]: read });

    await walk(deps);

    const [whole, half] = queriesOf(kind, deps);
    expect(half).toMatchObject({ type: '0', start: whole.start });
    expect(half.end).toBe(whole.start + Math.floor((whole.end - whole.start) / 2));
  });
});

describe.each([ORDERS, PAYMENTS])('a $name start Binance refuses', (kind) => {
  const KEPT_MS = 100 * DAY_MS;

  it('narrows a start Binance refuses as too old and walks on forward', async () => {
    const world = worldOf(kind);
    world.seed({ cursor: NOW - 120 * DAY_MS });
    const server = world.serverOf({
      '0': [
        kind.recordOf({ orderNo: 'refused', createTime: NOW - 110 * DAY_MS }),
        kind.recordOf({ orderNo: 'kept', createTime: NOW - 50 * DAY_MS }),
      ],
    });
    const deps = world.depsOf({
      [kind.readKey]: jest.fn(
        async (
          apiKey: string,
          secret: string,
          type: FiatTransactionType,
          span: Span,
          page: number,
        ) => {
          if (span.start < NOW - KEPT_MS) {
            throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
          }

          return server(apiKey, secret, type, span, page);
        },
      ),
    });

    await world.walk(deps, wideRun());

    expect(addedRows(deps).map(({ externalId }) => externalId)).toEqual([
      `${world.accountId}:${kind.keyPart}:kept:${kind.coin}`,
    ]);
    expect(cursorOf(kind, world)).toBe(NOW);
    expect(stopCodes()).toEqual([]);
  });

  it('keeps the window and the cursor on any other refusal code and reads it again next run', async () => {
    const world = recentWorld(kind);
    const failing = world.depsOf({
      [kind.readKey]: jest.fn(async () => {
        throw new Error('Binance request failed: 400: -1127');
      }),
    });

    await expect(world.walk(failing)).rejects.toThrow('-1127');

    const next = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: kind.settledWord })] }),
    });
    const result = await world.walk(next);

    expect(queriesOf(kind, next)[0].start).toBe(NOW - HOUR_MS);
    expect(cursorOf(kind, world)).toBe(NOW);
    expect(result.imported).toBe(1);
  });
});

describe.each([ORDERS, PAYMENTS])('a $name window whose page cannot be read', (kind) => {
  const CURSOR_AT = NOW - 1_000 * DAY_MS;
  const SECOND_WINDOW_START = CURSOR_AT + FIAT_WINDOW_MS;

  const unreadableSecondWindow = (world: ReturnType<typeof worldOf>) => {
    const server = world.serverOf({
      '0': [
        kind.recordOf({ orderNo: 'early', createTime: NOW - 900 * DAY_MS }),
        kind.recordOf({ orderNo: 'late', createTime: NOW - 100 * DAY_MS }),
      ],
    });

    return jest.fn(
      async (
        apiKey: string,
        secret: string,
        type: FiatTransactionType,
        span: Span,
        page: number,
      ) => {
        if (span.start >= SECOND_WINDOW_START) {
          throw new BinanceHistoryParseError();
        }

        return server(apiKey, secret, type, span, page);
      },
    );
  };

  const worldBehind = () => {
    const world = worldOf(kind);
    world.seed({ cursor: CURSOR_AT });

    return world;
  };

  /** Each run's deps and what it ended in: its result, or the error it rejected with. */
  const attempts = async (world: ReturnType<typeof worldOf>, count: number) => {
    const runs: { deps: AnyDeps; ended: unknown }[] = [];

    for (let run = 0; run < count; run += 1) {
      const deps = world.depsOf({ [kind.readKey]: unreadableSecondWindow(world) });
      const ended = await world.walk(deps).catch((error: unknown) => error);

      runs.push({ deps, ended });
    }

    return runs;
  };

  it('rejects the walk, moves no mark past the window and writes none of its rows', async () => {
    const world = worldBehind();

    const runs = await attempts(world, 3);

    expect(runs.at(-1)?.ended).toBeInstanceOf(BinanceHistoryParseError);
    expect(runs.flatMap(({ deps }) => addedRows(deps).map(({ externalId }) => externalId))).toEqual(
      [`${world.accountId}:${kind.keyPart}:early:${kind.coin}`],
    );
    expect(cursorOf(kind, world)).toBe(SECOND_WINDOW_START);
    expect(Math.max(...runs.flatMap(({ deps }) => numberMarkWritesOfAnyWalk(deps)))).toBe(
      SECOND_WINDOW_START,
    );
  });

  it('reads a window whose page cannot be read again on every run, never passing it', async () => {
    const world = worldBehind();

    const runs = await attempts(world, 4);

    expect(runs.slice(-2).map(({ ended }) => ended instanceof BinanceHistoryParseError)).toEqual([
      true,
      true,
    ]);
    expect(runs.slice(-2).map(({ deps }) => queriesOf(kind, deps)[0].start)).toEqual([
      SECOND_WINDOW_START,
      SECOND_WINDOW_START,
    ]);
    expect(runs.slice(-2).map(({ deps }) => addedRows(deps).length)).toEqual([0, 0]);
    expect(cursorOf(kind, world)).toBe(SECOND_WINDOW_START);
  });
});

describe.each([ORDERS, PAYMENTS])('a failure of the $name walk', (kind) => {
  it('writes the windows read before the limit, sets the cooldown and resolves', async () => {
    const world = worldOf(kind);
    const cursorAt = NOW - 1_000 * DAY_MS;
    world.seed({ cursor: cursorAt });
    const server = world.serverOf({
      '0': [kind.recordOf({ orderNo: 'one', createTime: NOW - 900 * DAY_MS })],
    });
    const read = jest.fn(
      async (
        apiKey: string,
        secret: string,
        type: FiatTransactionType,
        span: Span,
        page: number,
      ) => {
        if (type === '1' && span.start !== cursorAt) {
          throw new BinanceRateLimitError(429, 30_000);
        }

        return server(apiKey, secret, type, span, page);
      },
    );

    const runs = await walkRuns(world, 2, () => ({ [kind.readKey]: read }));

    expect(runs.map(({ result }) => result.imported)).toEqual([1, 0]);
    expect(runs.at(-1)?.result.complete).toBe(false);
    expect(cursorOf(kind, world)).toBe(cursorAt + FIAT_WINDOW_MS);
    expect(isBinanceCoolingDown(world.accountId, NOW + 29_000)).toBe(true);
    expect(isBinanceCoolingDown(world.accountId, NOW + 30_000)).toBe(false);
  });

  it('moves no mark past a window whose rows fail to write and rethrows', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: world.serverOf({ '0': [kind.recordOf({ status: kind.settledWord })] }),
      addTransactions: jest.fn(async () => {
        throw new Error('the rows could not be written');
      }),
    });

    await expect(world.walk(deps)).rejects.toThrow('the rows could not be written');

    expect(cursorOf(kind, world)).toBe(NOW - HOUR_MS);
    expect(numberMarkWritesOfAnyWalk(deps)).toEqual([]);
  });

  it('does not set a cooldown on a failure that is not a rate limit', async () => {
    const world = worldOf(kind);
    const deps = world.depsOf({
      [kind.readKey]: jest.fn(async () => {
        throw new Error('Binance request failed: 403');
      }),
    });

    await expect(world.walk(deps, wideRun())).rejects.toThrow('403');
    expect(isBinanceCoolingDown(world.accountId, NOW)).toBe(false);
  });

  it('reads no other window once Binance has rate limited it, though the budget has calls left', async () => {
    const world = recentWorld(kind);
    const deps = world.depsOf({
      [kind.readKey]: jest.fn(async () => {
        throw new BinanceRateLimitError(429, 30_000);
      }),
    });

    const result = await world.walk(deps, wideRun());

    expect(queriesOf(kind, deps)).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(isBinanceCoolingDown(world.accountId, NOW + 1_000)).toBe(true);
  });
});

describe.each([ORDERS, PAYMENTS])('the $name walk and its budget', (kind) => {
  it('reads both types of a window or neither', async () => {
    for (let left = kind.laneCalls; left >= 0; left -= 1) {
      const { depsOf, walk } = worldOf(kind);
      const deps = depsOf();
      const run = freshRun();

      for (let spent = 0; spent < kind.laneCalls - left; spent += 1) {
        run.budget.record(kind.walkId, { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
      }

      await walk(deps, run);

      expect(queriesOf(kind, deps).map(({ type }) => type)).toEqual(
        Array.from({ length: Math.floor(left / 2) }, () => ['0', '1']).flat(),
      );
    }
  });

  it('asks for, and records, every call on its own lane at its own cost', async () => {
    const world = recentWorld(kind);
    const page = fiatPageOf([kind.recordOf({ status: kind.settledWord })]);
    const spy = {
      canAfford: jest.fn<boolean, Parameters<BinanceRunBudget['canAfford']>>(() => true),
      record: jest.fn<void, Parameters<BinanceRunBudget['record']>>(),
    };
    const run = createExchangeRun({
      intervalMs: 0,
      clock: { now: () => NOW, sleep: async () => undefined },
      budget: spy,
    });

    await world.walk(world.depsOf({ [kind.readKey]: jest.fn(async () => page) }), run);

    expect(spy.canAfford.mock.calls.length).toBeGreaterThan(0);
    expect(spy.canAfford.mock.calls.map(([lane, cost]) => [lane, cost])).toEqual(
      spy.canAfford.mock.calls.map(() => [kind.walkId, kind.cost]),
    );
    expect(spy.record.mock.calls.length).toBeGreaterThan(0);
    expect(spy.record.mock.calls).toEqual(
      spy.record.mock.calls.map(() => [kind.walkId, page, false]),
    );
  });
});
