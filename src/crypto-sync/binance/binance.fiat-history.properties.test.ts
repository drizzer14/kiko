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
import {
  fiatOrderOf,
  fiatPageOf,
  fiatPaymentOf,
  fiatServerOf,
  HALVINGS_OVER_A_WINDOW,
  READS_OVER_A_WINDOW,
} from './binance.fiat-test-fixtures';
import { NOW } from './binance.pay-test-fixtures';
import { BinanceHistoryTooOldError } from './binance.client';
import { createBinanceHistoryRun } from './binance.history-budget';
import { HISTORY_FLOOR_MS, RESYNC_OVERLAP_MS } from './binance.transactions';

/**
 * The fiat walks driven over generated worlds through `syncBinanceFiatOrderHistory` (a lane of
 * three calls, so a run reads forward or behind) and `syncBinanceFiatPaymentHistory` (a lane that
 * reads forward and behind in one run) themselves, in several runs. The clock of the runs stands
 * still, moves on by a millisecond, an hour or a day a run, or is set back to before the walk's
 * cursor. A world holds records Binance writes late (older than the walk's cursor and the overlap
 * day), a new record on some runs, and, in some worlds, owed ground anywhere between the history
 * floor and the cursor, inside the 2-year re-scan window too, that no read clears (a page that
 * drifts, a page that throws) or that Binance refuses as older than it serves, and, in some
 * worlds, an hour with more rows of each type than a page holds (behind a failing day, in the
 * forward ground or inside an old owed range that reads fine). What must be
 * imported is decided by the records the generator made, never read back from the walk.
 *
 * The second suite drives the same walks over every kind of status (a settled record, a word the
 * walk does not know, a record that waits on Binance and settles or is refused later, a coin Kiko
 * does not track), with disturbed first runs: part of the lane spent, a window that throws, a 429.
 */

const HOUR_MS = 3_600_000;

/** Runs enough for the longest bound (six failing days in the window, on orders: 52). */
const RUNS = 60;

/**
 * The runs the records of a world are drawn for. A world driven for more runs than this draws the
 * same numbers as one driven for `RUNS`, so no world or named seed that exists is changed by the
 * runs a dense world needs.
 */
const GENERATED_RUNS = 60;

/** The runs a dense world is driven for: its bound adds the reads of a halving to each pass. */
const DENSE_RUNS = 120;
const SEEDS = Array.from({ length: 30 }, (_unused, position) => 5 + position * 7);

/**
 * The seeds of the worlds that are driven for a few hundred runs a case (a wide owed range, a
 * dense hour of the whole re-scan window): every fifth of `SEEDS`, so the file does not take
 * minutes more for the runs those worlds need.
 */
const LONG_WORLD_SEEDS = SEEDS.filter((_unused, position) => position % 5 === 0);
const ACCOUNT_ID = 'acc-fiat-orders-properties';
const FIRST_RUN_AT = NOW;

/** The cursor the walk starts with: an hour behind the first run. */
const START_CURSOR = FIRST_RUN_AT - HOUR_MS;

/** The run the clock is set back at, in the worlds that set it back. */
const SET_BACK_RUN = 4;

type RunClock = {
  label: string;
  /** The clock moves on by this much between two runs. */
  gapMs: number;
  /** The clock of a run. */
  at: (run: number) => number;
  /** A new record is written this far behind the clock of the run that first serves it, at most. */
  reachMs: number;
};

const steadyClock = (gapMs: number, reachMs: number): RunClock => ({
  label: `${gapMs} ms apart`,
  gapMs,
  at: (run) => FIRST_RUN_AT + run * gapMs,
  reachMs,
});

/** Runs a gap apart whose clock is set back by `backMs` at `SET_BACK_RUN`, to before the cursor. */
const setBackClock = (gapMs: number, backMs: number): RunClock => ({
  label: `${gapMs} ms apart, set back ${backMs} ms`,
  gapMs,
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

/**
 * The runs between two reads of the re-scan on the orders lane. A run reads forward or behind, and
 * the run after a behind run reads forward; while owed ground is left the behind runs alternate
 * the owed windows and the re-scan, so the runs go forward, owed, forward, re-scan: one read (two
 * of the lane's three calls) on every fourth run.
 */
const RESCAN_EVERY_RUNS = 4;

/**
 * The runs between two reads of the re-scan on the payments lane: it reads forward and behind in
 * one run, so the re-scan keeps one read (`RESCAN_KEEP`) of every run and no turn of the owed
 * windows takes a run from it.
 */
const PAYMENTS_RESCAN_EVERY_RUNS = 1;

/**
 * The reads of a first pass over a re-scan window with `z` failing days: each failing day is found
 * by a failing read, which marks it, and the pass reads around it, in a piece before it and a
 * piece after it that runs to the window end. That is `z` failing reads and `z + 1` reads of the
 * pieces between them. A pass after it skips the marked days and takes the `z + 1` reads.
 */
const firstPassReadsOf = (zonesInWindow: number): number => 2 * zonesInWindow + 1;

/**
 * The marks the re-scan puts on one failing day that lies in an owed range wider than a day. Such a
 * range is two or more owed days merged: the list of owed ground merges its two nearest ranges
 * once it holds more than twelve, which happens when every run adds an overlap day of its own, a
 * clock that moves by `RESYNC_OVERLAP_MS` or more. A failed span is halved to a day and only the
 * owed range in it is marked, so the marks of one day are disjoint spans, each wider than half a
 * day, that touch it: at most `floor(day / (day / 2)) + 2`.
 */
const MARKS_PER_FAILING_DAY = Math.floor(DAY_MS / (DAY_MS / 2)) + 2;

/**
 * The reads one failing day adds to the first pass over the window once its owed range is merged.
 * The piece after a mark runs to the window end, so each mark takes the halvings from a window
 * down to a day and the read that marks, `HALVINGS_OVER_A_WINDOW + 1`, where one read marked the
 * day whole before.
 */
const MERGED_DAY_EXTRA_READS = MARKS_PER_FAILING_DAY * (HALVINGS_OVER_A_WINDOW + 1) - 1;

/** The widest gap between two owed days of a cluster; the narrowest is an hour. */
const CLUSTER_GAP_MS = 3 * DAY_MS;

/** The ground the forward pass reads behind the cursor in the world with a dense forward hour. */
const FORWARD_GROUND_MS = CLUSTER_GAP_MS;

/**
 * The reads a halving adds to a pass over a cluster world: `H = 2 x (ceil(log2(CLUSTER_GAP_MS /
 * HOUR_MS)) + 1)`. The span after a stuck day holds more rows than a page in the hour after the
 * day, so a read of it comes back full and halves until a piece fits a page, as many times as the
 * span holds hours of the widest gap, and the pieces double back to the span end: the halving
 * reads to fit a page and the doubling back, with slack. The hour starts the span, so each level of
 * the halving is one read.
 */
const HALVING_READS = 2 * (Math.ceil(Math.log2(CLUSTER_GAP_MS / HOUR_MS)) + 1);

/**
 * The reads of a halving out of a span that holds the dense hour anywhere in it, when the hour is
 * in the second half of the span at every level: the read of the span comes back full, the read of
 * its first half fits and is committed, and the read of the span after it, as wide as the span was
 * (a commit doubles the width), comes back full again and halves to the second half, one level
 * deeper. That is 3 reads a level, `ceil(log2(span / hour))` levels and one level for the last
 * piece.
 */
const halvingReadsOutOf = (spanMs: number): number =>
  3 * (Math.ceil(Math.log2(spanMs / HOUR_MS)) + 1);

/**
 * The re-scan reads over a dense hour that no owed day bounds: the dense hour of the forward world
 * once the forward pass is past it, a dense hour with no owed day within 2 days, and one right
 * after the last owed day. The re-scan spans start at the window start and double, and the piece
 * after the last owed day runs to the window end, so the span that first holds the hour is up to a
 * whole window wide.
 */
const WINDOW_HALVING_READS = halvingReadsOutOf(FIAT_WINDOW_MS);

/** A cluster holds four to six owed days (`clusteredOwedRangesOf`). */
const MOST_CLUSTER_DAYS = 6;

/** Only the owed pass reads the dense hour of the old owed range, which is at most a gap wide. */
const OLD_OWED_HOUR_HALVING_READS = halvingReadsOutOf(CLUSTER_GAP_MS);

/**
 * The runs a record served is imported within: `importRuns(z) = r * F(z)`, `r` being the runs
 * between two reads of the re-scan (`runsPerRescanRead`) and `F(z)` the reads of the first pass
 * (`firstPassReadsOf`). A record waits at most for the rest of the pass it is served in and its
 * place in the next one, which together are no more than a first pass. With no failing day a pass
 * is one read, and a record served just after it waits for the next. A world behind full pages
 * adds the halving to each pass: `importRuns(z) = r * (F(z) + H)`, `H` being the reads of the
 * halving of the world (`halvingReads`). A record served from run `v` is imported by the
 * `importRuns(z)`th run it is within the reach of the clock from `v` on (a run whose clock is
 * before the record cannot read it).
 */
const importRunsWithin =
  (runsPerRescanRead: number) =>
  (zonesInWindow: number, halvingReads: number, mergedRanges = false): number =>
    runsPerRescanRead *
    (firstPassReadsOf(zonesInWindow) +
      halvingReads +
      (mergedRanges ? zonesInWindow * MERGED_DAY_EXTRA_READS : 0));

/**
 * The runs the world with a dense forward hour is driven for: the bound of the orders lane with
 * its one owed day in the window and the halving of the re-scan, and 20 runs more, so a record
 * served from the first run is checked against the whole bound.
 */
const FORWARD_HOUR_RUNS = importRunsWithin(RESCAN_EVERY_RUNS)(1, WINDOW_HALVING_READS) + 20;

/** Late records are written between 2 days and this many days behind the run that serves them. */
const LATE_BACK_DAYS = 600;

/** Binance serves history this far back; the tooOld worlds refuse a read that starts earlier. */
const SERVED_BACK_MS = 1_000 * DAY_MS;

type Stuck = 'none' | 'drift' | 'throw' | 'tooOld';

type Place =
  | 'anywhere'
  | 'in the window'
  | 'in a cluster'
  | 'in a cluster, behind full pages'
  | 'in a forward hour, behind full pages'
  | 'in an old owed range, behind full pages'
  | 'after the last owed day, behind full pages'
  | 'in the window, away from the owed days, behind full pages'
  | 'in a wide owed range'
  | 'in a wide owed range, older than the window';

type World = { stuck: Stuck; place: Place };

const isDense = ({ place }: World): boolean =>
  place === 'in a cluster, behind full pages' ||
  place === 'in a forward hour, behind full pages' ||
  place === 'in an old owed range, behind full pages' ||
  place === 'after the last owed day, behind full pages' ||
  place === 'in the window, away from the owed days, behind full pages';

const isClustered = ({ place }: World): boolean =>
  place === 'in a cluster' ||
  place === 'in a cluster, behind full pages' ||
  place === 'after the last owed day, behind full pages' ||
  place === 'in the window, away from the owed days, behind full pages';

/** A dense hour that only the re-scan reads, with no owed day behind it to bound the halving. */
const hasDenseWindowHour = ({ place }: World): boolean =>
  place === 'after the last owed day, behind full pages' ||
  place === 'in the window, away from the owed days, behind full pages';

/**
 * One owed range that is wider than the day in it that fails: the ground a repaired list leaves,
 * from the history floor on, or the part of it that is older than the re-scan window.
 */
const isWide = ({ place }: World): boolean =>
  place === 'in a wide owed range' || place === 'in a wide owed range, older than the window';

const hasDenseForwardHour = ({ place }: World): boolean =>
  place === 'in a forward hour, behind full pages';

const hasDenseOldOwedHour = ({ place }: World): boolean =>
  place === 'in an old owed range, behind full pages';

/**
 * Owed ground anywhere behind the cursor, and, for the two failing kinds, in the last 500 days or
 * four to six days in a row there, the last with more rows of each type than a page holds in the
 * hour after the first of them. Two more worlds put that many rows in one hour of the ground a pass
 * reads over several runs: the forward ground, with a failing owed day behind the cursor, and an
 * owed range older than the re-scan window that reads fine, so only the owed pass reads the hour.
 * The dense hour also comes right after the last owed day of a cluster, in the window with no owed
 * day within 2 days of it, and in a window with no owed day at all. The owed range is wide, from
 * the history floor on or older than the window, with one failing day inside it.
 */
const WORLDS: World[] = [
  { stuck: 'none', place: 'anywhere' },
  { stuck: 'drift', place: 'anywhere' },
  { stuck: 'drift', place: 'in the window' },
  { stuck: 'throw', place: 'anywhere' },
  { stuck: 'throw', place: 'in the window' },
  { stuck: 'drift', place: 'in a cluster' },
  { stuck: 'throw', place: 'in a cluster' },
  { stuck: 'drift', place: 'in a cluster, behind full pages' },
  { stuck: 'throw', place: 'in a cluster, behind full pages' },
  { stuck: 'throw', place: 'in a forward hour, behind full pages' },
  { stuck: 'none', place: 'in an old owed range, behind full pages' },
  { stuck: 'tooOld', place: 'anywhere' },
  { stuck: 'drift', place: 'after the last owed day, behind full pages' },
  { stuck: 'throw', place: 'after the last owed day, behind full pages' },
  { stuck: 'drift', place: 'in the window, away from the owed days, behind full pages' },
  { stuck: 'throw', place: 'in the window, away from the owed days, behind full pages' },
  { stuck: 'none', place: 'in the window, away from the owed days, behind full pages' },
  { stuck: 'drift', place: 'in a wide owed range' },
  { stuck: 'throw', place: 'in a wide owed range' },
  { stuck: 'drift', place: 'in a wide owed range, older than the window' },
  { stuck: 'throw', place: 'in a wide owed range, older than the window' },
];

type NamedSeed = {
  kindName: 'fiat orders' | 'fiat payments';
  label: string;
  seed: number;
  stuck: Stuck;
  place: Place;
};

const denseSeedsOf = (
  kindName: NamedSeed['kindName'],
  stuck: Stuck,
  seeds: number[],
): NamedSeed[] =>
  seeds.map((seed) => ({
    kindName,
    label: 'behind full pages',
    seed,
    stuck,
    place: 'in a cluster, behind full pages',
  }));

/**
 * Seeds whose worlds a walk read slowly, each one run in the world it failed in. The payments
 * seeds labelled "after a stuck day" failed while a read of the piece after a stuck day ended
 * where a doubled span did; the seeds labelled "behind full pages" failed there, where a re-scan
 * that starts right after a stuck range halved a full page again in every run and the pass never
 * ended.
 */
const NAMED_SEEDS: NamedSeed[] = [
  ...(
    [
      { seed: 1027, place: 'anywhere' },
      { seed: 334, place: 'anywhere' },
      { seed: 306, place: 'in a cluster' },
      { seed: 558, place: 'in a cluster' },
      { seed: 642, place: 'in a cluster' },
    ] satisfies { seed: number; place: Place }[]
  ).map(
    ({ seed, place }): NamedSeed => ({
      kindName: 'fiat payments',
      label: 'after a stuck day',
      seed,
      stuck: 'drift',
      place,
    }),
  ),
  ...denseSeedsOf('fiat payments', 'drift', [5, 19, 26]),
  ...denseSeedsOf('fiat payments', 'throw', [26, 89, 201]),
  ...denseSeedsOf('fiat orders', 'drift', [5, 19, 26]),
  ...denseSeedsOf('fiat orders', 'throw', [5, 19, 26]),
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
  /** The runs between two reads of the re-scan, and of the owed windows (`r` of the bound). */
  runsBetweenReads: number;
  /** The runs a record served is imported within, `zones` being the failing days in the window. */
  importRunsOf: (zones: number, halvingReads: number, mergedRanges?: boolean) => number;
};

const ORDERS_KIND: BoundedKind = {
  name: 'fiat orders',
  walkId: 'fiatOrders',
  readKey: 'fetchFiatOrders',
  pageRows: 500,
  holdings: [holdingWith('h-eur-spot', { binanceAsset: 'EUR' })],
  sync: syncBinanceFiatOrderHistory,
  recordOf: ({ type: _type, ...parts }) => fiatOrderOf(parts),
  runsBetweenReads: RESCAN_EVERY_RUNS,
  importRunsOf: importRunsWithin(RESCAN_EVERY_RUNS),
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

const PAYMENTS_KIND: BoundedKind = {
  name: 'fiat payments',
  walkId: 'fiatPayments',
  readKey: 'fetchFiatPayments',
  pageRows: 100,
  holdings: [],
  sync: syncBinanceFiatPaymentHistory,
  recordOf: paymentOf,
  runsBetweenReads: PAYMENTS_RESCAN_EVERY_RUNS,
  importRunsOf: importRunsWithin(PAYMENTS_RESCAN_EVERY_RUNS),
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

  for (let run = 0; run < GENERATED_RUNS; run += 1) {
    const reachMs = run === 0 ? Math.min(clock.reachMs, HOUR_MS) : clock.reachMs;

    for (let count = Math.floor(random() * 3); count > 0; count -= 1) {
      add(`new-${served.length}`, clock.at(run) - Math.floor(random() * reachMs), run);
    }
  }

  // The first late record is served from the first run, so the first pass over the window, which
  // takes the most reads when a day in it fails, is one a record waits for.
  const lateCount = 2 + Math.floor(random() * 5);

  for (let index = 0; index < lateCount; index += 1) {
    const servedFromRun = index === 0 ? 0 : Math.floor(random() * GENERATED_RUNS);
    const backDays = 2 + Math.floor(random() * LATE_BACK_DAYS);

    add(`late-${served.length}`, clock.at(servedFromRun) - backDays * DAY_MS, servedFromRun);
  }

  return served;
};

/**
 * Four to six owed days one after another in the window, each an hour to 3 days after the one
 * before: the ground between them is a short piece of the pass.
 */
const clusteredOwedRangesOf = (random: () => number): Span[] => {
  let cursor = START_CURSOR - IN_WINDOW_MS + Math.floor(random() * (IN_WINDOW_MS - 60 * DAY_MS));

  return Array.from({ length: 4 + Math.floor(random() * 3) }, () => {
    const start = cursor + HOUR_MS + Math.floor(random() * (CLUSTER_GAP_MS - HOUR_MS));

    cursor = start + DAY_MS;

    return { start, end: cursor };
  });
};

/**
 * The cursor the walk starts with: an hour behind the first run, or, in the world with a dense
 * forward hour, the forward ground behind that.
 */
const cursorOf = (world: World): number =>
  hasDenseForwardHour(world) ? START_CURSOR - FORWARD_GROUND_MS : START_CURSOR;

/**
 * One owed range, a day to the widest gap of a cluster wide, that ends before the re-scan window
 * of any run starts (the earliest clock of a run is 5 days before the first one's, so the range
 * ends 10 days before the window), so only the owed pass reads it.
 */
const oldOwedRangeOf = (random: () => number): Span => {
  const latestStart = START_CURSOR - FIAT_WINDOW_MS - 10 * DAY_MS - CLUSTER_GAP_MS;
  const start = HISTORY_FLOOR_MS + Math.floor(random() * (latestStart - HISTORY_FLOOR_MS));

  return { start, end: start + DAY_MS + Math.floor(random() * (CLUSTER_GAP_MS - DAY_MS)) };
};

/**
 * The wide owed range of a world: from the history floor to the cursor, or only the part of it
 * that ends before the re-scan window of any run starts (see `oldOwedRangeOf`).
 */
const wideOwedRangeOf = (world: World): Span => ({
  start: HISTORY_FLOOR_MS,
  end:
    world.place === 'in a wide owed range'
      ? START_CURSOR
      : START_CURSOR - FIAT_WINDOW_MS - 10 * DAY_MS,
});

/** One to three owed days, each placed by the world: anywhere from the floor to the cursor. */
const owedRangesOf = (random: () => number, world: World): Span[] => {
  const cursor = cursorOf(world);
  const earliest = world.place === 'in the window' ? cursor - IN_WINDOW_MS : HISTORY_FLOOR_MS;

  if (isWide(world)) {
    return [wideOwedRangeOf(world)];
  }

  if (hasDenseWindowHour(world) && world.stuck === 'none') {
    return [];
  }

  if (isClustered(world)) {
    return clusteredOwedRangesOf(random);
  }

  if (hasDenseOldOwedHour(world)) {
    return [oldOwedRangeOf(random)];
  }

  if (hasDenseForwardHour(world)) {
    const start = cursor - IN_WINDOW_MS + Math.floor(random() * (IN_WINDOW_MS - DAY_MS));

    return [{ start, end: start + DAY_MS }];
  }

  return world.stuck === 'none'
    ? []
    : Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const start = earliest + Math.floor(random() * (cursor - DAY_MS - earliest));

        return { start, end: start + DAY_MS };
      });
};

/**
 * The days a read fails on: the owed days themselves, or, in a wide owed range, one day anywhere
 * in it, so the read of any span that touches the day fails and the rest of the range reads.
 */
const failingOf = (random: () => number, world: World, owed: Span[]): Span[] => {
  if (!isWide(world)) {
    return owed;
  }

  const [range] = owed;
  const start = range.start + Math.floor(random() * (range.end - range.start - DAY_MS));

  return [{ start, end: start + DAY_MS }];
};

/**
 * The ground a failing read keeps owed beyond its day: the day a failed span is halved to, on each
 * side of the failing day, in a wide owed range. An owed range of a day has nothing to isolate.
 */
const lostMarginOf = (world: World): number => (isWide(world) ? DAY_MS : 0);

/**
 * The runs a record served is imported within in a wide owed range: `r x (R + W + F(1))`. `R` is
 * the reads of the owed pass over the window that holds the failing day (`READS_OVER_A_WINDOW`),
 * `W` the windows of the range (each read once more), and `F(1)` the reads of the first pass over
 * the re-scan window after the failing day is isolated, `r` the runs between two reads of the owed
 * windows (those of the re-scan). A record served after the day is isolated waits for the next
 * pass over its ground, `r x F(1)`; one served before waits for the isolation first.
 */
const wideImportRunsOf = (kind: BoundedKind, owed: Span[]): number =>
  kind.runsBetweenReads *
  (READS_OVER_A_WINDOW +
    Math.ceil((owed[0].end - owed[0].start) / FIAT_WINDOW_MS) +
    firstPassReadsOf(1));

/** The reads a halving adds to each pass of a world: none unless it holds a dense hour. */
const halvingReadsOf = (world: World): number => {
  if (hasDenseForwardHour(world) || hasDenseWindowHour(world)) {
    return WINDOW_HALVING_READS;
  }

  if (hasDenseOldOwedHour(world)) {
    return OLD_OWED_HOUR_HALVING_READS;
  }

  return isDense(world) ? HALVING_READS : 0;
};

/**
 * Whether the owed days of a world can be merged into wider ranges: they fail, and every run adds
 * an overlap day of its own (`MERGED_DAY_EXTRA_READS`). A wide owed range has its own bound.
 */
const mergesOwedRanges = (world: World, clock: RunClock): boolean =>
  (world.stuck === 'drift' || world.stuck === 'throw') &&
  !isWide(world) &&
  clock.gapMs >= RESYNC_OVERLAP_MS;

/** The runs a world is driven for: the bound of its worst case and 20 runs more. */
const runsOf = (world: World, kind: BoundedKind, owed: Span[], clock: RunClock): number => {
  const merged = mergesOwedRanges(world, clock);
  const mergedRuns = merged
    ? kind.importRunsOf(owed.length, halvingReadsOf(world), merged) + 20
    : 0;

  if (hasDenseForwardHour(world)) {
    return Math.max(FORWARD_HOUR_RUNS, mergedRuns);
  }

  if (isWide(world)) {
    return wideImportRunsOf(kind, owed) + 20;
  }

  if (hasDenseWindowHour(world)) {
    return Math.max(kind.importRunsOf(MOST_CLUSTER_DAYS, WINDOW_HALVING_READS) + 20, mergedRuns);
  }

  return Math.max(isDense(world) ? DENSE_RUNS : RUNS, mergedRuns);
};

/** The owed days whose ground the re-scan reads, as far back as any run of the clock reads. */
const zonesInWindowOf = (owed: Span[], clock: RunClock, runs: number): number => {
  const earliestRead =
    Math.min(...Array.from({ length: runs }, (_unused, run) => clock.at(run))) - FIAT_WINDOW_MS;

  return owed.filter((range) => range.end >= earliestRead).length;
};

/** The seeds of a world with the title of the case, the named seeds of its kind after them. */
const casesOf = (kind: BoundedKind, world: World): { seed: number; title: string }[] => [
  ...(isWide(world) || hasDenseWindowHour(world) ? LONG_WORLD_SEEDS : SEEDS).map((seed) => ({
    seed,
    title: `imports every record Binance serves within the bound, each once: seed ${seed}`,
  })),
  ...NAMED_SEEDS.filter(
    ({ kindName, stuck, place }) =>
      kindName === kind.name && stuck === world.stuck && place === world.place,
  ).map(({ seed, label }) => ({
    seed,
    title: `imports every record Binance serves within the bound, each once (${label}): seed ${seed}`,
  })),
];

/** The hour of a dense window world is no closer than this to an owed day. */
const AWAY_FROM_OWED_MS = 2 * DAY_MS;

/**
 * An hour inside the re-scan window of every run, up to 700 days behind the walk's cursor, with no
 * owed day within `AWAY_FROM_OWED_MS` of it; the owed days of a cluster fill at most 24 days of
 * the last 500, so a few draws find one.
 */
const awayHourStartOf = (random: () => number, owed: Span[]): number => {
  const draws = Array.from(
    { length: 50 },
    () => START_CURSOR - 700 * DAY_MS + Math.floor(random() * 690 * DAY_MS),
  );

  return (
    draws.find((start) =>
      owed.every(
        (range) =>
          start > range.end + AWAY_FROM_OWED_MS ||
          start + HOUR_MS < range.start - AWAY_FROM_OWED_MS,
      ),
    ) ?? START_CURSOR - 700 * DAY_MS
  );
};

/**
 * Where the hour of full pages of a dense world starts: right after the first or the last owed
 * day of a cluster, anywhere in the forward ground, anywhere inside the old owed range, an hour
 * away from its ends, or anywhere in the window away from the owed days.
 */
const denseHourStartOf = (random: () => number, world: World, owed: Span[]): number => {
  if (hasDenseForwardHour(world)) {
    return cursorOf(world) + HOUR_MS + Math.floor(random() * (FORWARD_GROUND_MS - 2 * HOUR_MS));
  }

  if (hasDenseOldOwedHour(world)) {
    const width = owed[0].end - owed[0].start;

    return owed[0].start + HOUR_MS + Math.floor(random() * (width - 2 * HOUR_MS));
  }

  if (world.place === 'after the last owed day, behind full pages') {
    return owed[owed.length - 1].end;
  }

  if (hasDenseWindowHour(world)) {
    return awayHourStartOf(random, owed);
  }

  return owed[0].end;
};

/**
 * In a wide owed range, records on both sides of the failing day: next to the ground a failing
 * page keeps owed (a day and an hour clear of it) and anywhere further out, so the owed pass and
 * the re-scan have records of the range to import around the day.
 */
const rangeServedOf = (
  kind: WorldKind,
  world: World,
  input: { owed: Span[]; failing: Span[] },
  random: () => number,
): Served[] => {
  if (!isWide(world)) {
    return [];
  }

  const [range] = input.owed;
  const [day] = input.failing;
  const clear = lostMarginOf(world) + HOUR_MS;
  const between = (from: number, to: number): number[] =>
    to > from ? [from + Math.floor(random() * (to - from))] : [];
  const times = [
    ...between(range.start, day.start - clear),
    ...between(day.start - clear - 3 * DAY_MS, day.start - clear),
    ...between(day.end + clear, day.end + clear + 3 * DAY_MS),
    ...between(day.end + clear, range.end),
  ].filter((time) => time >= range.start && time <= range.end);

  return times.map((createTime, index) => {
    const type: FiatTransactionType = index % 2 === 0 ? '0' : '1';

    return {
      servedFromRun: 0,
      type,
      record: kind.recordOf({ orderNo: `range-${index}`, createTime, type }),
    };
  });
};

/**
 * In a world behind full pages, more rows of each type than a page holds, written in one hour: a
 * span that holds the hour holds more than one page of each type, so a read of it (or of a piece
 * of it) comes back full and halves.
 */
const fullPagesServedOf = (
  kind: WorldKind,
  world: World,
  owed: Span[],
  random: () => number,
): Served[] => {
  if (!isDense(world)) {
    return [];
  }

  const hourStart = denseHourStartOf(random, world, owed);

  return Array.from({ length: 2 * (kind.pageRows + 1) }, (_unused, index) => {
    const type: FiatTransactionType = index % 2 === 0 ? '0' : '1';
    const createTime =
      hourStart + 1 + Math.floor(((index + 1) * (HOUR_MS - 2)) / (2 * kind.pageRows + 3));

    return {
      servedFromRun: 0,
      type,
      record: kind.recordOf({ orderNo: `full-${index}`, createTime, type }),
    };
  });
};

const KINDS: BoundedKind[] = [ORDERS_KIND, PAYMENTS_KIND];

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

      it.each(casesOf(kind, world))('$title', async ({ seed }) => {
        const random = seededRandom(seed);
        const generated = servedWorldOf(random, clock, kind);
        const owed = owedRangesOf(random, world);
        const failing = failingOf(random, world, owed);
        const served = [
          ...generated,
          ...fullPagesServedOf(kind, world, owed, random),
          ...rangeServedOf(kind, world, { owed, failing }, random),
        ];
        const runs = runsOf(world, kind, owed, clock);
        const importRuns = isWide(world)
          ? wideImportRunsOf(kind, owed)
          : kind.importRunsOf(
              zonesInWindowOf(owed, clock, runs),
              halvingReadsOf(world),
              mergesOwedRanges(world, clock),
            );
        const fake = walkStateFake({ accountId: ACCOUNT_ID, alongside: kind.holdings });
        const offers: Offer[] = [];
        let run = 0;

        fake.seed(kind.walkId, { cursor: cursorOf(world), pending: owed });

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
          const touchesFailing = failing.some(
            (range) => span.start <= range.end && span.end >= range.start,
          );

          if (stuck === 'drift' && touchesFailing) {
            return fiatPageOf<AnyRecord>([], { total: 5 });
          }

          if (stuck === 'throw' && touchesFailing) {
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

        for (run = 0; run < runs; run += 1) {
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
        // A server that fails every read touching a failing day serves no record inside it, nor
        // inside the day a failed span is halved to on each side of it in a wide owed range.
        const margin = lostMarginOf(world);
        const isReadable = ({ record }: Served): boolean =>
          stuck === 'none' ||
          stuck === 'tooOld' ||
          !failing.some(
            (range) =>
              record.createTime >= range.start - margin && record.createTime <= range.end + margin,
          );
        // Only the re-scan reads a record outside the owed ground, and its window reaches back
        // `FIAT_WINDOW_MS` from the clock of a run, so a clock that moves a day a run takes the
        // window past a record that is old enough: such a run does not count towards its bound.
        const isOwedGround = ({ record }: Served): boolean =>
          owed.some((range) => record.createTime >= range.start && record.createTime <= range.end);
        const dueRunOf = (item: Served): number | undefined =>
          Array.from(
            { length: runs - item.servedFromRun },
            (_unused, offset) => item.servedFromRun + offset,
          )
            .filter(
              (reachable) =>
                item.record.createTime <= clock.at(reachable) &&
                (isOwedGround(item) ||
                  item.record.createTime >= clock.at(reachable) - FIAT_WINDOW_MS),
            )
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
      });
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
