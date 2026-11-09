import { match, P } from 'ts-pattern';
import {
  AMOUNT_STOP_CODES,
  BinanceWalkStop,
  commitExchangeSpan,
  joinSettled,
  type OwedWindow,
  rowMinorUnits,
  type SettledSpan,
  settleRecords,
  type SpanCommit,
  type SpanRead,
  type WalkPass,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';
import { isAssetTicker, untrackedAssetCode } from '@kiko/transactions/untracked-counterpart';

import {
  BYBIT_PAGE_DRIFT,
  type BybitRowWalkDeps,
  type BybitWalkContext,
  byTimeThenKey,
  defaultBybitRowWalkDeps,
  driftOf,
  flooredStart,
  placeBybitWindowRows,
  runBybitWalk,
  taggedWith,
} from './bybit.walk-run';
import {
  type DenseMark,
  type DenseSpanRecords,
  denseMarkOf,
  readDenseSpan,
} from './bybit.dense-read';
import { holdingKeyOf } from './bybit.holding-keys';
import type { BybitLogKind } from './bybit.log-types';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BYBIT_RESCAN_WINDOWS_MS } from './bybit.rescan-window';
import { fetchLogPage, timeOfItem } from './bybit.history-client';
import { BYBIT_LANE_CALL_CAPS, type BybitHistoryRun } from './bybit.history-budget';

/**
 * The one series of this walk. It is named so that a row that cannot be trusted, which owes its
 * whole span, owes it as a range in this series: the forward pass goes past a range tagged with a
 * series, and the walk's cursor moves on.
 */
const LOG_SERIES = 'log';

/** The log route refuses a window past 7 days, so the walk asks for a second less. */
const WINDOW_MS = BYBIT_RESCAN_WINDOWS_MS.log;

/** A window costs one call at least, and the lane spends its calls on windows and pages. */
const MAX_WINDOWS = BYBIT_LANE_CALL_CAPS.log;

/**
 * The forward pass's split. Bybit compares the window at the second, so a span of a second or less
 * is not split again there: a smaller one holds no fewer rows. One that a full lane does not hold
 * is too dense to read.
 */
const LOG_MIN_SPLIT_MS = 1_000;

/**
 * The split of every other read. It covers ground behind the forward cursor, which held the lane
 * until it read that ground whole in spans of at most a lane's rows, so a split to the millisecond
 * reaches a span that fits. Only over a lane's rows inside one millisecond that came after the
 * forward read stops it.
 */
const LOG_REREAD_MIN_SPLIT_MS = 1;

const LOG_ROW_UNREADABLE = 'log-row-unreadable';

const LOG_TIME_MISSING = 'log-time-missing';

const LOG_SPOT_CHECK_FAILED = 'log-spot-check-failed';

const LOG_TRADE_ID_MISSING = 'log-trade-id-missing';

const LOG_COIN_PAIR_UNREADABLE = 'log-coin-pair-unreadable';

const LOG_KEY_CONFLICT = 'log-key-conflict';

const LOG_HOLDING_MISSING = 'log-holding-missing';

/**
 * The stops that owe the whole span as one range. A failed shape is met again by every run that
 * reads the span, and one range per span stays bounded where a point per row would grow with the
 * rows.
 */
const LOG_RANGE_STOPS: readonly string[] = [
  LOG_ROW_UNREADABLE,
  LOG_TIME_MISSING,
  LOG_SPOT_CHECK_FAILED,
  LOG_TRADE_ID_MISSING,
  LOG_COIN_PAIR_UNREADABLE,
];

/**
 * The stops the forward pass owes and goes past: the span stays owed in its series, or the row at
 * its own point, until a read settles it or the floor drops it, and holding the cursor behind it
 * would keep every newer trade from importing. A holding that cannot be found is no one row's stop
 * and is not in this list.
 */
const LOG_FORWARD_OWES: readonly string[] = [
  ...LOG_RANGE_STOPS,
  LOG_KEY_CONFLICT,
  BYBIT_PAGE_DRIFT,
  ...AMOUNT_STOP_CODES,
];

/** Only a plain decimal can be added exactly: `addDecimal` reads an empty text as zero. */
const DECIMAL_TEXT = /^-?[0-9]+(\.[0-9]+)?$/;

type LogItem = Awaited<ReturnType<typeof fetchLogPage>>['rows'][number];

type LogRow = Extract<LogItem, { kind: 'row' }>['row'];

type SpotRow = Extract<LogRow, { logKind: 'spotTrade' }>;

type Counterpart = { kind: 'tracked'; coin: Currency } | { kind: 'untracked'; marker: string };

/** What one item of a page is to this walk, decided once so every step reads the same answer. */
type Reading =
  | { kind: 'counted' }
  | { kind: 'entry'; logKind: BybitLogKind }
  | { kind: 'range'; code: string }
  | {
      kind: 'trade';
      row: SpotRow;
      coin: Currency;
      time: WalkWindow;
      key: string;
      counterpart: Counterpart;
    };

/**
 * A leg mapped from a spot row, before its wallets are turned into holdings: `wallet` is the key of
 * the coin's holding, `counterpartWallet` the other coin's. A leg against an untracked coin has
 * `untrackedCounterpart` instead of a counterpart and a pair id.
 */
type PlannedLogRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: '';
  operation: 'trade';
};

type CounterpartFields = Pick<
  PlannedLogRow,
  'counterpartWallet' | 'exchangePairId' | 'untrackedCounterpart'
>;

/**
 * The imported-transaction shape the walk hands to `transactionsRepo.addManyDedup`: the leg, the
 * holding it sits on and, for a tracked other coin, that coin's, with the order's pair id.
 */
type BybitLogRow = Omit<PlannedLogRow, 'wallet' | 'counterpartWallet'> & {
  holdingId: string;
  source: 'bybit';
  exchangeCounterpartHoldingId?: string;
};

type BybitLogHistoryDeps = BybitRowWalkDeps<BybitLogRow> & {
  fetchLogPage: typeof fetchLogPage;
};

const defaultBybitLogHistoryDeps: BybitLogHistoryDeps = {
  ...defaultBybitRowWalkDeps,
  fetchLogPage,
};

type LogContext = BybitWalkContext<BybitLogHistoryDeps>;

const range = (code: string): Reading => ({ kind: 'range', code });

/**
 * Bybit sends a spot fill's amounts so that `change + fee = qty`, with an empty `fee` as 0. A row
 * that does not add up is another shape of row, and its `change` is no leg.
 */
const addsUp = ({ qty, fee, change }: SpotRow): boolean => {
  const feeText = fee === '' ? '0' : fee;

  return (
    [qty, feeText, change].every((text) => DECIMAL_TEXT.test(text)) &&
    compareDecimal(addDecimal(change, feeText), qty) === 0
  );
};

/**
 * The other coin of a pair: the symbol without the row's coin, which is a prefix or a suffix of it.
 * A symbol that holds the coin at both ends, or at neither, names no other coin.
 */
const counterpartOf = (symbol: string, currency: string): Counterpart | undefined => {
  const others = [
    symbol.startsWith(currency) ? symbol.slice(currency.length) : '',
    symbol.endsWith(currency) ? symbol.slice(0, symbol.length - currency.length) : '',
  ].filter((other) => other !== '');
  const [other] = others;

  if (others.length !== 1 || other === undefined || !isAssetTicker(other)) {
    return undefined;
  }

  if (isTrackedBybitAsset(other)) {
    return { kind: 'tracked', coin: other };
  }

  return foldMap(
    maybe(untrackedAssetCode(other)),
    (marker): Counterpart => ({ kind: 'untracked', marker }),
  );
};

const tradeReadingOf = (accountId: string, row: SpotRow): Reading => {
  const { time, currency } = row;

  if (time === undefined) {
    return range(LOG_TIME_MISSING);
  }

  if (!isTrackedBybitAsset(currency)) {
    return range(LOG_ROW_UNREADABLE);
  }

  if (!addsUp(row)) {
    return range(LOG_SPOT_CHECK_FAILED);
  }

  if (!row.hasTradeId) {
    return range(LOG_TRADE_ID_MISSING);
  }

  const counterpart = counterpartOf(row.symbol, currency);

  if (counterpart === undefined) {
    return range(LOG_COIN_PAIR_UNREADABLE);
  }

  return {
    kind: 'trade',
    row,
    coin: currency,
    time,
    key: `${accountId}:log:${row.id}:TRADE:${time.start}:${currency}`,
    counterpart,
  };
};

const readingOf = (accountId: string, item: LogItem): Reading =>
  match(item)
    .returnType<Reading>()
    .with({ kind: 'unreadable' }, () => range(LOG_ROW_UNREADABLE))
    .with({ kind: 'untracked' }, () => ({ kind: 'counted' }))
    .with({ kind: 'row', row: { logKind: 'spotTrade' } }, ({ row }) =>
      tradeReadingOf(accountId, row),
    )
    .with({ kind: 'row' }, ({ row }) => ({ kind: 'entry', logKind: row.logKind }))
    .exhaustive();

/**
 * The keys that rows of one span give with two values of `change`: the page's "unique id" is not
 * one (its own sample repeats an id), so a key with two values is a read the walk cannot trust, and
 * both rows owe their point. Two rows with the same value are one row read twice.
 */
const conflictedKeysOf = (readings: readonly Reading[]): Set<string> => {
  const changesByKey = readings.reduce((byKey, reading) => {
    if (reading.kind !== 'trade') {
      return byKey;
    }

    const seen = byKey.get(reading.key) ?? [];

    return byKey.set(
      reading.key,
      seen.some((change) => compareDecimal(change, reading.row.change) === 0)
        ? seen
        : [...seen, reading.row.change],
    );
  }, new Map<string, string[]>());

  return new Set([...changesByKey].filter(([, changes]) => changes.length > 1).map(([key]) => key));
};

/**
 * The leg of one spot row: the row's own `change`, fee inside, rounded to the coin's units. A leg
 * that rounds to nothing writes no row, and the other leg of the trade is its own row and stays.
 */
const legsOf = (
  accountId: string,
  reading: Reading,
  conflicted: ReadonlySet<string>,
): PlannedLogRow[] => {
  if (reading.kind === 'range') {
    throw new BinanceWalkStop(reading.code);
  }

  if (reading.kind !== 'trade') {
    return [];
  }

  const { row, coin, time, key, counterpart } = reading;

  if (conflicted.has(key)) {
    throw new BinanceWalkStop(LOG_KEY_CONFLICT);
  }

  const units = rowMinorUnits(coin, row.change, 'rounded-row');

  if (units === 0) {
    return [];
  }

  return [
    {
      wallet: holdingKeyOf(coin, 'unified'),
      amountMinorUnits: units,
      time: time.start,
      externalId: key,
      description: '',
      operation: 'trade',
      ...match(counterpart)
        .returnType<CounterpartFields>()
        .with({ kind: 'tracked' }, (tracked) => ({
          counterpartWallet: holdingKeyOf(tracked.coin, 'unified'),
          exchangePairId: `${accountId}:trade:${row.orderId}:${row.symbol}`,
        }))
        .with({ kind: 'untracked' }, ({ marker }) => ({ untrackedCounterpart: marker }))
        .exhaustive(),
    },
  ];
};

/**
 * Where the rows of a span may sit before a page counts as drifted, and the ground a read of the
 * span returns rows from. Bybit compares the window at the second, so a row just before the span's
 * start can be in it.
 */
const reachOf = (span: WalkWindow): WalkWindow => ({ start: flooredStart(span), end: span.end });

type SpanRecords = DenseSpanRecords<LogItem>;

/** The log lane's read of one span, with the dense mark of the walk (`readDenseSpan`). */
const readSpan = (
  context: LogContext,
  span: WalkWindow,
  keep: number,
  window: OwedWindow,
  dense: { mark: DenseMark['mark']; isFirstForwardRead: boolean },
): Promise<SpanRead<SpanRecords> | undefined> => {
  const { deps, apiKey, secret, options } = context;

  return readDenseSpan({
    context,
    lane: 'log',
    span,
    keep,
    window,
    minSplitMs: { forward: LOG_MIN_SPLIT_MS, reread: LOG_REREAD_MIN_SPLIT_MS },
    readPage: (cursor) => deps.fetchLogPage(apiKey, secret, { span, cursor }, options),
    reachOf,
    dense,
  });
};

const sortKeyOf = (reading: Reading): string =>
  match(reading)
    .returnType<string>()
    .with({ kind: 'trade' }, ({ key }) => key)
    .otherwise(() => '');

/**
 * The rows of a span, each on its own (see `settleRecords`). A row the walk cannot trust owes the
 * whole span, tagged with the series, so the forward pass goes past it and the range is read again
 * by every run: it has no extent, so it gives no point. A row whose key has two values, or whose
 * amount the parser refuses, owes its own point. The other rows of the span still import.
 */
const settledSpanOf = (
  accountId: string,
  span: WalkWindow,
  { items, drifted }: SpanRecords,
): SettledSpan<PlannedLogRow> => {
  const readings = new Map(items.map((item) => [item, readingOf(accountId, item)] as const));
  const reading = (item: LogItem): Reading => readings.get(item) ?? { kind: 'counted' };
  const conflicted = conflictedKeysOf([...readings.values()]);
  const settled = settleRecords<LogItem, PlannedLogRow>({
    span,
    reach: reachOf(span),
    records: [...items].sort(
      byTimeThenKey<LogItem>(timeOfItem, (item) => sortKeyOf(reading(item))),
    ),
    rowsOf: (item) => legsOf(accountId, reading(item), conflicted),
    extentOf: (item) =>
      match(reading(item))
        .returnType<WalkWindow | undefined>()
        .with({ kind: 'range' }, () => undefined)
        .otherwise(() => timeOfItem(item)),
    seriesOf: () => LOG_SERIES,
    untrackedOf: (item) =>
      match(item)
        .returnType<string | undefined>()
        .with({ kind: 'untracked' }, ({ ticker }) => ticker)
        .otherwise(() => undefined),
  });

  return joinSettled<PlannedLogRow>([
    driftOf(span, drifted ? [LOG_SERIES] : []),
    { ...settled, owed: taggedWith(LOG_SERIES, settled.owed) },
  ]);
};

/**
 * The kinds of entry a span met that the log leaves out, by name. The transfer series reads the
 * moves of `coveredElsewhere`, so the log stays silent about it.
 */
const leftOutKindsOf = (accountId: string, items: readonly LogItem[]): BybitLogKind[] => [
  ...new Set(
    items.flatMap((item) =>
      match(readingOf(accountId, item))
        .returnType<BybitLogKind[]>()
        .with({ kind: 'entry', logKind: P.not('coveredElsewhere') }, ({ logKind }) => [logKind])
        .otherwise(() => []),
    ),
  ),
];

/**
 * Commit one span: name the kinds it left out and drop the dense mark it passed, then place and
 * write the legs of the rows the walk can trust, then move the walk's marks (see
 * `commitSettledSpan`: rows first, marks second, so a crash between the two re-imports
 * idempotently). The mark goes before the cursor moves: a crash between the two reads the span
 * again and writes the mark again, where a mark kept past its cursor would show for good.
 */
const commitSpan = async (
  context: LogContext,
  window: OwedWindow,
  span: WalkWindow,
  records: SpanRecords,
  pass: WalkPass,
  dense: DenseMark,
): Promise<SpanCommit | undefined> => {
  const kinds = leftOutKindsOf(context.accountId, records.items);

  if (kinds.length > 0) {
    await context.deps.patchExchangeState(context.accountId, [{ kind: 'logKinds', kinds }]);
  }

  await dense.dropPast(context, span.end);

  return commitExchangeSpan<PlannedLogRow, BybitLogRow>({
    context,
    pass,
    span,
    settled: settledSpanOf(context.accountId, span, records),
    place: (planned) => placeBybitWindowRows(context, planned, LOG_HOLDING_MISSING),
    restartMs: BYBIT_RESTART_FLOOR_MS,
    series: window.series,
    forwardOwes: LOG_FORWARD_OWES,
  });
};

/**
 * Import the spot trades of the Unified account's transaction log as one leg per log row,
 * idempotently, committing a span's legs before the walk's marks move past it. A run goes forward
 * from the cursor first, then reads the ground earlier runs left owed, then re-scans the last
 * window behind the cursor, then the owed points, each on what the lane has left (see
 * `planWalkPasses`). Missing credentials give a no-op, and so does an active cooldown.
 * `complete: false` means history, owed ground or the re-scan remains; a failure other than a rate
 * limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBybitLogHistory = (
  request: { targetAccountId: string; run: BybitHistoryRun },
  overrides: Partial<BybitLogHistoryDeps> = {},
): Promise<WalkResult> => {
  const dense = denseMarkOf(LOG_SERIES);

  return runBybitWalk({
    deps: { ...defaultBybitLogHistoryDeps, ...overrides },
    accountId: request.targetAccountId,
    run: request.run,
    walkId: 'log',
    lane: 'log',
    series: [LOG_SERIES],
    windowMs: WINDOW_MS,
    maxWindows: MAX_WINDOWS,
    callsOf: () => 1,
    read: (context, window, span, keep) =>
      readSpan(context, span, keep, window, {
        mark: dense.mark,
        isFirstForwardRead: dense.isFirstForwardRead(context, window),
      }),
    commit: (context, window, span, records, pass) =>
      commitSpan(context, window, span, records, pass, dense),
  });
};
