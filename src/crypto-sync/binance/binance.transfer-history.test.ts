import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import { i18n } from '@kiko/i18n/init';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { ExchangeHolding } from '@kiko/holdings/repo';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import { exchangeExcludedTransactionIds } from '@kiko/statistics/exchange-exclusion';

import {
  type BinanceUniversalTransfer,
  type TotalPage,
  type UniversalTransferType,
  UNIVERSAL_TRANSFER_TYPES,
} from './binance.history-client';
import {
  type BinanceHistoryRow,
  type BinanceTransferHistoryDeps,
  settledTransfersOf,
  syncBinanceTransferHistory,
  TRANSFER_FORWARD_OWES,
  TRANSFER_SETTLED_STATUS,
  TRANSFER_WINDOW_MS,
  transferFloorMs,
  transferRowsOf,
} from './binance.transfer-history';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceWalkStop } from './binance.history-walk';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { isBinanceCoolingDown } from './binance.cooldown';
import { FUNDING_KEY, SPOT_KEY } from './binance.holding-keys';
import { BinanceHistoryTooOldError, BinanceRateLimitError } from './binance.client';
import { jitterMs, movingClockOf, suspendableRun } from './binance.depth-test-fixtures';
import { COSTS, createBinanceHistoryRun, LANE_CALL_CAPS } from './binance.history-budget';
import { DEPTH_MARGIN_MS, DEPTH_RESOLUTION_MS, MAX_DEPTH_REFUSALS } from './binance.history-depth';

const FLOOR = NOW - 179 * DAY_MS;
const STOP_TAG = '[binance sync] history window stopped';
const CAP = LANE_CALL_CAPS.transfer;
const TYPE_COUNT = UNIVERSAL_TRANSFER_TYPES.length;
const SPOT_FIELDS = {
  cursor: 'binanceTransferHistoryCursor',
  rescan: 'binanceTransferRescanCursor',
  pending: 'binanceTransferPendingOverlap',
  point: 'binanceTransferPointCursor',
} as const;

const agoMs = (days: number): number => NOW - days * DAY_MS;

const transferOf = (over: Partial<BinanceUniversalTransfer> = {}): BinanceUniversalTransfer => ({
  asset: 'BTC',
  amount: '0.001',
  type: 'MAIN_FUNDING',
  status: 'CONFIRMED',
  tranId: 't-1',
  timestamp: agoMs(2),
  ...over,
});

describe('transferFloorMs', () => {
  it('is 179 whole days back, so no request is older than the 180 days Binance was seen to serve', () => {
    expect(transferFloorMs(NOW)).toBe(FLOOR);
    expect(transferFloorMs(Date.UTC(2026, 9, 10, 13, 45, 12, 345))).toBe(
      Date.UTC(2026, 9, 10, 13, 45, 12, 345) - 179 * DAY_MS,
    );
  });

  it('is never more than 179 days back, whatever the day of the year or the length of the months', () => {
    const FIRST_DAY = Date.UTC(2024, 0, 1, 23, 59, 59, 999);
    const ages = Array.from({ length: 2 * 366 }, (_unused, day) => {
      const now = FIRST_DAY + day * DAY_MS;

      return now - transferFloorMs(now);
    });

    expect(Math.max(...ages)).toBe(179 * DAY_MS);
    expect(Math.min(...ages)).toBe(179 * DAY_MS);
  });

  it('never goes before the shared history floor', () => {
    expect(transferFloorMs(Date.UTC(2017, 8, 1))).toBe(HISTORY_FLOOR_MS);
  });

  it('is the window of 30 days the walk reads', () => {
    expect(TRANSFER_WINDOW_MS).toBe(30 * DAY_MS);
  });
});

describe('transferRowsOf', () => {
  const ACCOUNT = 'acc-1';
  const SATOSHIS = 100_000;
  const rowsOf = (over: Partial<BinanceUniversalTransfer> = {}, readAs?: UniversalTransferType) =>
    transferRowsOf(
      ACCOUNT,
      transferOf(over),
      readAs ?? (over.type as UniversalTransferType | undefined) ?? 'MAIN_FUNDING',
    );
  const codeOf = (attempt: () => unknown): string | undefined => {
    try {
      attempt();
    } catch (error) {
      return error instanceof BinanceWalkStop ? error.code : undefined;
    }

    return undefined;
  };

  it('T1: a MAIN_FUNDING transfer is Spot -x and Funding +x, each leg naming the other wallet, one pair id', () => {
    expect(rowsOf()).toEqual([
      {
        wallet: SPOT_KEY,
        counterpartWallet: FUNDING_KEY,
        amountMinorUnits: -SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:xfer:MAIN_FUNDING:t-1:BTC',
        exchangePairId: 'acc-1:xfer:MAIN_FUNDING:t-1',
        description: '',
      },
      {
        wallet: FUNDING_KEY,
        counterpartWallet: SPOT_KEY,
        amountMinorUnits: SATOSHIS,
        time: agoMs(2),
        externalId: 'acc-1:xfer:MAIN_FUNDING:t-1:BTC:funding',
        exchangePairId: 'acc-1:xfer:MAIN_FUNDING:t-1',
        description: '',
      },
    ]);
  });

  it('T2: a FUNDING_MAIN transfer is the reverse: Funding -x and Spot +x', () => {
    const rows = rowsOf({ type: 'FUNDING_MAIN' });

    expect(rows.map((row) => [row.wallet, row.amountMinorUnits, row.counterpartWallet])).toEqual([
      [FUNDING_KEY, -SATOSHIS, SPOT_KEY],
      [SPOT_KEY, SATOSHIS, FUNDING_KEY],
    ]);
    expect(new Set(rows.map((row) => row.exchangePairId))).toEqual(
      new Set(['acc-1:xfer:FUNDING_MAIN:t-1']),
    );
  });

  it.each([
    ['MAIN_UMFUTURE', SPOT_KEY, -1, 'wallet:UMFUTURE'],
    ['UMFUTURE_MAIN', SPOT_KEY, 1, 'wallet:UMFUTURE'],
    ['MAIN_CMFUTURE', SPOT_KEY, -1, 'wallet:CMFUTURE'],
    ['CMFUTURE_MAIN', SPOT_KEY, 1, 'wallet:CMFUTURE'],
    ['MAIN_MARGIN', SPOT_KEY, -1, 'wallet:MARGIN'],
    ['MARGIN_MAIN', SPOT_KEY, 1, 'wallet:MARGIN'],
    ['MAIN_OPTION', SPOT_KEY, -1, 'wallet:OPTION'],
    ['OPTION_MAIN', SPOT_KEY, 1, 'wallet:OPTION'],
    ['MAIN_PORTFOLIO_MARGIN', SPOT_KEY, -1, 'wallet:PORTFOLIO_MARGIN'],
    ['PORTFOLIO_MARGIN_MAIN', SPOT_KEY, 1, 'wallet:PORTFOLIO_MARGIN'],
    ['FUNDING_UMFUTURE', FUNDING_KEY, -1, 'wallet:UMFUTURE'],
    ['UMFUTURE_FUNDING', FUNDING_KEY, 1, 'wallet:UMFUTURE'],
    ['FUNDING_CMFUTURE', FUNDING_KEY, -1, 'wallet:CMFUTURE'],
    ['CMFUTURE_FUNDING', FUNDING_KEY, 1, 'wallet:CMFUTURE'],
    ['FUNDING_MARGIN', FUNDING_KEY, -1, 'wallet:MARGIN'],
    ['MARGIN_FUNDING', FUNDING_KEY, 1, 'wallet:MARGIN'],
    ['FUNDING_OPTION', FUNDING_KEY, -1, 'wallet:OPTION'],
    ['OPTION_FUNDING', FUNDING_KEY, 1, 'wallet:OPTION'],
  ] as const)(
    'T3/T4: %s is one leg on the tracked wallet (%s), signed %i by the wallet that is the source, tagged %s',
    (type, wallet, sign, code) => {
      expect(rowsOf({ type })).toEqual([
        {
          wallet,
          amountMinorUnits: sign * SATOSHIS,
          time: agoMs(2),
          externalId: `acc-1:xfer:${type}:t-1:${wallet}`,
          untrackedCounterpart: code,
          description: '',
        },
      ]);
    },
  );

  it('covers all 20 types: the two own wallets and the 18 untracked ones', () => {
    const own = UNIVERSAL_TRANSFER_TYPES.filter((type) => rowsOf({ type }).length === 2);

    expect(own).toEqual(['MAIN_FUNDING', 'FUNDING_MAIN']);
    expect(UNIVERSAL_TRANSFER_TYPES.length - own.length).toBe(18);
  });

  it('T5: only the status CONFIRMED is settled', () => {
    expect(TRANSFER_SETTLED_STATUS).toBe('CONFIRMED');
    expect(rowsOf({ status: TRANSFER_SETTLED_STATUS })).toHaveLength(2);
  });

  it('T5: a status that is not CONFIRMED is not settled, whatever it says', () => {
    for (const status of ['PENDING', '', 'confirmed', 'PROCESS']) {
      expect(codeOf(() => rowsOf({ status }))).toBe('transfer-not-settled');
    }
  });

  it('T11: a FAILED transfer is a stop of its own', () => {
    expect(codeOf(() => rowsOf({ status: 'FAILED' }))).toBe('transfer-failed');
  });

  it('owes and goes past in the forward pass every stop of one transfer, and no stop of the span as a whole', () => {
    expect([...TRANSFER_FORWARD_OWES].sort()).toEqual([
      'transfer-amount-invalid',
      'transfer-failed',
      'transfer-id-missing',
      'transfer-not-settled',
      'transfer-row-unreadable',
      'transfer-type-mismatch',
    ]);
    expect(TRANSFER_FORWARD_OWES).not.toContain('transfer-page-drift');
    expect(TRANSFER_FORWARD_OWES).not.toContain('transfer-holding-missing');
  });

  it('T6: a row of another asset gives no row', () => {
    expect(rowsOf({ asset: 'ETH' })).toEqual([]);
  });

  it('T10: a row whose type is not the type it was read under is a stop', () => {
    expect(codeOf(() => rowsOf({ type: 'MAIN_UMFUTURE' }, 'MAIN_FUNDING'))).toBe(
      'transfer-type-mismatch',
    );
  });

  it('stops a settled row with no id', () => {
    expect(codeOf(() => rowsOf({ tranId: '' }))).toBe('transfer-id-missing');
  });

  it.each([['0'], ['0.00000000'], ['-0.5'], ['x'], ['']])(
    'stops a settled row whose amount is %p: it is no positive number of satoshis',
    (amount) => {
      expect(codeOf(() => rowsOf({ amount }))).toBe('transfer-amount-invalid');
    },
  );

  it('keys each leg by the type too, so a tranId two types share never refreshes the other type row', () => {
    const first = rowsOf({ type: 'MAIN_FUNDING' });
    const second = rowsOf({ type: 'FUNDING_MAIN' });
    const secondKeys = second.map((row) => row.externalId);

    expect(first.filter((row) => secondKeys.includes(row.externalId))).toEqual([]);
    expect(first[0].exchangePairId).not.toBe(second[0].exchangePairId);
  });

  it('keys the legs of two accounts apart, for one tranId', () => {
    const other = transferRowsOf('acc-2', transferOf(), 'MAIN_FUNDING');

    expect(other[0].externalId).toBe('acc-2:xfer:MAIN_FUNDING:t-1:BTC');
  });
});

describe('settledTransfersOf, for ground a type left owed in itself', () => {
  const span = { start: 1_000, end: 5_000 };
  const readOf = (owed?: { series: UniversalTransferType; window: typeof span }[]) => ({
    read: [
      { series: 'MAIN_FUNDING' as const, rows: [transferOf({ timestamp: 2_000 })], unreadable: [] },
    ],
    drifted: [],
    ...foldMap(maybe(owed), (ground) => ({ owed: ground })),
  });

  it('owes it as a range in that type alone, beside the rows of the types that were read', () => {
    const settled = settledTransfersOf({
      accountId: 'acc-1',
      span,
      read: readOf([
        { series: 'MAIN_FUNDING', window: { start: 1_000, end: 1_500 } },
        { series: 'FUNDING_MAIN', window: span },
      ]),
    });

    expect(settled.rows).toHaveLength(2);
    expect(settled.codes).toEqual([]);
    expect(settled.owed).toEqual([
      { start: 1_000, end: 1_500, series: 'MAIN_FUNDING' },
      { start: 1_000, end: 5_000, series: 'FUNDING_MAIN' },
    ]);
  });

  it('owes the same ground of one type once', () => {
    const band = { series: 'MAIN_FUNDING' as const, window: { start: 1_000, end: 1_500 } };

    const settled = settledTransfersOf({ accountId: 'acc-1', span, read: readOf([band, band]) });

    expect(settled.owed).toEqual([{ start: 1_000, end: 1_500, series: 'MAIN_FUNDING' }]);
  });

  it('owes nothing for a read that reports no owed ground', () => {
    expect(settledTransfersOf({ accountId: 'acc-1', span, read: readOf() }).owed).toEqual([]);
  });
});

type Entry =
  | { readAs: UniversalTransferType; row: BinanceUniversalTransfer }
  | { readAs: UniversalTransferType; unreadable: { time: number | undefined } };

const entryOf = (
  over: Partial<BinanceUniversalTransfer> = {},
  readAs?: UniversalTransferType,
): Entry => ({
  readAs: readAs ?? (over.type as UniversalTransferType | undefined) ?? 'MAIN_FUNDING',
  row: transferOf(over),
});

const unreadableOf = (readAs: UniversalTransferType, time: number | undefined): Entry => ({
  readAs,
  unreadable: { time },
});

type TransferQuery = {
  type: UniversalTransferType;
  startTime: number;
  endTime: number;
  current: number;
};

const PAGE_SIZE = 100;

const pageOf = (over: Partial<TotalPage<BinanceUniversalTransfer>> = {}) => ({
  rows: [],
  unreadable: [],
  gathered: 0,
  total: 0,
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  ...over,
});

const timeOfEntry = (entry: Entry): number | undefined =>
  'row' in entry ? entry.row.timestamp : entry.unreadable.time;

type Answer = (query: TransferQuery) => TotalPage<BinanceUniversalTransfer> | undefined;

/**
 * Binance's answer for one type, one range (both ends included, or with the end left out as the
 * live transfer endpoint does, `endLeftOut`) and one page of 100. `answer` may replace the page
 * of a read (a full page that makes the walk halve the span, a drift).
 */
const serverOf = (entries: Entry[], answer?: Answer, endLeftOut = false) =>
  jest.fn(
    async (
      _apiKey: string,
      _secret: string,
      query: TransferQuery,
    ): Promise<TotalPage<BinanceUniversalTransfer>> => {
      const replaced = answer?.(query);

      if (replaced !== undefined) {
        return replaced;
      }

      const inRange = entries.filter((entry) => {
        const time = timeOfEntry(entry);

        return (
          entry.readAs === query.type &&
          (time === undefined ||
            (query.startTime <= time &&
              (endLeftOut ? time < query.endTime : time <= query.endTime)))
        );
      });
      const page = inRange.slice((query.current - 1) * PAGE_SIZE, query.current * PAGE_SIZE);

      return pageOf({
        rows: page.flatMap((entry) =>
          'row' in entry && entry.row.asset === 'BTC' ? [entry.row] : [],
        ),
        unreadable: page.flatMap((entry) => ('unreadable' in entry ? [entry.unreadable] : [])),
        gathered: page.length,
        total: inRange.length,
      });
    },
  );

/** A page the server shows full, with more rows behind it, so the walk halves the span. */
const fullPage = (): TotalPage<BinanceUniversalTransfer> =>
  pageOf({ gathered: PAGE_SIZE, total: PAGE_SIZE + 50 });

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

type World = {
  metadata: Record<string, unknown>;
  others: HoldingRow[];
  added: BinanceHistoryRow[];
  events: string[];
};

/**
 * The Spot holding of a connected account, which carries the walk's marks, and what the repos
 * hold: the other holdings, the rows written, and the writes in order.
 */
const worldOf = (
  metadata: Record<string, unknown> = {},
  others: HoldingRow[] = [holdingWith('h-funding', { binanceAsset: FUNDING_KEY })],
): World => ({
  metadata: { binanceAsset: SPOT_KEY, ...metadata },
  others,
  added: [],
  events: [],
});

const depsOf = (
  world: World,
  server: ReturnType<typeof serverOf>,
  over: Partial<BinanceTransferHistoryDeps> = {},
): BinanceTransferHistoryDeps => ({
  now: () => NOW,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  listHoldings: async () => [holdingWith('h-spot', world.metadata), ...world.others],
  fetchUniversalTransfers: server,
  ensureHoldings: jest.fn(async (created: Omit<ExchangeHolding, 'renameFromDefault'>[]) => {
    for (const holding of created) {
      world.events.push(`ensure:${holding.metadataKey}`);
      world.others.push(
        holdingWith(`created-${holding.metadataKey}`, { binanceAsset: holding.metadataKey }),
      );
    }
  }),
  addTransactions: jest.fn(async (rows: BinanceHistoryRow[]) => {
    world.events.push('rows');
    world.added.push(...rows);

    return rows.length;
  }),
  writeWalkCursor: jest.fn(async (_holdingId: string, field: string, cursorMs: number) => {
    world.events.push(`cursor:${field}`);
    world.metadata = { ...world.metadata, [field]: cursorMs };
  }),
  writeWalkPending: jest.fn(async (_holdingId: string, field: string, ranges: unknown[]) => {
    world.events.push('list');
    world.metadata = { ...world.metadata, [field]: ranges };
  }),
  writeWalkHints: jest.fn(async (_holdingId: string, field: string, hints: unknown) => {
    world.metadata = { ...world.metadata, [field]: hints };
  }),
  ...over,
});

// `cooldownUntilByAccount` is module-level and has no exported reset, so every case uses its own
// account id.
let accountSequence = 0;
const nextAccountId = (): string => {
  accountSequence += 1;

  return `acc-xfer-${accountSequence}`;
};

const freshRun = () => createBinanceHistoryRun({ now: () => NOW, sleep: async () => undefined });

const requestsOf = (deps: BinanceTransferHistoryDeps): TransferQuery[] =>
  (deps.fetchUniversalTransfers as jest.Mock).mock.calls.map((call) => call[2] as TransferQuery);

/** One run of the walk on `world`, with Binance answering from `entries`. */
const walkOnce = async (input: {
  world: World;
  entries?: Entry[];
  answer?: Answer;
  endLeftOut?: boolean;
  accountId?: string;
  run?: ReturnType<typeof freshRun>;
  now?: number;
  over?: Partial<BinanceTransferHistoryDeps>;
}) => {
  const { world, entries = [], answer, accountId = 'acc-1', run = freshRun() } = input;
  const deps = depsOf(world, serverOf(entries, answer, input.endLeftOut), {
    ...foldMap(maybe(input.now), (nowMs) => ({ now: () => nowMs })),
    ...input.over,
  });
  const result = await syncBinanceTransferHistory({ targetAccountId: accountId, run }, deps);

  return { result, deps, requests: requestsOf(deps), accountId };
};

const HOUR_MS = 3_600_000;
const RUN_GAPS = [0, HOUR_MS, DAY_MS];

/** The keys of the two rows a MAIN_FUNDING transfer imports. */
const keysOf = (tranId: string): string[] => [
  `acc-1:xfer:MAIN_FUNDING:${tranId}:BTC`,
  `acc-1:xfer:MAIN_FUNDING:${tranId}:BTC:funding`,
];

type RunBinding = { answer?: Answer; over?: Partial<BinanceTransferHistoryDeps> };

/**
 * `runs` runs on one world, each `gapMs` after the one before, each against the answer (and the
 * deps) that `bindingAt` gives for its own start.
 */
const walkRuns = async (input: {
  world: World;
  entries?: Entry[];
  gapMs: number;
  runs: number;
  bindingAt?: (now: number) => RunBinding;
  endLeftOut?: boolean;
}) => {
  const { world, entries, gapMs, runs, bindingAt = () => ({}), endLeftOut } = input;
  const requests: TransferQuery[] = [];
  const afterFirst: string[] = [];

  for (let index = 0; index < runs; index += 1) {
    const nowMs = NOW + index * gapMs;
    const run = await walkOnce({
      world,
      entries,
      endLeftOut,
      ...(index === 0 ? {} : { now: nowMs }),
      ...bindingAt(nowMs),
    });
    requests.push(...run.requests);

    if (index === 0) {
      afterFirst.push(...world.added.map((row) => row.externalId));
    }
  }

  return {
    afterFirst,
    ids: [...new Set(world.added.map((row) => row.externalId))],
    requests,
    secondNow: NOW + (runs - 1) * gapMs,
  };
};

/** Two runs on one world, the second `gapMs` later (see `walkRuns`). */
const walkTwice = (input: Omit<Parameters<typeof walkRuns>[0], 'runs'>) =>
  walkRuns({ ...input, runs: 2 });

const listOf = (world: World): unknown[] =>
  (world.metadata[SPOT_FIELDS.pending] as unknown[] | undefined) ?? [];

const pointsIn = (list: unknown[]): unknown[] =>
  list.filter((ground) => (ground as { kind?: string }).kind === 'point');

const pointOf = (time: number, series: string, reach = 1) => ({
  start: time - reach,
  end: time + reach,
  kind: 'point',
  series,
});

const stopCodes = (spy: jest.SpyInstance): string[] =>
  spy.mock.calls
    .filter((call) => call[0] === STOP_TAG)
    .map((call) => (call[1] as { code: string }).code);

const spend = (run: ReturnType<typeof freshRun>, calls: number): void => {
  for (let call = 0; call < calls; call += 1) {
    run.budget.record('transfer', { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
  }
};

let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('the rows of a settled transfer, written', () => {
  const cursorBehind = { [SPOT_FIELDS.cursor]: agoMs(5) };

  it('T1: writes Spot -x and Funding +x, each leg naming the other holding, one pair id, out of spending, labelled "Transfer to/from"', async () => {
    const world = worldOf(cursorBehind);

    const { result } = await walkOnce({ world, entries: [entryOf({ timestamp: agoMs(2) })] });

    expect(result).toEqual({ imported: 2, complete: true });
    expect(world.added).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -100_000,
        time: agoMs(2),
        source: 'binance',
        externalId: 'acc-1:xfer:MAIN_FUNDING:t-1:BTC',
        exchangeCounterpartHoldingId: 'h-funding',
        exchangePairId: 'acc-1:xfer:MAIN_FUNDING:t-1',
        description: '',
      },
      {
        holdingId: 'h-funding',
        amountMinorUnits: 100_000,
        time: agoMs(2),
        source: 'binance',
        externalId: 'acc-1:xfer:MAIN_FUNDING:t-1:BTC:funding',
        exchangeCounterpartHoldingId: 'h-spot',
        exchangePairId: 'acc-1:xfer:MAIN_FUNDING:t-1',
        description: '',
      },
    ]);

    const stored = world.added.map((row) => ({
      id: row.externalId,
      exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId ?? null,
      untrackedCounterpart: row.untrackedCounterpart ?? null,
    }));
    expect(exchangeExcludedTransactionIds(stored)).toEqual(new Set(stored.map((row) => row.id)));

    const names = new Map([
      ['h-spot', 'Binance Spot'],
      ['h-funding', 'Binance Funding'],
    ]);
    const currencies = new Map([
      ['h-spot', 'BTC'],
      ['h-funding', 'BTC'],
    ]);
    const [spent, received] = world.added.map((row) =>
      transactionRowDescription({
        transaction: {
          holdingId: row.holdingId,
          description: row.description,
          amountMinorUnits: row.amountMinorUnits,
          exchangeCounterpartHoldingId: row.exchangeCounterpartHoldingId ?? null,
          untrackedCounterpart: null,
        },
        holdingName: names.get(row.holdingId) ?? '',
        holdingNameById: names,
        holdingCurrencyById: currencies,
        t: i18n.t,
      }),
    );
    expect(spent).toBe('Transfer to Binance Funding');
    expect(received).toBe('Transfer from Binance Spot');
  });

  it('T2: a FUNDING_MAIN transfer is Funding -x and Spot +x', async () => {
    const world = worldOf(cursorBehind);

    await walkOnce({
      world,
      entries: [entryOf({ type: 'FUNDING_MAIN', timestamp: agoMs(2), tranId: 'back' })],
    });

    expect(world.added.map((row) => [row.holdingId, row.amountMinorUnits])).toEqual([
      ['h-funding', -100_000],
      ['h-spot', 100_000],
    ]);
  });

  it('T3: a MAIN_UMFUTURE transfer is one Spot leg, negative, tagged with the wallet it went to, with no pair', async () => {
    const world = worldOf(cursorBehind);

    await walkOnce({ world, entries: [entryOf({ type: 'MAIN_UMFUTURE', timestamp: agoMs(2) })] });

    expect(world.added).toEqual([
      {
        holdingId: 'h-spot',
        amountMinorUnits: -100_000,
        time: agoMs(2),
        source: 'binance',
        externalId: 'acc-1:xfer:MAIN_UMFUTURE:t-1:BTC',
        untrackedCounterpart: 'wallet:UMFUTURE',
        description: '',
      },
    ]);
  });

  it('T4: an UMFUTURE_FUNDING transfer is one Funding leg, positive, tagged with the wallet it came from', async () => {
    const world = worldOf(cursorBehind);

    await walkOnce({
      world,
      entries: [entryOf({ type: 'UMFUTURE_FUNDING', timestamp: agoMs(2) })],
    });

    expect(
      world.added.map((row) => [row.holdingId, row.amountMinorUnits, row.untrackedCounterpart]),
    ).toEqual([['h-funding', 100_000, 'wallet:UMFUTURE']]);
  });

  it('T6: a transfer of another asset is ignored, and counted for the pager: a full page of other assets with one BTC row is the whole page', async () => {
    const world = worldOf(cursorBehind);
    const others = Array.from({ length: PAGE_SIZE - 1 }, (_unused, index) =>
      entryOf({ asset: 'ETH', tranId: `eth-${index}`, timestamp: agoMs(3) }),
    );

    const { result, requests } = await walkOnce({
      world,
      entries: [...others, entryOf({ tranId: 'btc', timestamp: agoMs(2) })],
    });

    expect(world.added.map((row) => row.externalId)).toEqual([
      'acc-1:xfer:MAIN_FUNDING:btc:BTC',
      'acc-1:xfer:MAIN_FUNDING:btc:BTC:funding',
    ]);
    expect(result.complete).toBe(true);
    expect(requests.filter((request) => request.current === 2)).toEqual([]);
  });

  it('T7: creates the missing Funding holding at zero first, then writes the legs on it', async () => {
    const world = worldOf(cursorBehind, []);

    const { deps } = await walkOnce({
      world,
      accountId: 'acc-1',
      entries: [entryOf({ timestamp: agoMs(2) })],
    });

    expect(deps.ensureHoldings).toHaveBeenCalledWith([
      expect.objectContaining({
        accountId: 'acc-1',
        metadataKey: FUNDING_KEY,
        balanceMinorUnits: 0,
      }),
    ]);
    expect(world.added.map((row) => row.holdingId)).toEqual(['h-spot', 'created-BTC:funding']);
    expect(world.added[0].exchangeCounterpartHoldingId).toBe('created-BTC:funding');
  });

  it('writes the same keys again on a second identical run, for the deduping import to refresh', async () => {
    const world = worldOf(cursorBehind);
    const entries = [entryOf({ timestamp: agoMs(2) })];

    await walkOnce({ world, entries });
    const first = world.added.map((row) => row.externalId);
    world.added = [];
    world.metadata = { ...world.metadata, ...cursorBehind };
    await walkOnce({ world, entries });

    expect(world.added.map((row) => row.externalId)).toEqual(first);
  });
});

describe('where the walk starts and what it never asks', () => {
  it('starts the first window at the floor of 179 days, and never before it, whatever the stored marks say', async () => {
    const world = worldOf({
      [SPOT_FIELDS.cursor]: HISTORY_FLOOR_MS,
      [SPOT_FIELDS.rescan]: HISTORY_FLOOR_MS,
      [SPOT_FIELDS.pending]: [
        { start: HISTORY_FLOOR_MS, end: HISTORY_FLOOR_MS + DAY_MS },
        pointOf(HISTORY_FLOOR_MS + 5 * DAY_MS, 'MAIN_FUNDING'),
      ],
    });

    const { requests } = await walkOnce({ world });

    expect(requests[0].startTime).toBe(transferFloorMs(NOW));
    expect(minOf(requests.map((request) => request.startTime))).toBe(FLOOR);
  });

  it.each([
    ['no mark at all', {}],
    ['a forward cursor older than the floor', { [SPOT_FIELDS.cursor]: agoMs(400) }],
    [
      'an old re-scan mark behind a recent forward cursor',
      { [SPOT_FIELDS.cursor]: agoMs(2), [SPOT_FIELDS.rescan]: agoMs(400) },
    ],
    [
      'an owed range and a point before the floor',
      {
        [SPOT_FIELDS.cursor]: agoMs(2),
        [SPOT_FIELDS.pending]: [
          { start: agoMs(300), end: agoMs(299) },
          pointOf(agoMs(250), 'FUNDING_MAIN'),
        ],
      },
    ],
  ])('sends no request that starts before the floor, with %s', async (_label, marks) => {
    const { requests } = await walkOnce({ world: worldOf(marks) });

    expect(requests.length).toBeGreaterThan(0);
    expect(minOf(requests.map((request) => request.startTime))).toBeGreaterThanOrEqual(FLOOR);
  });

  it('asks MAIN_FUNDING and FUNDING_MAIN first, then the 18 other types, for every span', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    const { requests } = await walkOnce({ world });

    expect(requests.slice(0, TYPE_COUNT).map((request) => request.type)).toEqual([
      ...UNIVERSAL_TRANSFER_TYPES,
    ]);
    expect(new Set(requests.slice(0, TYPE_COUNT).map((request) => request.current))).toEqual(
      new Set([1]),
    );
  });

  it('never asks a range with start equal to end', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    const { requests } = await walkOnce({
      world,
      answer: (query) => (query.endTime - query.startTime > 10 ? fullPage() : undefined),
    });

    expect(requests.length).toBeGreaterThan(TYPE_COUNT);
    expect(requests.filter((request) => request.startTime === request.endTime)).toEqual([]);
  });

  it('does nothing for an account with no Spot holding or no credentials', async () => {
    const noSpot = await walkOnce({ world: worldOf(), over: { listHoldings: async () => [] } });
    const noKeys = await walkOnce({
      world: worldOf(),
      over: { readCredentials: async () => undefined },
    });

    expect(noSpot.requests).toEqual([]);
    expect(noKeys.requests).toEqual([]);
    expect(noSpot.result).toEqual({ imported: 0, complete: true });
    expect(noKeys.result).toEqual({ imported: 0, complete: true });
  });
});

describe('a span too full for one page, and a page that does not add up', () => {
  const caughtUp = { [SPOT_FIELDS.cursor]: agoMs(5) };

  it('halves a span whose first type comes back full, and reads every type again in the half', async () => {
    const world = worldOf(caughtUp);
    const wide = (query: TransferQuery) => query.endTime - query.startTime > 3 * DAY_MS;

    const { requests } = await walkOnce({
      world,
      answer: (query) => (wide(query) && query.type === 'MAIN_FUNDING' ? fullPage() : undefined),
    });

    const forward = requests.filter((request) => request.startTime >= agoMs(5));
    const [first, second] = forward;
    const half = agoMs(5) + Math.floor((NOW - agoMs(5)) / 2);
    expect(first).toMatchObject({ type: 'MAIN_FUNDING', startTime: agoMs(5), endTime: NOW });
    expect(second).toMatchObject({ type: 'MAIN_FUNDING', startTime: agoMs(5), endTime: half });
    expect(forward.slice(1, 1 + TYPE_COUNT).map((request) => request.type)).toEqual([
      ...UNIVERSAL_TRANSFER_TYPES,
    ]);
    expect(new Set(forward.slice(1, 1 + TYPE_COUNT).map((request) => request.endTime))).toEqual(
      new Set([half]),
    );
  });

  it('pages a span of one millisecond by current until the rows counted are the total, and writes every row', async () => {
    const at = NOW - 1_000;
    const world = worldOf({ [SPOT_FIELDS.cursor]: at });
    const many = Array.from({ length: 120 }, (_unused, index) =>
      entryOf({ type: 'MAIN_UMFUTURE', tranId: `many-${index}`, timestamp: at }),
    );

    const { requests, result } = await walkOnce({ world, entries: many });

    const oneMillisecond = requests.filter((request) => request.endTime - request.startTime === 1);
    expect(oneMillisecond.filter((request) => request.type === 'MAIN_UMFUTURE')).toEqual([
      expect.objectContaining({ startTime: at, current: 1 }),
      expect.objectContaining({ startTime: at, current: 2 }),
    ]);
    expect(new Set(world.added.map((row) => row.externalId)).size).toBe(120);
    expect(result.imported).toBe(120);
  });

  it('a total with no rows is a drift, not an empty span: the forward pass commits nothing of it and the cursor stays', async () => {
    const world = worldOf(caughtUp);

    const { requests } = await walkOnce({
      world,
      answer: (query) =>
        query.startTime >= agoMs(5) && query.type === 'UMFUTURE_MAIN'
          ? pageOf({ total: 4 })
          : undefined,
    });

    expect(stopCodes(warn)).toContain('transfer-page-drift');
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(5));
    expect(requests.some((request) => request.startTime < agoMs(5))).toBe(true);
  });

  it('a drifted type in the re-scan commits the other 19 and owes the span as a range', async () => {
    const world = worldOf(caughtUp);
    const record = entryOf({ type: 'UMFUTURE_MAIN', timestamp: agoMs(10), tranId: 'kept' });
    const behind = (query: TransferQuery) => query.startTime < agoMs(5);

    await walkOnce({
      world,
      entries: [record],
      answer: (query) =>
        behind(query) && query.type === 'FUNDING_MAIN' ? pageOf({ total: 3 }) : undefined,
    });

    expect(world.added.map((row) => row.externalId)).toEqual(['acc-1:xfer:UMFUTURE_MAIN:kept:BTC']);
    expect(listOf(world)).toContainEqual({ start: agoMs(30), end: agoMs(5) });
    expect(stopCodes(warn)).toContain('transfer-page-drift');
  });

  it('an off-contract row of another asset does not stall the BTC rows of its page', async () => {
    const world = worldOf(caughtUp);
    const other = entryOf({ asset: 'USDT', amount: 'junk', tranId: 'other', timestamp: agoMs(3) });

    const { result } = await walkOnce({
      world,
      entries: [other, entryOf({ tranId: 'btc', timestamp: agoMs(2) })],
    });

    expect(result.complete).toBe(true);
    expect(world.added).toHaveLength(2);
  });
});

describe('a transfer the walk cannot trust', () => {
  const caughtUp = { [SPOT_FIELDS.cursor]: agoMs(5) };
  const stuckAt = agoMs(10);
  const stuck = (over: Partial<BinanceUniversalTransfer> = {}) =>
    entryOf({ status: 'PENDING', tranId: 'stuck', timestamp: stuckAt, ...over });
  const other = entryOf({
    type: 'UMFUTURE_MAIN',
    tranId: 'fine',
    timestamp: stuckAt + 3_600_000,
  });

  it('T5/T8: in the re-scan, imports the settled transfer of another type and owes the unsettled one at its own point, in its own type', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({ world, entries: [stuck(), other] });

    expect(world.added.map((row) => row.externalId)).toEqual(['acc-1:xfer:UMFUTURE_MAIN:fine:BTC']);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'MAIN_FUNDING')]);
    expect(result.complete).toBe(false);
    expect(stopCodes(warn)).toEqual(['transfer-not-settled']);
  });

  it('T9: in the forward pass, a stop with no time to owe a point at commits nothing of the span, ends the forward pass with the cursor unmoved, and the run goes on to the re-scan', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

    const { requests } = await walkOnce({
      world,
      entries: [unreadableOf('FUNDING_MAIN', undefined), other],
    });

    expect(world.added).toEqual([]);
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(20));
    expect(requests.some((request) => request.startTime === agoMs(30))).toBe(true);
  });

  describe.each([
    ['an unsettled transfer', stuck()],
    [
      'a transfer of another type than it was read under',
      entryOf({ type: 'MAIN_UMFUTURE', tranId: 'wrong', timestamp: stuckAt }, 'MAIN_FUNDING'),
    ],
    ['a transfer with no id', entryOf({ tranId: '', timestamp: stuckAt })],
    ['a transfer with no amount of satoshis', entryOf({ amount: '0', timestamp: stuckAt })],
    ['an unreadable row with a time', unreadableOf('MAIN_FUNDING', stuckAt)],
  ])('%s in the forward window', (_name, entry) => {
    const newer = entryOf({ tranId: 'newer', timestamp: agoMs(2) });
    const idsOf = (world: World) => [...new Set(world.added.map((row) => row.externalId))].sort();

    it('is owed at its own point and the cursor goes past it: the other transfers of the span, the newer ones too, import in the same run', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      const { result } = await walkOnce({ world, entries: [entry, other, newer] });

      expect(idsOf(world)).toEqual([
        'acc-1:xfer:MAIN_FUNDING:newer:BTC',
        'acc-1:xfer:MAIN_FUNDING:newer:BTC:funding',
        'acc-1:xfer:UMFUTURE_MAIN:fine:BTC',
      ]);
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(NOW);
      expect(listOf(world)).toContainEqual(pointOf(stuckAt, 'MAIN_FUNDING'));
      expect(result.complete).toBe(false);
    });

    it('stays owed in every run after it, and a second identical run imports no row it had not', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      await walkOnce({ world, entries: [entry, other, newer] });
      await walkOnce({ world, entries: [entry, other, newer] });

      expect(listOf(world)).toContainEqual(pointOf(stuckAt, 'MAIN_FUNDING'));
      expect(idsOf(world)).toHaveLength(3);
    });
  });

  describe('a FAILED transfer in the forward window', () => {
    const failed = stuck({ status: 'FAILED', tranId: 'failed' });
    const newer = entryOf({ tranId: 'newer', timestamp: agoMs(2) });
    const idsOf = (world: World) => [...new Set(world.added.map((row) => row.externalId))].sort();

    it('is owed at its own point and the cursor goes past it: the other transfers of the span, the newer ones too, import in the same run', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      const { result } = await walkOnce({ world, entries: [failed, other, newer] });

      expect(idsOf(world)).toEqual([
        'acc-1:xfer:MAIN_FUNDING:newer:BTC',
        'acc-1:xfer:MAIN_FUNDING:newer:BTC:funding',
        'acc-1:xfer:UMFUTURE_MAIN:fine:BTC',
      ]);
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(NOW);
      expect(listOf(world)).toContainEqual(pointOf(stuckAt, 'MAIN_FUNDING'));
      expect(result.complete).toBe(false);
      expect(stopCodes(warn)).toContain('transfer-failed');
    });

    it('stays owed in every run after it, whatever the cursor, and a second identical run imports no row it had not', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      await walkOnce({ world, entries: [failed, other, newer] });
      await walkOnce({ world, entries: [failed, other, newer] });

      expect(listOf(world)).toContainEqual(pointOf(stuckAt, 'MAIN_FUNDING'));
      expect(idsOf(world)).toHaveLength(3);
    });

    it('does not take a stop with no time with it: an unreadable row with no time beside it still leaves the span uncommitted and the cursor unmoved', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      await walkOnce({
        world,
        entries: [failed, unreadableOf('FUNDING_MAIN', undefined), other, newer],
      });

      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(20));
      expect(idsOf(world)).not.toContain('acc-1:xfer:MAIN_FUNDING:newer:BTC');
    });

    it('does not take a stop of the span as a whole with it: a type that drifted beside it still leaves the span uncommitted and the cursor unmoved', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(20) });

      await walkOnce({
        world,
        entries: [failed, other, newer],
        answer: (query) =>
          query.startTime >= agoMs(20) && query.type === 'FUNDING_UMFUTURE'
            ? pageOf({ total: 4 })
            : undefined,
      });

      expect(stopCodes(warn)).toContain('transfer-page-drift');
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(agoMs(20));
      expect(idsOf(world)).not.toContain('acc-1:xfer:MAIN_FUNDING:newer:BTC');
    });
  });

  it('T10: a row of another type than the one it was read under is owed at its point, in the type read', async () => {
    const world = worldOf(caughtUp);
    const mismatched = entryOf(
      { type: 'MAIN_UMFUTURE', tranId: 'wrong', timestamp: stuckAt },
      'MAIN_FUNDING',
    );

    await walkOnce({ world, entries: [mismatched, other] });

    expect(listOf(world)).toEqual([pointOf(stuckAt, 'MAIN_FUNDING')]);
    expect(stopCodes(warn)).toEqual(['transfer-type-mismatch']);
  });

  it('owes a transfer with no id, and one with an amount that is no number of satoshis, each at its point', async () => {
    const world = worldOf(caughtUp);
    const later = stuckAt + 5 * 3_600_000;

    await walkOnce({
      world,
      entries: [
        entryOf({ tranId: '', timestamp: stuckAt }),
        entryOf({ amount: '0', tranId: 'zero', timestamp: later }),
      ],
    });

    expect(listOf(world)).toEqual([
      pointOf(stuckAt, 'MAIN_FUNDING'),
      pointOf(later, 'MAIN_FUNDING'),
    ]);
    expect(stopCodes(warn).sort()).toEqual(['transfer-amount-invalid', 'transfer-id-missing']);
  });

  it('T11: a FAILED transfer is owed at its point run after run, one call in its own type, until the floor passes it; no row, ever', async () => {
    const failedAt = FLOOR + DAY_MS;
    const failed = entryOf({ status: 'FAILED', tranId: 'failed', timestamp: failedAt });
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(5),
      [SPOT_FIELDS.pending]: [{ start: FLOOR, end: FLOOR + 3 * DAY_MS }],
    });

    await walkOnce({ world, entries: [failed] });
    expect(listOf(world)).toEqual([pointOf(failedAt, 'MAIN_FUNDING')]);

    const second = await walkOnce({ world, entries: [failed] });
    const pointReads = second.requests.filter((request) => request.endTime === failedAt + 1);
    expect(pointReads).toHaveLength(1);
    expect(pointReads[0]).toMatchObject({ type: 'MAIN_FUNDING', startTime: failedAt - 1 });
    expect(listOf(world)).toContainEqual(pointOf(failedAt, 'MAIN_FUNDING'));

    const later = NOW + 190 * DAY_MS;
    expect(transferFloorMs(later)).toBeGreaterThan(failedAt + 1);
    await walkOnce({ world, entries: [failed], now: later });

    expect(pointsIn(listOf(world))).toEqual([]);
    expect(world.added).toEqual([]);
  });

  it('in the re-scan, an unreadable row with a time is owed at its point in its type, and the settled row of another type imports', async () => {
    const world = worldOf(caughtUp);

    const { result } = await walkOnce({
      world,
      entries: [unreadableOf('MAIN_FUNDING', stuckAt), other],
    });

    expect(world.added.map((row) => row.externalId)).toEqual(['acc-1:xfer:UMFUTURE_MAIN:fine:BTC']);
    expect(listOf(world)).toEqual([pointOf(stuckAt, 'MAIN_FUNDING')]);
    expect(stopCodes(warn)).toEqual(['transfer-row-unreadable']);
    expect(result.complete).toBe(false);
  });

  it('an unreadable row with no finite timestamp owes the span, in every type', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({ world, entries: [unreadableOf('FUNDING_MAIN', undefined), other] });

    expect(world.added).toHaveLength(1);
    expect(listOf(world)).toEqual([{ start: agoMs(30), end: agoMs(5) }]);
  });

  it('never rejects for a row: the run resolves, and logs the code alone', async () => {
    const world = worldOf(caughtUp);

    await expect(
      walkOnce({ world, entries: [unreadableOf('MAIN_FUNDING', stuckAt)] }),
    ).resolves.toMatchObject({ result: { complete: false } });
    expect(warn.mock.calls).toEqual([
      [STOP_TAG, { name: 'BinanceWalkStop', code: 'transfer-row-unreadable' }],
    ]);
  });

  it('logs a stop by its code alone: no amount, id or tranId reaches a log', async () => {
    const world = worldOf(caughtUp);

    await walkOnce({
      world,
      entries: [stuck({ tranId: 'secret-tran-id', amount: '1.23456789' })],
    });

    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/secret-tran-id|1\.2345/);
    expect(warn.mock.calls.every((call) => call[0] === STOP_TAG)).toBe(true);
  });
});

describe('a point read', () => {
  it('asks its own type only, one call, for exactly the window of the point', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [pointOf(at, 'MAIN_UMFUTURE')],
    });

    const { requests } = await walkOnce({ world });

    expect(requests.filter((request) => request.startTime === at - 1)).toEqual([
      { type: 'MAIN_UMFUTURE', startTime: at - 1, endTime: at + 1, current: 1 },
    ]);
  });

  it('asks the union of the types of points that start together, as one window, once in each', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [
        pointOf(at, 'MAIN_UMFUTURE'),
        { ...pointOf(at, 'FUNDING_MAIN'), end: at + 1_000 },
      ],
    });

    const { requests } = await walkOnce({ world });

    const reads = requests.filter((request) => request.startTime === at - 1);
    expect(reads.map((request) => request.type).sort()).toEqual(['FUNDING_MAIN', 'MAIN_UMFUTURE']);
    expect(new Set(reads.map((request) => request.endTime))).toEqual(new Set([at + 1_000]));
  });

  it('takes the point off the list once its own record comes back settled, and writes the row', async () => {
    const at = agoMs(100);
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [pointOf(at, 'MAIN_UMFUTURE')],
    });
    const settled = entryOf({ type: 'MAIN_UMFUTURE', tranId: 'late', timestamp: at });

    await walkOnce({ world, entries: [settled] });

    expect(world.added.map((row) => row.externalId)).toEqual(['acc-1:xfer:MAIN_UMFUTURE:late:BTC']);
    expect(pointsIn(listOf(world))).toEqual([]);
  });
});

describe('a read that leaves the end out, as the live transfer endpoint does', () => {
  describe.each(RUN_GAPS)('runs %i ms apart', (gapMs) => {
    it('imports a transfer at the floor once: the start is read', async () => {
      const world = worldOf();

      const { afterFirst, ids } = await walkTwice({
        world,
        endLeftOut: true,
        entries: [entryOf({ tranId: 'floor', timestamp: transferFloorMs(NOW) })],
        gapMs,
      });

      expect(afterFirst).toEqual(keysOf('floor'));
      expect(ids).toEqual(keysOf('floor'));
    });

    it('imports a transfer on the boundary of two windows of 30 days once, in the window that starts there', async () => {
      const start = agoMs(70);
      const world = worldOf({ [SPOT_FIELDS.cursor]: start });

      const { afterFirst, ids } = await walkTwice({
        world,
        endLeftOut: true,
        entries: [entryOf({ tranId: 'boundary', timestamp: start + TRANSFER_WINDOW_MS })],
        gapMs,
      });

      expect(afterFirst).toEqual(keysOf('boundary'));
      expect(ids).toEqual(keysOf('boundary'));
    });

    it('imports a transfer on the boundary of the two halves of a span that came back full once', async () => {
      const start = agoMs(5);
      const half = start + Math.floor((NOW - start) / 2);
      const world = worldOf({ [SPOT_FIELDS.cursor]: start });

      const { afterFirst, ids } = await walkTwice({
        world,
        endLeftOut: true,
        entries: [entryOf({ tranId: 'half', timestamp: half })],
        gapMs,
        bindingAt: () => ({
          answer: (query) =>
            query.endTime - query.startTime > 3 * DAY_MS && query.type === 'MAIN_FUNDING'
              ? fullPage()
              : undefined,
        }),
      });

      expect(afterFirst).toEqual(keysOf('half'));
      expect(ids).toEqual(keysOf('half'));
    });

    it('imports an owed transfer once from the read of its point, and takes the point off the list', async () => {
      const at = agoMs(100);
      const world = worldOf({
        [SPOT_FIELDS.cursor]: agoMs(1),
        [SPOT_FIELDS.pending]: [pointOf(at, 'MAIN_FUNDING')],
      });

      const { afterFirst, ids } = await walkTwice({
        world,
        endLeftOut: true,
        entries: [entryOf({ tranId: 'point', timestamp: at })],
        gapMs,
      });

      expect(afterFirst).toEqual(keysOf('point'));
      expect(ids).toEqual(keysOf('point'));
      expect(pointsIn(listOf(world))).toEqual([]);
    });
  });

  it.each([HOUR_MS, DAY_MS])(
    'imports a transfer at the very end of a run in the next run, %i ms later: the end read left it out, the cursor start reads it',
    async (gapMs) => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(2) });

      const { afterFirst, ids } = await walkTwice({
        world,
        endLeftOut: true,
        entries: [entryOf({ tranId: 'edge', timestamp: NOW })],
        gapMs,
      });

      expect(afterFirst).toEqual([]);
      expect(ids).toEqual(keysOf('edge'));
    },
  );
});

describe('a Binance that refuses a startTime older than the history it keeps (code -5026)', () => {
  /**
   * Binance as it answers: a read that starts more than `days` before the clock (`now`, a time or
   * the clock itself) is refused. Its depth moves in steps of `stepMs` (1: with the clock).
   */
  const keepingDays =
    (days: number, now: number | (() => number), stepMs = 1): Answer =>
    (query) => {
      const nowMs = typeof now === 'number' ? now : now();

      if (query.startTime < Math.floor((nowMs - days * DAY_MS) / stepMs) * stepMs) {
        throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
      }

      return undefined;
    };

  /** Two runs, the second `gapMs` later, each against a Binance that keeps `days`. */
  const walkKeeping = (input: { world: World; entries?: Entry[]; days: number; gapMs: number }) =>
    walkTwice({
      world: input.world,
      entries: input.entries,
      gapMs: input.gapMs,
      bindingAt: (now) => ({ answer: keepingDays(input.days, now) }),
    });

  describe.each(RUN_GAPS)('runs %i ms apart', (gapMs) => {
    it('never asks for more than the 180 days Binance was seen to serve, on a fresh connection', async () => {
      const world = worldOf();

      const { requests, secondNow } = await walkKeeping({ world, days: 180, gapMs });

      expect(requests.length).toBeGreaterThan(0);
      expect(minOf(requests.map((request) => request.startTime))).toBe(FLOOR);
      expect(world.metadata[SPOT_FIELDS.cursor]).toBe(secondNow);
    });

    it('cuts an owed range that reaches back before the floor, and reads the rest of it', async () => {
      const world = worldOf({
        [SPOT_FIELDS.cursor]: agoMs(1),
        [SPOT_FIELDS.rescan]: agoMs(1) - 1,
        [SPOT_FIELDS.pending]: [{ start: agoMs(190), end: agoMs(170) }],
      });

      const { requests } = await walkKeeping({ world, days: 180, gapMs });

      expect(minOf(requests.map((request) => request.startTime))).toBe(FLOOR);
      expect(requests.some((request) => request.startTime === FLOOR)).toBe(true);
      expect(listOf(world)).toEqual([]);
    });

    it('imports what Binance keeps of a span that starts older than it keeps within 3 runs, and reads the ground it refuses as empty', async () => {
      const world = worldOf();
      // The crossing window is read in the second run, `gapMs` after the first.
      const entries = [
        entryOf({ tranId: 'refused', timestamp: agoMs(110) }),
        entryOf({ tranId: 'edge', timestamp: agoMs(100) + gapMs + 2 * DEPTH_RESOLUTION_MS }),
        entryOf({ tranId: 'deep', timestamp: agoMs(97) }),
        entryOf({ tranId: 'kept', timestamp: agoMs(50) }),
        entryOf({ tranId: 'newest', timestamp: agoMs(10) }),
      ];

      const { ids, secondNow } = await walkRuns({
        world,
        entries,
        gapMs,
        runs: 3,
        bindingAt: (now) => ({ answer: keepingDays(100, now) }),
      });

      expect([...ids].sort()).toEqual(['edge', 'deep', 'kept', 'newest'].flatMap(keysOf).sort());
      expect(Number(world.metadata[SPOT_FIELDS.cursor])).toBe(secondNow);
      expect(stopCodes(warn)).toEqual([]);
    });

    it('reads a refused owed range as empty and drops it from the list, as the floor would', async () => {
      const world = worldOf({
        [SPOT_FIELDS.cursor]: agoMs(1),
        [SPOT_FIELDS.rescan]: agoMs(1) - 1,
        [SPOT_FIELDS.pending]: [{ start: agoMs(150), end: agoMs(140) }],
      });

      await walkKeeping({ world, days: 100, gapMs });

      expect(listOf(world)).toEqual([]);
    });
  });

  it('asks each type twice of a span it refuses whole: the refused start, then a start at its end', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(150) });

    const { requests } = await walkOnce({ world, answer: keepingDays(100, NOW) });

    expect(requests.slice(0, 2 * TYPE_COUNT)).toEqual(
      UNIVERSAL_TRANSFER_TYPES.flatMap((type) => [
        { type, startTime: agoMs(150), endTime: agoMs(120), current: 1 },
        { type, startTime: agoMs(120), endTime: agoMs(120) + 1, current: 1 },
      ]),
    );
    expect(requests[2 * TYPE_COUNT]).toEqual(
      expect.objectContaining({ type: 'MAIN_FUNDING', startTime: agoMs(120), endTime: agoMs(90) }),
    );
  });

  describe('when the clock has moved on since the run was planned', () => {
    const SUSPENDED_MS = 3 * DAY_MS;
    const BOUNDARY = FLOOR + SUSPENDED_MS - DAY_MS;
    const CREDENTIALS = { apiKey: 'api-key', secret: 'secret' };

    /**
     * A run planned at `startMs` whose clock reads `SUSPENDED_MS` later once the credentials are
     * read (the app was suspended before its first read), against a Binance that keeps 180 days of
     * the clock.
     */
    const suspendedFrom = (startMs: number): RunBinding => {
      const clock = { now: startMs };

      return {
        answer: keepingDays(180, () => clock.now),
        over: {
          now: () => clock.now,
          readCredentials: async () => {
            clock.now = startMs + SUSPENDED_MS;

            return CREDENTIALS;
          },
        },
      };
    };
    const failedAt = FLOOR + 20 * DAY_MS;
    const entries = [
      entryOf({ tranId: 'crossing', timestamp: BOUNDARY + DAY_MS / 2 }),
      entryOf({ tranId: 'failed', status: 'FAILED', timestamp: failedAt }),
      entryOf({ tranId: 'later', timestamp: agoMs(100) }),
      entryOf({ tranId: 'newest', timestamp: agoMs(10) }),
    ];

    describe.each(RUN_GAPS)('with the runs %i ms apart', (gapMs) => {
      it('imports every transfer within the 180 days Binance keeps within 3 runs, and keeps the failed one owed', async () => {
        const world = worldOf();

        const { afterFirst, ids } = await walkRuns({
          world,
          entries,
          gapMs,
          runs: 3,
          bindingAt: suspendedFrom,
        });

        // The first run's 80 calls reach the first windows only; the next finish the rest.
        expect(afterFirst).toEqual(expect.arrayContaining(keysOf('crossing')));
        expect([...ids].sort()).toEqual(['crossing', 'later', 'newest'].flatMap(keysOf).sort());
        expect(pointsIn(listOf(world))).toEqual([pointOf(failedAt, 'MAIN_FUNDING')]);
        expect(new Set(stopCodes(warn))).toEqual(new Set(['transfer-failed']));
      });
    });

    it('moves the start of the span up by bisection, within a stated number of requests, to the oldest start Binance serves', async () => {
      const world = worldOf();

      const { requests } = await walkOnce({ world, entries, ...suspendedFrom(NOW) });

      const narrowingOf = (type: UniversalTransferType) =>
        requests.filter(
          (request) =>
            request.type === type &&
            (request.startTime < BOUNDARY || request.endTime - request.startTime === 1),
        );
      const bound = 2 + Math.ceil(Math.log2(TRANSFER_WINDOW_MS / DEPTH_RESOLUTION_MS));
      const read = requests.find(
        (request) => request.startTime >= BOUNDARY && request.endTime - request.startTime > 1,
      );

      expect(narrowingOf('MAIN_FUNDING').length).toBeLessThanOrEqual(bound);
      expect(narrowingOf('MAIN_FUNDING').length).toBeGreaterThanOrEqual(bound - 1);
      expect(read).toMatchObject({ type: 'MAIN_FUNDING' });
      expect((read?.startTime ?? 0) - BOUNDARY).toBeLessThan(DEPTH_RESOLUTION_MS + DEPTH_MARGIN_MS);
    });

    it('narrows each type by itself, the later types from the start the first one found, in a few requests', async () => {
      const world = worldOf();

      const { requests } = await walkOnce({ world, entries, ...suspendedFrom(NOW) });

      const narrowingOf = (type: UniversalTransferType) =>
        requests.filter(
          (request) =>
            request.type === type &&
            (request.startTime < BOUNDARY || request.endTime - request.startTime === 1),
        );
      expect(narrowingOf(UNIVERSAL_TRANSFER_TYPES[1]).length).toBeGreaterThanOrEqual(2);
      expect(narrowingOf(UNIVERSAL_TRANSFER_TYPES[1]).length).toBeLessThanOrEqual(8);
      expect(narrowingOf(UNIVERSAL_TRANSFER_TYPES[2]).length).toBeLessThanOrEqual(8);
    });

    it('reads a span that lies wholly below the floor of now as empty, with no request beyond the refused one of each type', async () => {
      const world = worldOf({
        [SPOT_FIELDS.cursor]: agoMs(1),
        [SPOT_FIELDS.rescan]: agoMs(1) - 1,
        [SPOT_FIELDS.pending]: [{ start: FLOOR, end: FLOOR + DAY_MS }],
      });

      const { requests } = await walkOnce({ world, ...suspendedFrom(NOW) });

      expect(
        requests.filter(
          (request) => request.startTime >= FLOOR && request.startTime <= FLOOR + DAY_MS,
        ),
      ).toHaveLength(TYPE_COUNT);
      expect(listOf(world)).toEqual([]);
    });

    it('owes the span in each type whose narrowing the budget cannot afford, never reads it as empty, and a later run imports it', async () => {
      const world = worldOf();
      const binding = suspendedFrom(NOW);
      const fetcher = serverOf(entries, binding.answer);
      // The span is entered (20 calls fit). The first type spends 5 calls, the refused read and 4
      // probes, before the next would leave the calls the later types need; each of the later
      // types spends its refused read and no more.
      const run = {
        gate: freshRun().gate,
        budget: {
          canAfford: (_lane: unknown, _cost: unknown, keep = 0) =>
            fetcher.mock.calls.length + keep < TYPE_COUNT + 5,
          record: () => undefined,
        },
      };

      const first = await walkOnce({
        world,
        run,
        over: { ...binding.over, fetchUniversalTransfers: fetcher },
      });

      expect(first.result).toEqual({ imported: 0, complete: false });
      expect(world.added).toEqual([]);
      expect(fetcher).toHaveBeenCalledTimes(5 + (TYPE_COUNT - 1));
      expect(listOf(world).map((ground) => (ground as { series?: string }).series)).toEqual(
        expect.arrayContaining([...UNIVERSAL_TRANSFER_TYPES]),
      );

      for (const _run of [1, 2, 3]) {
        await walkOnce({ world, entries, ...suspendedFrom(NOW) });
      }

      expect(world.added.map((row) => row.externalId)).toEqual(
        expect.arrayContaining(keysOf('crossing')),
      );
    });

    it('asks no more than once for the start Binance refused when the span comes back full and is halved', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(105) });
      const keeping = keepingDays(100, NOW);
      const dense: Answer = (query) =>
        query.endTime - query.startTime > 3 * DAY_MS && query.type === 'MAIN_FUNDING'
          ? fullPage()
          : undefined;
      const deep = entryOf({ tranId: 'deep', timestamp: agoMs(99) });

      const { requests } = await walkOnce({
        world,
        entries: [deep],
        answer: (query) => keeping(query) ?? dense(query),
      });

      const readsBelowDepth = requests.filter(
        (request) => request.startTime < agoMs(100) && request.endTime - request.startTime > 1,
      );

      expect(readsBelowDepth.map((request) => request.type)).toEqual([...UNIVERSAL_TRANSFER_TYPES]);
      expect(world.added.map((row) => row.externalId)).toEqual(keysOf('deep'));
      expect(pointsIn(listOf(world))).toEqual([]);
    });
  });

  describe('when the clock moves with every wait of the run gate and every request', () => {
    const SUSPENDED_MS = 3 * DAY_MS;
    const CREDENTIALS = { apiKey: 'api-key', secret: 'secret' };

    /**
     * `runs` runs on one world, `gapMs` apart, on one clock: the gate's sleeps and the latency of
     * each request (`latencyMs`) move it, Binance keeps what `keepingOf` says of it, and the first
     * run's app was suspended for `suspendedMs` after the run was planned, and for the
     * `suspendedInGate` inside a wait of its run gate. Each run's end is a snapshot.
     */
    const walkAlongClock = async (input: {
      world: World;
      entries: Entry[];
      keepingOf: (clock: { now: number }) => Answer;
      gapMs: number;
      runs: number;
      latencyMs: (query: TransferQuery) => number;
      suspendedMs?: number;
      suspendedInGate?: { atWait: number; ms: number };
    }) => {
      const { world, entries, keepingOf, gapMs, runs, latencyMs, suspendedMs = 0 } = input;
      const { clock, newRun } = movingClockOf(NOW);
      const keeping = keepingOf(clock);
      const snapshots: {
        ids: Set<string>;
        cursor: unknown;
        requests: TransferQuery[];
        pending: number;
        endMs: number;
      }[] = [];

      for (let index = 0; index < runs; index += 1) {
        const suspendedFor = index === 0 ? suspendedMs : 0;
        const inGate = index === 0 ? input.suspendedInGate : undefined;
        const { requests } = await walkOnce({
          world,
          entries,
          run: suspendableRun({
            run: newRun(),
            clock,
            suspensions: foldMap(maybe(inGate), (suspension) => [suspension]) ?? [],
          }),
          answer: (query) => {
            clock.now += latencyMs(query);

            return keeping(query);
          },
          over: {
            now: () => clock.now,
            readCredentials: async () => {
              clock.now += suspendedFor;

              return CREDENTIALS;
            },
          },
        });
        snapshots.push({
          ids: new Set(world.added.map((row) => row.externalId)),
          cursor: world.metadata[SPOT_FIELDS.cursor],
          requests,
          pending: listOf(world).length,
          endMs: clock.now,
        });
        clock.now += gapMs;
      }

      return snapshots;
    };

    const keepingDaysOf =
      (days: number, stepMs = 1) =>
      (clock: { now: number }): Answer =>
        keepingDays(days, () => clock.now, stepMs);

    // A request in seven takes 9 seconds to reach Binance, the others 100 ms.
    const spikeEverySeventh = () => {
      let count = 0;

      return () => {
        count += 1;

        return count % 7 === 0 ? 9_000 : 100;
      };
    };

    const LATENCIES = [
      ['no latency', () => () => 0],
      ['a latency of 0 to 300 ms', jitterMs],
      ['a latency of 0 to 3 seconds', () => jitterMs(3_000)],
      ['a spike of 9 seconds on every seventh request', spikeEverySeventh],
    ] as const;

    const typeAt = (index: number): UniversalTransferType => UNIVERSAL_TRANSFER_TYPES[index];
    const FIRST_TYPE = typeAt(0);
    const MIDDLE_TYPE = typeAt(9);
    const OTHER_MIDDLE_TYPE = typeAt(13);
    const LAST_TYPE = typeAt(TYPE_COUNT - 1);

    const KEEPINGS: [string, Partial<Record<UniversalTransferType, number>>][] = [
      [
        'most types keep 100 days, a middle type 90 and another 75',
        { [MIDDLE_TYPE]: 90, [OTHER_MIDDLE_TYPE]: 75 },
      ],
      ['the first type keeps 90 days and the others 100', { [FIRST_TYPE]: 90 }],
      ['the first type keeps 110 days and the others 100', { [FIRST_TYPE]: 110 }],
      ['the last type keeps 90 days and the others 100', { [LAST_TYPE]: 90 }],
    ];

    const keptDaysFrom =
      (kept: Partial<Record<UniversalTransferType, number>>) =>
      (type: UniversalTransferType): number =>
        kept[type] ?? 100;

    /** Binance keeping `keptDaysOf(type)` days of the clock, the depth moving in `stepMs` steps. */
    const keepingPerType =
      (keptDaysOf: (type: UniversalTransferType) => number, stepMs = 1) =>
      (clock: { now: number }): Answer =>
      (query) =>
        keepingDays(keptDaysOf(query.type), () => clock.now, stepMs)(query);

    const edgeAt = (days: number, stepMs: number, atMs: number): number =>
      Math.floor((atMs - days * DAY_MS) / stepMs) * stepMs;

    /**
     * Three transfers of every type: one Binance refuses (5 days below its depth), and two it
     * keeps, 10 and 40 days above it; and, with `edge`, two of the ground just above the depth.
     */
    const rowsKeeping = (
      keptDaysOf: (type: UniversalTransferType) => number,
      edge?: { stepMs: number; atMs: number },
    ): Entry[] =>
      UNIVERSAL_TRANSFER_TYPES.flatMap((type) => {
        const days = keptDaysOf(type);
        const edgeMs = edge === undefined ? 0 : edgeAt(days, edge.stepMs, edge.atMs);

        return [
          entryOf({ tranId: `old-${type}`, type, timestamp: agoMs(days + 5) }),
          entryOf({ tranId: `deep-${type}`, type, timestamp: agoMs(days - 10) }),
          entryOf({ tranId: `mid-${type}`, type, timestamp: agoMs(days - 40) }),
          ...(edge === undefined
            ? []
            : [
                entryOf({ tranId: `edge-a-${type}`, type, timestamp: edgeMs + 1_200 }),
                entryOf({ tranId: `edge-b-${type}`, type, timestamp: edgeMs + 1_800 }),
              ]),
        ];
      });

    const keysOfEntries = (entries: Entry[]): string[] =>
      entries.flatMap((entry) =>
        'row' in entry
          ? transferRowsOf('acc-1', entry.row, entry.readAs).map((row) => row.externalId)
          : [],
      );

    /**
     * `runs` runs against a Binance whose types keep `keptDaysOf(type)` days, over the transfers of
     * `rowsKeeping` (with the ground just above the depth as of `edgeAtMs`, and `extraRows`), and
     * what of them Binance still keeps when the last run ends: those must all have been imported.
     */
    const simulate = async (input: {
      keptDaysOf: (type: UniversalTransferType) => number;
      stepMs?: number;
      edgeAtMs?: number;
      extraRows?: Entry[];
      latencyMs: (query: TransferQuery) => number;
      gapMs: number;
      runs: number;
      suspendedMs?: number;
      suspendedInGate?: { atWait: number; ms: number };
    }) => {
      const { keptDaysOf, stepMs = 1 } = input;
      const world = worldOf();
      const entries = [
        ...rowsKeeping(
          keptDaysOf,
          foldMap(maybe(input.edgeAtMs), (atMs) => ({ stepMs, atMs })),
        ),
        ...(input.extraRows ?? []),
      ];
      const snapshots = await walkAlongClock({
        world,
        entries,
        keepingOf: keepingPerType(keptDaysOf, stepMs),
        gapMs: input.gapMs,
        runs: input.runs,
        latencyMs: input.latencyMs,
        suspendedMs: input.suspendedMs,
        suspendedInGate: input.suspendedInGate,
      });
      // The walk never asks for ground older than its floor of the moment, which moves with the
      // clock, so ground that only a run before the last one could have asked for is not expected.
      const keptAtEnd = (entry: Entry): boolean => {
        const endMs = snapshots.at(-1)?.endMs ?? 0;

        return (
          (timeOfEntry(entry) ?? 0) >=
          Math.max(edgeAt(keptDaysOf(entry.readAs), stepMs, endMs), transferFloorMs(endMs))
        );
      };
      const expected = keysOfEntries(entries.filter(keptAtEnd));
      const missingByRun = snapshots.map(
        (snapshot) => expected.filter((id) => !snapshot.ids.has(id)).length,
      );

      return { world, entries, snapshots, expected, missingByRun };
    };

    /** Which of the transfers `tranIds` name are among the imported `ids`, in the order given. */
    const importedOf = (ids: Iterable<string> | undefined, tranIds: string[]): string[] =>
      tranIds.filter((tranId) => [...(ids ?? [])].some((id) => id.includes(`:${tranId}:`)));

    // The runs a Binance whose types keep different parts of the history needs, the most of the
    // cases below: every transfer it keeps is imported within IMPORTED_RUNS, and no ground is owed
    // after SETTLED_RUNS. Each type of the window that crosses the depth narrows by itself, and the
    // lane spends 80 calls a run on the new ground, the re-scan and the owed ground together.
    const IMPORTED_RUNS = 14;
    const SETTLED_RUNS = 15;
    // The same for a run planned 3 days before it read, against a Binance that keeps 180 days.
    const PLANNED_EARLY_RUNS = 3;
    const PLANNED_EARLY_SETTLED_RUNS = 4;

    describe.each(KEEPINGS)('against a Binance where %s', (_label, kept) => {
      describe.each([
        ['with the clock', 1],
        ['in steps of a day', DAY_MS],
      ])('and whose depth moves %s', (_how, stepMs) => {
        describe.each(RUN_GAPS)('with runs %i ms apart', (gapMs) => {
          it.each(LATENCIES)(
            `imports every transfer each type keeps within ${IMPORTED_RUNS} runs, owes nothing after ${SETTLED_RUNS}, and lets the cursor pass the crossing window in 2, with %s`,
            async (_name, latencyOf) => {
              const { world, snapshots, missingByRun, expected } = await simulate({
                keptDaysOf: keptDaysFrom(kept),
                stepMs,
                edgeAtMs: stepMs > 1 ? NOW : undefined,
                latencyMs: latencyOf(),
                gapMs,
                runs: SETTLED_RUNS,
              });

              expect(expected.length).toBeGreaterThanOrEqual(UNIVERSAL_TRANSFER_TYPES.length);
              expect(missingByRun[IMPORTED_RUNS - 1]).toBe(0);
              expect(listOf(world)).toEqual([]);
              expect(Number(snapshots[1]?.cursor)).toBeGreaterThanOrEqual(agoMs(89));
              expect(
                [...(snapshots.at(-1)?.ids ?? [])].filter((id) => id.includes(':old-')),
              ).toEqual([]);
              expect(stopCodes(warn)).toEqual([]);
            },
          );
        });
      });
    });

    describe.each(LATENCIES)('with %s', (_name, latencyOf) => {
      it.each(RUN_GAPS)(
        `imports every transfer within the 180 days Binance keeps within ${PLANNED_EARLY_RUNS} runs, owing nothing after ${PLANNED_EARLY_SETTLED_RUNS}, when the run was planned 3 days before it read (runs %i ms apart)`,
        async (gapMs) => {
          const crossing = UNIVERSAL_TRANSFER_TYPES.map((type) =>
            entryOf({
              tranId: `crossing-${type}`,
              type,
              timestamp: FLOOR + SUSPENDED_MS - DAY_MS / 2,
            }),
          );

          const { world, missingByRun, expected } = await simulate({
            keptDaysOf: () => 180,
            extraRows: crossing,
            latencyMs: latencyOf(),
            gapMs,
            runs: PLANNED_EARLY_SETTLED_RUNS,
            suspendedMs: SUSPENDED_MS,
          });

          expect(expected.length).toBeGreaterThanOrEqual(UNIVERSAL_TRANSFER_TYPES.length);
          expect(missingByRun[PLANNED_EARLY_RUNS - 1]).toBe(0);
          expect(listOf(world)).toEqual([]);
          expect(stopCodes(warn)).toEqual([]);
        },
      );
    });

    describe.each([
      ['with the clock', 1],
      ['in steps of a day', DAY_MS],
    ])('against a Binance that keeps 100 days and whose depth moves %s', (_name, stepMs) => {
      describe.each(RUN_GAPS)('runs %i ms apart', (gapMs) => {
        it.each([
          ['10 hours', 10 * HOUR_MS],
          ['30 hours', 30 * HOUR_MS],
        ])(
          `imports every transfer it keeps within ${IMPORTED_RUNS} runs, those just above the depth too, and owes nothing after ${SETTLED_RUNS}, when the app is suspended for %s in a gate wait after a narrowing`,
          async (_label, suspendedMs) => {
            const { world, missingByRun, expected } = await simulate({
              keptDaysOf: () => 100,
              stepMs,
              edgeAtMs: NOW + suspendedMs,
              latencyMs: jitterMs(),
              gapMs,
              runs: SETTLED_RUNS,
              suspendedInGate: { atWait: 40, ms: suspendedMs },
            });

            expect(expected.length).toBeGreaterThanOrEqual(UNIVERSAL_TRANSFER_TYPES.length);
            expect(missingByRun[IMPORTED_RUNS - 1]).toBe(0);
            expect(listOf(world)).toEqual([]);
            expect(stopCodes(warn)).toEqual([]);
          },
        );
      });
    });

    describe.each(RUN_GAPS)(
      'runs %i ms apart, against a Binance that keeps 100 days and answers a read 10 seconds late',
      (gapMs) => {
        it('owes the crossing window in every type it cannot read, each run spending the most requests a type can, and never rejects', async () => {
          const world = worldOf();
          const entries = [
            entryOf({ tranId: 'oldest', timestamp: agoMs(95) }),
            entryOf({ tranId: 'later', type: 'FUNDING_MAIN', timestamp: agoMs(60) }),
          ];

          const snapshots = await walkAlongClock({
            world,
            entries,
            keepingOf: keepingDaysOf(100),
            gapMs,
            runs: 4,
            latencyMs: (query) => (query.endTime - query.startTime === 1 ? 50 : 10_000),
          });

          const mostForOneType = MAX_DEPTH_REFUSALS + 2 * 23;
          const requestsOfType = (type: string) =>
            snapshots.map(
              ({ requests }) => requests.filter((request) => request.type === type).length,
            );
          expect(importedOf(snapshots.at(-1)?.ids, ['oldest'])).toEqual([]);
          expect(importedOf(snapshots.at(-1)?.ids, ['later'])).toEqual(['later']);
          expect(Number(snapshots[1]?.cursor)).toBeGreaterThanOrEqual(agoMs(89));
          expect(snapshots[3]?.pending).toBeGreaterThan(0);
          expect(listOf(world)).toContainEqual(
            expect.objectContaining({ start: agoMs(119), series: FIRST_TYPE }),
          );
          expect(Math.max(...requestsOfType(FIRST_TYPE))).toBeLessThanOrEqual(mostForOneType + 1);
          expect(stopCodes(warn)).toEqual([]);
        });
      },
    );
  });

  it('loses no row and reads none twice when Binance refuses the start on a type after earlier types returned rows', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(60) });
    const clock = { now: NOW };
    const keeping = keepingDays(61, () => clock.now);
    let served = 0;
    // Binance forgets 5 more days once the first type is answered.
    const answer: Answer = (query) => {
      const verdict = keeping(query);

      served += 1;
      clock.now = served === 1 ? NOW + 5 * DAY_MS : clock.now;

      return verdict;
    };
    const entries = [
      entryOf({ tranId: 'first', timestamp: agoMs(58) }),
      entryOf({ tranId: 'second', type: 'FUNDING_MAIN', timestamp: agoMs(50) }),
      entryOf({ tranId: 'third', type: 'MAIN_UMFUTURE', timestamp: agoMs(40) }),
    ];

    await walkOnce({ world, entries, answer, over: { now: () => clock.now } });

    expect(world.added.map((row) => row.externalId).sort()).toEqual(
      [
        ...keysOf('first'),
        'acc-1:xfer:FUNDING_MAIN:second:BTC',
        'acc-1:xfer:FUNDING_MAIN:second:BTC:funding',
        'acc-1:xfer:MAIN_UMFUTURE:third:BTC',
      ].sort(),
    );
  });
});

describe('the budget of a run', () => {
  it('spends the whole cap of 80 calls on a caught-up run: the forward window, an owed range, the re-scan and the points', async () => {
    const owedRange = { start: agoMs(100), end: agoMs(99) };
    const points = Array.from({ length: 30 }, (_unused, index) =>
      pointOf(agoMs(170) + index * 5 * DAY_MS, UNIVERSAL_TRANSFER_TYPES[index % TYPE_COUNT]),
    );
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(1),
      [SPOT_FIELDS.pending]: [owedRange, ...points],
    });

    const { requests } = await walkOnce({ world });

    expect(CAP).toBe(80);
    expect(requests).toHaveLength(CAP);
    expect(requests.filter((request) => request.startTime === owedRange.start)).toHaveLength(
      TYPE_COUNT,
    );
    expect(requests.filter((request) => request.endTime - request.startTime === 2)).toHaveLength(
      20,
    );
  });

  it('enters no span whose 20 calls do not fit beside the calls it keeps, and no request is made for part of it', async () => {
    const run = freshRun();
    spend(run, CAP - TYPE_COUNT + 1);

    const { requests, result } = await walkOnce({ world: worldOf(), run });

    expect(requests).toEqual([]);
    expect(result).toEqual({ imported: 0, complete: false });
  });

  it('enters a span whose 20 calls fit exactly', async () => {
    const run = freshRun();
    spend(run, CAP - TYPE_COUNT);

    const { requests } = await walkOnce({ world: worldOf(), run });

    expect(requests).toHaveLength(TYPE_COUNT);
  });

  it('reads a first walk in windows of 30 days, four a run, and moves the cursor to the end of the last one read', async () => {
    const world = worldOf();

    const { requests, result } = await walkOnce({ world });

    expect(requests).toHaveLength(CAP);
    expect(result.complete).toBe(false);
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(FLOOR + 4 * TRANSFER_WINDOW_MS);
    expect(requests[0].endTime - requests[0].startTime).toBe(TRANSFER_WINDOW_MS);
  });

  it('on a 429: sets the cooldown, ends every later read, and the next run asks nothing while it lasts', async () => {
    const accountId = nextAccountId();
    const world = worldOf();
    let seen = 0;

    const first = await walkOnce({
      world,
      accountId,
      over: {
        fetchUniversalTransfers: jest.fn(async () => {
          seen += 1;

          if (seen === 3) {
            throw new BinanceRateLimitError(429, 60_000);
          }

          return pageOf();
        }),
      },
    });

    expect(seen).toBe(3);
    expect(first.result.complete).toBe(false);
    expect(isBinanceCoolingDown(accountId, NOW + 1)).toBe(true);

    const second = await walkOnce({ world, accountId });

    expect(second.requests).toEqual([]);
    expect(second.result).toEqual({ imported: 0, complete: false });
  });

  it('rejects for a failure that is not a rate limit, after the earlier spans committed', async () => {
    const world = worldOf();
    let seen = 0;

    await expect(
      walkOnce({
        world,
        over: {
          fetchUniversalTransfers: jest.fn(async () => {
            seen += 1;

            if (seen > TYPE_COUNT) {
              throw new Error('boom');
            }

            return pageOf();
          }),
        },
      }),
    ).rejects.toThrow('boom');
    expect(world.metadata[SPOT_FIELDS.cursor]).toBe(FLOOR + TRANSFER_WINDOW_MS);
  });

  it('charges each call to the transfer lane at its own weight', () => {
    expect(COSTS.transfer).toEqual({ ip: 1 });
  });
});

describe('the order of the writes', () => {
  it('writes the rows, then the list, then the re-scan mark, for a span of the re-scan', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });
    const first = agoMs(25);

    await walkOnce({
      world,
      entries: [
        entryOf({ status: 'PENDING', tranId: 'stuck', timestamp: first }),
        entryOf({ type: 'UMFUTURE_MAIN', tranId: 'fine', timestamp: first + 3_600_000 }),
      ],
      answer: (query) =>
        query.endTime - query.startTime > 13 * DAY_MS && query.type === 'MAIN_FUNDING'
          ? fullPage()
          : undefined,
    });

    const lastForward = world.events.lastIndexOf(`cursor:${SPOT_FIELDS.cursor}`);
    expect(world.events.slice(lastForward + 1, lastForward + 4)).toEqual([
      'rows',
      'list',
      `cursor:${SPOT_FIELDS.rescan}`,
    ]);
  });

  it('writes the list with the overlap day before the cursor moves past it', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5) });

    await walkOnce({ world });

    expect(world.events.indexOf('list')).toBeLessThan(
      world.events.indexOf(`cursor:${SPOT_FIELDS.cursor}`),
    );
  });
});

describe('the range cursor and the span hints of the round-robin', () => {
  const dayAt = (index: number) => ({
    start: agoMs(150) + index * 10 * DAY_MS,
    end: agoMs(150) + index * 10 * DAY_MS + DAY_MS,
  });
  const days = [dayAt(0), dayAt(1), dayAt(2)];
  const RANGE_FIELD = 'binanceTransferRangeCursor';
  const HINTS_FIELD = 'binanceTransferSpanHints';
  const base = { [SPOT_FIELDS.cursor]: agoMs(2), [SPOT_FIELDS.pending]: days };
  const dayStartsOf = (requests: TransferQuery[]): number[] => [
    ...new Set(
      requests
        .map((query) => query.startTime)
        .filter((start) => days.some((day) => day.start === start)),
    ),
  ];
  const writesTo = (deps: BinanceTransferHistoryDeps, field: string): number[] =>
    (deps.writeWalkCursor as jest.Mock).mock.calls
      .filter((call) => call[1] === field)
      .map((call) => call[2] as number);
  const codesLogged = () => warn.mock.calls.map((call) => (call[1] as { code?: string }).code);

  it('reads the owed days that start after the stored range cursor first, then wraps around', async () => {
    const world = worldOf({ ...base, [RANGE_FIELD]: days[0].end });

    const { requests } = await walkOnce({ world });

    // The cap leaves room for two of the three days beside the forward window and the re-scan.
    expect(dayStartsOf(requests)).toEqual([days[1].start, days[2].start]);
  });

  it('stores the end of the window of each day it read, once its read has started', async () => {
    const world = worldOf(base);

    const { deps } = await walkOnce({ world });

    expect(writesTo(deps, RANGE_FIELD)).toEqual([days[0].end, days[1].end]);
  });

  it('starts at the oldest day, and stores that start, when the stored cursor is no number', async () => {
    const world = worldOf({ ...base, [RANGE_FIELD]: 'soon' });

    const { requests, deps } = await walkOnce({ world });

    expect(dayStartsOf(requests)[0]).toBe(days[0].start);
    expect(codesLogged()).toContain('range-cursor-malformed');
    expect(writesTo(deps, RANGE_FIELD)[0]).toBe(Number.MIN_SAFE_INTEGER);
  });

  describe('with one owed range of five windows whose first window is owed whole by every read', () => {
    const HOUR_MS = 3_600_000;
    const floor = transferFloorMs(NOW);
    const failedAt = agoMs(10);
    const confirmedAt = floor + 100 * DAY_MS;
    const owedWindows = Math.ceil((agoMs(40) - floor) / TRANSFER_WINDOW_MS);
    // A record with no time in the first 30 days of the range, whichever of them a read asks.
    const unreadableInFirstWindow: Answer = (query) =>
      query.type === 'MAIN_UMFUTURE' &&
      query.startTime <= floor + 5 * DAY_MS &&
      floor + 5 * DAY_MS <= query.endTime
        ? pageOf({ unreadable: [{ time: undefined }], gathered: 1, total: 1 })
        : undefined;
    const entries = [
      entryOf({ tranId: 'failed', status: 'FAILED', timestamp: failedAt }),
      entryOf({ tranId: 'good', timestamp: confirmedAt }),
    ];

    it('imports a transfer in a later window of the range within ceil(windows / reads a run) runs, though the FAILED transfer owed beside it leaves a read of one window a run', async () => {
      const accountId = nextAccountId();
      const world = worldOf({
        [SPOT_FIELDS.cursor]: NOW - HOUR_MS,
        [SPOT_FIELDS.pending]: [
          { start: floor, end: agoMs(40) },
          { start: failedAt - 1, end: failedAt + 1, kind: 'point', series: 'MAIN_FUNDING' },
        ],
      });
      const importedAt: number[] = [];

      for (let run = 0; run < 2 * owedWindows; run += 1) {
        const now = NOW + run * HOUR_MS;

        await walkOnce({
          world,
          entries,
          answer: unreadableInFirstWindow,
          accountId,
          now,
          run: createBinanceHistoryRun({ now: () => now, sleep: async () => undefined }),
        });

        if (world.added.some((row) => row.externalId.includes(':good:'))) {
          importedAt.push(run);
        }
      }

      expect(importedAt[0]).toBeLessThan(owedWindows);
    });
  });

  describe('with a point whose window comes back full at its first millisecond', () => {
    const time = agoMs(60);
    const point = pointOf(time, 'MAIN_FUNDING');
    const entries = [entryOf({ tranId: 't-point', timestamp: time })];
    const dense: Answer = (query) =>
      query.type === 'MAIN_FUNDING' && query.startTime === point.start && query.endTime > time
        ? fullPage()
        : undefined;
    const pointRequestsOf = (requests: TransferQuery[]): TransferQuery[] =>
      requests.filter((query) => query.type === 'MAIN_FUNDING' && query.endTime <= time + 1);

    it('keeps the resume of the window when the run ends after its first span committed, and the next run goes on from there', async () => {
      const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(2), [SPOT_FIELDS.pending]: [point] });
      const fetcher = serverOf(entries, dense);
      // The point is the last read of a run, and this run affords the read of its whole window
      // (which comes back full) and of its first half, and no read after them.
      const run = {
        gate: freshRun().gate,
        budget: {
          canAfford: () =>
            pointRequestsOf(fetcher.mock.calls.map(([, , query]) => query)).length < 2,
          record: () => undefined,
        },
      };

      await walkOnce({ world, run, over: { fetchUniversalTransfers: fetcher } });

      expect((world.metadata[HINTS_FIELD] as { point: unknown[] }).point).toEqual([
        {
          start: point.start,
          end: point.end,
          resume: { from: time, returned: [point], stuck: [], series: ['MAIN_FUNDING'] },
        },
      ]);
      expect(pointsIn(listOf(world))).toEqual([point]);

      const { requests } = await walkOnce({ world, entries, answer: dense });

      expect(pointRequestsOf(requests).map((query) => query.startTime)).toEqual([time]);
      expect(pointsIn(listOf(world))).toEqual([]);
      expect((world.metadata[HINTS_FIELD] as { point: unknown[] }).point).toEqual([]);
    });
  });

  describe('with a day that comes back full above 6 hours', () => {
    const day = days[0];
    const dense: Answer = (query) =>
      query.startTime === day.start && query.endTime - query.startTime > DAY_MS / 4
        ? fullPage()
        : undefined;

    it('stores the span the day was left at when its halving chain is cut short, and begins with it in the next run', async () => {
      const world = worldOf({ ...base, [SPOT_FIELDS.pending]: [day] });
      const fetcher = serverOf([], dense);
      // The forward window and the re-scan keep their calls: a read of the day, whose first type
      // comes back full, leaves no call for the read of its half.
      const run = {
        gate: freshRun().gate,
        budget: {
          canAfford: (_lane: unknown, _cost: unknown, keep = 0) =>
            fetcher.mock.calls.length + keep < 60,
          record: () => undefined,
        },
      };

      await walkOnce({ world, run, over: { fetchUniversalTransfers: fetcher } });

      expect((world.metadata[HINTS_FIELD] as { pending: unknown[] }).pending).toEqual([
        { start: day.start, end: day.start + DAY_MS / 2 },
      ]);

      const { requests } = await walkOnce({ world, answer: dense });

      expect(requests.find((query) => query.startTime === day.start)?.endTime).toBe(
        day.start + DAY_MS / 2,
      );
    });

    it('stores a malformed hint over with none, logging one fixed code, and reads the whole window', async () => {
      const world = worldOf({ ...base, [SPOT_FIELDS.pending]: [day], [HINTS_FIELD]: 'soon' });

      const { requests } = await walkOnce({ world });

      expect(codesLogged()).toContain('span-hints-malformed');
      expect(world.metadata[HINTS_FIELD]).toEqual({
        forward: [],
        pending: [],
        rescan: [],
        point: [],
      });
      expect(requests.find((query) => query.startTime === day.start)?.endTime).toBe(day.end);
    });
  });
});

describe('the run on a malformed mark', () => {
  const codesLogged = () => warn.mock.calls.map((call) => (call[1] as { code?: string }).code);

  it('owes the ground before the cursor once, stores it at once, and logs one fixed code, for a point of a type the walk does not read', async () => {
    const world = worldOf({
      [SPOT_FIELDS.cursor]: agoMs(5),
      [SPOT_FIELDS.pending]: [{ start: 1, end: 2, kind: 'point', series: 'MAIN_MARS' }],
    });

    await walkOnce({ world });

    expect(codesLogged()).toContain('pending-malformed');
    expect(listOf(world)).not.toContainEqual(expect.objectContaining({ series: 'MAIN_MARS' }));
  });

  it('repairs a point cursor that is no number, logging one fixed code', async () => {
    const world = worldOf({ [SPOT_FIELDS.cursor]: agoMs(5), [SPOT_FIELDS.point]: 'x' });

    await walkOnce({ world });

    expect(codesLogged()).toContain('point-cursor-malformed');
  });
});
