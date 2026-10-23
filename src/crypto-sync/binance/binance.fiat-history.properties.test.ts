import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import {
  type CurrentRun,
  type Disturbances,
  disturbancesOf,
  readFailureOf,
  walkRuns,
} from '@kiko/test-support/walk-disturbances';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import type { WalkResult } from '@kiko/crypto-sync/exchange/walk';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

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
  type FiatTransactionType,
} from './binance.history-client';
import { NOW } from './binance.pay-test-fixtures';
import { HISTORY_FLOOR_MS } from './binance.transactions';
import { BinanceHistoryTooOldError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { fiatOrderOf, fiatPageOf, fiatPaymentOf, fiatServerOf } from './binance.fiat-test-fixtures';

/**
 * The fiat walks driven over generated worlds through `syncBinanceFiatOrderHistory` (a lane of
 * three calls, so a run reads forward or behind) and `syncBinanceFiatPaymentHistory` (a lane that
 * reads forward and behind in one run) themselves, in several runs. The clock of the runs stands
 * still, moves on by a millisecond, an hour or a day a run, or is set back to before the walk's
 * cursor. A world holds records Binance writes late (older than the walk's cursor and the overlap
 * day), a new record on some runs, and, in some worlds, owed ground anywhere between the history
 * floor and the cursor, inside the 2-year re-scan window too, that no read clears (a page that
 * drifts, a page that throws) or that Binance refuses as older than it serves. What must be
 * imported is decided by the records the generator made, never read back from the walk.
 *
 * The second suite drives the same walks over every kind of status (a settled record, a word the
 * walk does not know, a record that waits on Binance and settles or is refused later, a coin Kiko
 * does not track), with disturbed first runs: part of the lane spent, a window that throws, a 429.
 */

const HOUR_MS = 3_600_000;

/** Runs enough for the longest bound (three failing days in the window: 28) and a record after. */
const RUNS = 60;
const SEEDS = Array.from({ length: 12 }, (_unused, position) => 5 + position * 7);
const ACCOUNT_ID = 'acc-fiat-orders-properties';
const FIRST_RUN_AT = NOW;

/** The cursor the walk starts with: an hour behind the first run. */
const START_CURSOR = FIRST_RUN_AT - HOUR_MS;

/** The run the clock is set back at, in the worlds that set it back. */
const SET_BACK_RUN = 4;

type RunClock = {
  label: string;
  /** The clock of a run. */
  at: (run: number) => number;
  /** A new record is written this far behind the clock of the run that first serves it, at most. */
  reachMs: number;
};

const steadyClock = (gapMs: number, reachMs: number): RunClock => ({
  label: `${gapMs} ms apart`,
  at: (run) => FIRST_RUN_AT + run * gapMs,
  reachMs,
});

/** Runs a gap apart whose clock is set back by `backMs` at `SET_BACK_RUN`, to before the cursor. */
const setBackClock = (gapMs: number, backMs: number): RunClock => ({
  label: `${gapMs} ms apart, set back ${backMs} ms`,
  at: (run) => FIRST_RUN_AT + run * gapMs - (run >= SET_BACK_RUN ? backMs : 0),
  reachMs: gapMs,
});

/** The clock moves between two runs by nothing, a millisecond, an hour or a day, or is set back. */
const CLOCKS: RunClock[] = [
  steadyClock(0, HOUR_MS),
  steadyClock(1, 1),
  steadyClock(HOUR_MS, HOUR_MS),
  steadyClock(DAY_MS, DAY_MS),
  setBackClock(HOUR_MS, 5 * HOUR_MS),
  setBackClock(DAY_MS, 5 * DAY_MS),
];

/** The runs between two reads of the re-scan: forward, owed, forward, re-scan. */
const RESCAN_EVERY_RUNS = 4;

/**
 * A run reads forward or behind, and the run after a behind run reads forward. While owed ground is
 * left the behind runs alternate the owed windows and the re-scan, so the runs go forward, owed,
 * forward, re-scan: the re-scan, which one record is waiting for, is read on every fourth run, one
 * read (two of the lane's three calls) a turn.
 *
 * With no owed day in the 2-year window a pass is one read, and a record served just after it waits
 * for the next pass: the fourth run counting the one it is served in. Each owed day in the window
 * that fails is found by a failing read, which marks it, and the pass then reads around it, in
 * a piece before it and a piece after it: the first pass of a window with `z` such days takes
 * `2z + 1` reads (a record in its last piece waits for all of them), and a pass after it `z + 1`.
 * So a record served from run `v` is imported by the `4 * (2z + 1)`th run it is within the reach of
 * the clock from `v` on (a run whose clock is before the record cannot read it).
 */
const importRunsOf = (zonesInWindow: number): number => RESCAN_EVERY_RUNS * (2 * zonesInWindow + 1);

/** Late records are written between 2 days and this many days behind the run that serves them. */
const LATE_BACK_DAYS = 600;

/** Binance serves history this far back; the tooOld worlds refuse a read that starts earlier. */
const SERVED_BACK_MS = 1_000 * DAY_MS;

type Stuck = 'none' | 'drift' | 'throw' | 'tooOld';

type Place = 'anywhere' | 'in the window';

type World = { stuck: Stuck; place: Place };

/** Owed ground anywhere behind the cursor, and, for the two failing kinds, in the last 500 days. */
const WORLDS: World[] = [
  { stuck: 'none', place: 'anywhere' },
  { stuck: 'drift', place: 'anywhere' },
  { stuck: 'drift', place: 'in the window' },
  { stuck: 'throw', place: 'anywhere' },
  { stuck: 'throw', place: 'in the window' },
  { stuck: 'tooOld', place: 'anywhere' },
];

/** The last owed days of the in-window worlds sit this far behind the walk's cursor, at most. */
const IN_WINDOW_MS = 500 * DAY_MS;

type Served = { record: AnyRecord; type: FiatTransactionType; servedFromRun: number };

type Span = { start: number; end: number };

type Offer = { run: number; externalId: string };

const holdingWith = (id: string, metadata: Record<string, unknown>): HoldingRow =>
  ({ id, metadata }) as unknown as HoldingRow;

type AnyRecord = BinanceFiatOrder | BinanceFiatPayment;

type WalkDeps = Partial<BinanceFiatOrderHistoryDeps & BinanceFiatPaymentHistoryDeps>;

type RecordParts = {
  orderNo: string;
  createTime: number;
  /** A deposit or a card buy is `'0'`, a withdrawal or a card sale `'1'`. */
  type: FiatTransactionType;
  status?: string;
};

/** What the walk of one kind reads, and how a record of it is made. */
type WorldKind = {
  name: string;
  walkId: 'fiatOrders' | 'fiatPayments';
  readKey: 'fetchFiatOrders' | 'fetchFiatPayments';
  pageRows: number;
  holdings: HoldingRow[];
  sync: (
    request: Parameters<typeof syncBinanceFiatOrderHistory>[0],
    deps: WalkDeps,
  ) => Promise<WalkResult>;
  recordOf: (parts: RecordParts) => AnyRecord;
  /** The one status word that makes a row. */
  settledWord: string;
  /** A record of a status, for a whole amount `n`, on a coin Kiko tracks or not. */
  statusRecordOf: (input: StatusRecordInput) => AnyRecord;
  /** The row a settled record of `n` makes, decided here and not read back from the walk. */
  rowOf: (input: { accountId: string; orderNo: string; n: number; type: FiatTransactionType }) => {
    key: string;
    units: number;
    marker: string;
  };
};

type StatusRecordInput = {
  orderNo: string;
  createTime: number;
  type: FiatTransactionType;
  n: number;
  status: string;
  untracked: boolean;
};

/** A kind with the bound its records are imported within in the generated worlds. */
type BoundedKind = WorldKind & {
  /** The runs a record served is imported within, `zones` being the failing days in the window. */
  importRunsOf: (zones: number) => number;
};

const ORDERS_KIND: BoundedKind = {
  name: 'fiat orders',
  walkId: 'fiatOrders',
  readKey: 'fetchFiatOrders',
  pageRows: 500,
  holdings: [holdingWith('h-eur-spot', { binanceAsset: 'EUR' })],
  sync: syncBinanceFiatOrderHistory,
  recordOf: ({ type: _type, ...parts }) => fiatOrderOf(parts),
  importRunsOf,
  settledWord: 'Successful',
  statusRecordOf: ({ orderNo, createTime, type, n, status, untracked }) =>
    fiatOrderOf({
      orderNo,
      createTime,
      status,
      fiatCurrency: untracked ? 'XYZ' : 'EUR',
      indicatedAmount: `${n}.00`,
      amount: `${n}.00`,
      totalFee: type === '1' ? '1.25' : '0.00',
    }),
  rowOf: ({ accountId, orderNo, n, type }) => ({
    key: `${accountId}:fiat:${orderNo}:EUR`,
    units: type === '1' ? -(n * 100 + 125) : n * 100,
    marker: `bank:EUR:${n}.00`,
  }),
};

/** A card sale pays 0.001 BTC for 2600 UAH; the fixture is the card buy of that much. */
const paymentOf = ({ type, ...parts }: RecordParts): BinanceFiatPayment =>
  fiatPaymentOf(type === '0' ? parts : { ...parts, sourceAmount: '0.001', obtainAmount: '2600' });

/** A whole number of coin units as the text of a coin amount at the scale of eight. */
const coinTextOf = (units: number): string => `0.${String(units).padStart(8, '0')}`;

const PAYMENTS_KIND: WorldKind = {
  name: 'fiat payments',
  walkId: 'fiatPayments',
  readKey: 'fetchFiatPayments',
  pageRows: 100,
  holdings: [],
  sync: syncBinanceFiatPaymentHistory,
  recordOf: paymentOf,
  settledWord: 'Completed',
  statusRecordOf: ({ orderNo, createTime, type, n, status, untracked }) =>
    fiatPaymentOf({
      orderNo,
      createTime,
      status,
      cryptoCurrency: untracked ? 'XYZ' : 'BTC',
      sourceAmount: type === '0' ? `${n}.00` : coinTextOf(n),
      obtainAmount: type === '0' ? coinTextOf(n) : `${n}.00`,
    }),
  rowOf: ({ accountId, orderNo, n, type }) => ({
    key: `${accountId}:fiatpay:${orderNo}:BTC`,
    units: type === '0' ? n : -n,
    marker: `card:UAH:${n}.00`,
  }),
};

const orderNoOf = (externalId: string): string | undefined => externalId.split(':')[2];

const servedWorldOf = (random: Random, clock: RunClock, kind: WorldKind): Served[] => {
  const served: Served[] = [];
  const add = (orderNo: string, createTime: number, servedFromRun: number): void => {
    const type = served.length % 2 === 0 ? '0' : '1';

    served.push({ servedFromRun, type, record: kind.recordOf({ orderNo, createTime, type }) });
  };

  for (let run = 0; run < RUNS; run += 1) {
    const reachMs = run === 0 ? Math.min(clock.reachMs, HOUR_MS) : clock.reachMs;

    for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
      add(`new-${served.length}`, clock.at(run) - Math.floor(random() * reachMs), run);
    }
  }

  // The first late record is served from the first run, so the first pass over the window, which
  // takes the most reads when a day in it fails, is one a record waits for.
  const lateCount = 2 + Math.floor(random() * 5);

  for (let index = 0; index < lateCount; index += 1) {
    const servedFromRun = index === 0 ? 0 : Math.floor(random() * RUNS);
    const backDays = 2 + Math.floor(random() * LATE_BACK_DAYS);

    add(`late-${served.length}`, clock.at(servedFromRun) - backDays * DAY_MS, servedFromRun);
  }

  return served;
};

/** One to three owed days, each placed by the world: anywhere from the floor to the cursor. */
const owedRangesOf = (random: () => number, world: World): Span[] => {
  const earliest = world.place === 'in the window' ? START_CURSOR - IN_WINDOW_MS : HISTORY_FLOOR_MS;

  return world.stuck === 'none'
    ? []
    : Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const start = earliest + Math.floor(random() * (START_CURSOR - DAY_MS - earliest));

        return { start, end: start + DAY_MS };
      });
};

/** The owed days whose ground the re-scan reads, as far back as any run of the clock reads. */
const zonesInWindowOf = (owed: Span[], clock: RunClock): number => {
  const earliestRead =
    Math.min(...Array.from({ length: RUNS }, (_unused, run) => clock.at(run))) - FIAT_WINDOW_MS;

  return owed.filter((range) => range.end >= earliestRead).length;
};

const KINDS: BoundedKind[] = [ORDERS_KIND];

const STATUS_KINDS: WorldKind[] = [ORDERS_KIND, PAYMENTS_KIND];

const KIND_CLOCKS = KINDS.flatMap((kind) =>
  CLOCKS.map((clock) => ({ kind, clock, kindName: kind.name, label: clock.label })),
);

/** The deps of a walk over a connected account whose reads are `fetchRecords`, at `runNow`. */
const connectedDepsOf = (
  kind: WorldKind,
  runNow: number,
  fetchRecords: (
    apiKey: string,
    secret: string,
    type: FiatTransactionType,
    span: Span,
    page: number,
  ) => Promise<unknown>,
): WalkDeps => ({
  now: () => runNow,
  fetchImpl: (async () => ({})) as unknown as typeof fetch,
  readCredentials: async () => ({ apiKey: 'api-key', secret: 'secret' }),
  [kind.readKey]: fetchRecords,
  ensureHoldings: async () => undefined,
});

/** Keeps the logged stops of the walks out of the output of the cases of the suite it is in. */
const quietWarnings = (): void => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });
};

describe.each(KIND_CLOCKS)(
  'the $kindName walk over generated worlds, runs $label',
  ({ kind, clock }) => {
    quietWarnings();

    describe.each(WORLDS)('with $stuck owed ground placed $place', (world) => {
      const { stuck } = world;

      it.each(SEEDS)(
        'imports every record Binance serves within the bound, each once: seed %i',
        async (seed) => {
          const random = seededRandom(seed);
          const served = servedWorldOf(random, clock, kind);
          const owed = owedRangesOf(random, world);
          const importRuns = kind.importRunsOf(zonesInWindowOf(owed, clock));
          const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: kind.holdings });
          const offers: Offer[] = [];
          let run = 0;

          fake.seed(kind.walkId, { cursor: START_CURSOR, pending: owed });

          const fetchRecords = async (
            apiKey: string,
            secret: string,
            type: FiatTransactionType,
            span: Span,
            page: number,
          ) => {
            const runNow = clock.at(run);
            const servedNow = served.filter(
              (item) => item.servedFromRun <= run && item.record.createTime <= runNow,
            );
            const touchesOwed = owed.some(
              (range) => span.start <= range.end && span.end >= range.start,
            );

            if (stuck === 'drift' && touchesOwed) {
              return fiatPageOf<AnyRecord>([], { total: 5 });
            }

            if (stuck === 'throw' && touchesOwed) {
              throw new BinanceHistoryParseError();
            }

            if (stuck === 'tooOld' && span.start < runNow - SERVED_BACK_MS) {
              throw new BinanceHistoryTooOldError('Binance request failed: 400: too old');
            }

            const recordsOf = (wanted: FiatTransactionType): AnyRecord[] =>
              servedNow.filter((item) => item.type === wanted).map(({ record }) => record);

            return fiatServerOf({ '0': recordsOf('0'), '1': recordsOf('1') }, kind.pageRows)(
              apiKey,
              secret,
              type,
              span,
              page,
            );
          };

          for (run = 0; run < RUNS; run += 1) {
            const runNow = clock.at(run);

            await kind
              .sync(
                {
                  targetAccountId: ACCOUNT_ID,
                  run: createBinanceHistoryRun({ now: () => runNow, sleep: async () => undefined }),
                },
                {
                  ...connectedDepsOf(kind, runNow, fetchRecords),
                  addTransactions: async (rows) => {
                    offers.push(...rows.map(({ externalId }) => ({ run, externalId })));

                    return rows.length;
                  },
                  ...fake.freshDeps(),
                  listHoldings: fake.listHoldings,
                },
              )
              .catch((error: unknown) => {
                if (!(error instanceof BinanceHistoryParseError)) {
                  throw error;
                }
              });
          }

          const importedAtRun = (orderNo: string): number | undefined =>
            offers.find(({ externalId }) => orderNoOf(externalId) === orderNo)?.run;
          // A server that fails every read touching an owed day serves no record inside it.
          const isReadable = ({ record }: Served): boolean =>
            stuck === 'tooOld' ||
            !owed.some(
              (range) => record.createTime >= range.start && record.createTime <= range.end,
            );
          const dueRunOf = ({ record, servedFromRun }: Served): number | undefined =>
            Array.from(
              { length: RUNS - servedFromRun },
              (_unused, offset) => servedFromRun + offset,
            )
              .filter((reachable) => record.createTime <= clock.at(reachable))
              .at(importRuns - 1);
          const missing = served
            .filter(isReadable)
            .flatMap(
              (item) =>
                foldMap(maybe(dueRunOf(item)), (dueRun) => [
                  {
                    orderNo: item.record.orderNo,
                    servedFromRun: item.servedFromRun,
                    dueRun,
                    importedAtRun: importedAtRun(item.record.orderNo),
                  },
                ]) ?? [],
            )
            .filter(({ dueRun, importedAtRun: at }) => at === undefined || at > dueRun);
          const keysOfOrder = new Map<string, Set<string>>();

          for (const { externalId } of offers) {
            const orderNo = orderNoOf(externalId) ?? '';

            keysOfOrder.set(orderNo, new Set([...(keysOfOrder.get(orderNo) ?? []), externalId]));
          }

          expect(missing).toEqual([]);
          expect(
            [...keysOfOrder].filter(
              ([orderNo, keys]) =>
                keys.size !== 1 || !served.some(({ record }) => record.orderNo === orderNo),
            ),
          ).toEqual([]);
        },
      );
    });
  },
);

const STATUS_RUN_GAPS = [0, HOUR_MS, DAY_MS];
const STATUS_RUNS = 60;
const STATUS_NOISY_RUNS = 14;
const STATUS_SEEDS = Array.from({ length: 32 }, (_unused, position) => 33 + position * 11);
const STATUS_ACCOUNT_ID = 'acc-fiat-statuses-properties';

type StatusCategory = 'settled' | 'refused' | 'untracked' | 'openThenSettled' | 'openThenRefused';

/** A category twice in the list is drawn twice as often. */
const STATUS_CATEGORIES: StatusCategory[] = [
  'settled',
  'settled',
  'refused',
  'untracked',
  'openThenSettled',
  'openThenRefused',
];

/**
 * The words the walk lists as not recognized, besides the spellings of the settled word that are
 * not exactly it (added per kind).
 */
const REFUSED_WORDS = [
  'Failed',
  'Refunded',
  'Finished',
  'Refunding',
  'Refund Failed',
  'Order Partial Credit Stopped',
  'Unheard Of',
];

type OwedGround = { start: number; end: number; kind?: 'point' };

type StatusExpected = {
  key?: string;
  units?: number;
  marker?: string;
  entry?: string;
  untracked?: string;
};

type StatusMade = {
  record: AnyRecord;
  type: FiatTransactionType;
  expected: StatusExpected;
  /** The run from which the record has its final status; before it Binance shows `Processing`. */
  settlesAtRun: number | undefined;
};

const pick = <Item>(random: Random, items: readonly Item[]): Item =>
  items[Math.floor(random() * items.length)];

const entryOfRecord = ({ orderNo, createTime }: AnyRecord): string =>
  `fiat-unrecognized:${orderNo}:${createTime}`;

type Final = { record: AnyRecord; expected: StatusExpected };

/** The final status and what it comes to, for a category. */
const finalOf = (input: {
  kind: WorldKind;
  category: StatusCategory;
  random: Random;
  made: Omit<StatusRecordInput, 'status' | 'untracked'>;
  accountId: string;
}): Final => {
  const { kind, category, random, made, accountId } = input;
  const build = (status: string, untracked = false): AnyRecord =>
    kind.statusRecordOf({ ...made, status, untracked });

  if (category === 'settled' || category === 'openThenSettled') {
    return {
      record: build(kind.settledWord),
      expected: kind.rowOf({ accountId, orderNo: made.orderNo, n: made.n, type: made.type }),
    };
  }

  if (category === 'untracked') {
    return { record: build(kind.settledWord, true), expected: { untracked: 'XYZ' } };
  }

  const record = build(
    pick(random, [
      ...REFUSED_WORDS,
      kind.settledWord.toLowerCase(),
      ` ${kind.settledWord}`,
      `${kind.settledWord} `,
    ]),
  );

  return { record, expected: { entry: entryOfRecord(record) } };
};

const statusMadeOf = (input: {
  kind: WorldKind;
  random: Random;
  index: number;
  accountId: string;
  gapMs: number;
}): StatusMade => {
  const { kind, random, index, accountId, gapMs } = input;
  const category = pick(random, STATUS_CATEGORIES);
  const type = pick<FiatTransactionType>(random, ['0', '1']);
  const lastClock = FIRST_RUN_AT + (STATUS_RUNS - 1) * gapMs;
  const made = {
    orderNo: `record-${index}`,
    createTime: HISTORY_FLOOR_MS + Math.floor(random() * (lastClock - HISTORY_FLOOR_MS)),
    type,
    n: 1 + Math.floor(random() * 4_000),
  };
  const waits = category === 'openThenSettled' || category === 'openThenRefused';

  return {
    ...finalOf({ kind, category, random, made, accountId }),
    type,
    settlesAtRun: waits ? 1 + Math.floor(random() * (STATUS_NOISY_RUNS - 2)) : undefined,
  };
};

/** The record as Binance shows it at run `run`: `Processing` before the run that settles it. */
const shownAtRun = ({ record, settlesAtRun }: StatusMade, run: number): AnyRecord =>
  settlesAtRun !== undefined && run < settlesAtRun ? { ...record, status: 'Processing' } : record;

type StatusWorld = {
  accountId: string;
  gapMs: number;
  made: StatusMade[];
  disturbances: Disturbances;
};

const statusWorldOf = (kind: WorldKind, seed: number, gapMs: number): StatusWorld => {
  const random = seededRandom(seed);
  const accountId = `${STATUS_ACCOUNT_ID}-${kind.walkId}-${gapMs}-${seed}`;
  const made = Array.from({ length: 12 + Math.floor(random() * 24) }, (_unused, index) =>
    statusMadeOf({ kind, random, index, accountId, gapMs }),
  );
  const disturbances = disturbancesOf({
    random,
    runs: STATUS_RUNS,
    noisyRuns: STATUS_NOISY_RUNS,
    lane: kind.walkId,
    from: HISTORY_FLOOR_MS,
    days: Math.floor((FIRST_RUN_AT - HISTORY_FLOOR_MS) / DAY_MS),
    errorOf: () => new BinanceHistoryParseError(),
  });

  return { accountId, gapMs, made, disturbances };
};

/** The records that wait on Binance at `run` and have left a row or an entry. */
const waitingWithTraces = (world: StatusWorld, run: number, runNow: number, traces: string[]) =>
  world.made
    .filter(
      ({ record, settlesAtRun }) =>
        settlesAtRun !== undefined && run < settlesAtRun && record.createTime <= runNow,
    )
    .filter(({ expected }) =>
      traces.some((trace) => trace === expected.key || trace === expected.entry),
    )
    .map(({ record }) => record.orderNo);

type StatusOutcome = {
  stored: Map<string, { amountMinorUnits: number; untrackedCounterpart: string }>;
  fake: ReturnType<typeof walkStateFake>;
  last: WalkResult | undefined;
  finalClock: number;
};

const runStatusWorld = async (kind: WorldKind, world: StatusWorld): Promise<StatusOutcome> => {
  const { accountId, gapMs, made, disturbances } = world;
  const fake = walkStateFake({ accountId, alongside: kind.holdings });
  const stored: StatusOutcome['stored'] = new Map();
  const current: CurrentRun = { run: 0, now: FIRST_RUN_AT };
  let reads = 0;

  const fetchRecords = async (
    apiKey: string,
    secret: string,
    type: FiatTransactionType,
    span: Span,
    page: number,
  ) => {
    reads += 1;
    const failure = readFailureOf(disturbances, current, span);

    if (failure !== undefined) {
      throw failure;
    }

    const shown = made.filter(({ record }) => record.createTime <= current.now);
    const recordsOf = (wanted: FiatTransactionType): AnyRecord[] =>
      shown.filter((item) => item.type === wanted).map((item) => shownAtRun(item, current.run));

    return fiatServerOf({ '0': recordsOf('0'), '1': recordsOf('1') }, kind.pageRows)(
      apiKey,
      secret,
      type,
      span,
      page,
    );
  };

  const { last, finalClock } = await walkRuns({
    runs: STATUS_RUNS,
    gapMs,
    firstRunAt: FIRST_RUN_AT,
    accountId,
    lane: kind.walkId,
    disturbances,
    current,
    reads: () => reads,
    walk: ({ runNow, walkRun }) =>
      kind.sync(
        { targetAccountId: accountId, run: walkRun },
        {
          ...connectedDepsOf(kind, runNow, fetchRecords),
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
        waitingWithTraces(world, run, runNow, [...stored.keys(), ...fake.notImported()]),
      ).toEqual([]),
  });

  return { stored, fake, last, finalClock };
};

const STATUS_KIND_GAPS = STATUS_KINDS.flatMap((kind) =>
  STATUS_RUN_GAPS.map((gapMs) => ({ kind, gapMs, kindName: kind.name })),
);

describe.each(STATUS_KIND_GAPS)(
  'the $kindName walk over generated statuses, runs $gapMs ms apart',
  ({ kind, gapMs }) => {
    quietWarnings();

    it.each(STATUS_SEEDS)(
      'imports each settled record once at its exact amount, lists each refusal once, and ends current: seed %i',
      async (seed) => {
        const world = statusWorldOf(kind, seed, gapMs);
        const { stored, fake, last, finalClock } = await runStatusWorld(kind, world);
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
        const owed = (fake.marksOf(kind.walkId).pending ?? []) as OwedGround[];

        expect(last).toBeDefined();
        // A run after a forward run reads behind, so the cursor is at most one run old.
        expect(fake.marksOf(kind.walkId).cursor).toBeGreaterThanOrEqual(finalClock - gapMs);
        expect(owed.filter(({ kind: groundKind }) => groundKind === 'point')).toEqual([]);
        // The ground left owed is the overlap day of the last forward read, at most.
        expect(owed.filter(({ end }) => end < finalClock - 3 * gapMs)).toEqual([]);
      },
    );
  },
);
