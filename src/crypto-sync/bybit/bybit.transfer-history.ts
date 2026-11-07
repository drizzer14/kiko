import { DAY_MS } from '@kiko/dates';
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

import {
  BYBIT_PAGE_DRIFT,
  type BybitRowWalkDeps,
  type BybitWalkContext,
  byTimeThenKey,
  defaultBybitRowWalkDeps,
  driftOf,
  flooredStart,
  placeBybitWindowRows,
  readUnderCooldown,
  runBybitWalk,
  taggedWith,
} from './bybit.walk-run';
import { readCursorSpan } from './bybit.cursor-span';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { BYBIT_RESTART_FLOOR_MS } from './bybit.restart-floor';
import { BYBIT_RESCAN_WINDOWS_MS } from './bybit.rescan-window';
import { fetchTransferPage, timeOfItem } from './bybit.history-client';
import { BYBIT_LANE_CALL_CAPS, type BybitHistoryRun } from './bybit.history-budget';
import { type BybitWallet, exchangePairIdOf, holdingKeyOf } from './bybit.holding-keys';

/**
 * The one series of this walk. It is named so that a record with no time, which owes its whole
 * span, owes it as a range in this series: the forward pass goes past a range tagged with a
 * series, and the walk's cursor moves on.
 */
const TRANSFER_SERIES = 'transfer';

/** The transfer route answers a window of at most 7 days and refuses one second more. */
const WINDOW_MS = BYBIT_RESCAN_WINDOWS_MS.transfer;

/** A window costs one call, and the lane spends its calls on windows. */
const MAX_WINDOWS = BYBIT_LANE_CALL_CAPS.transfer;

const TRANSFER_SETTLED = 'SUCCESS';

const TRANSFER_FAILED = 'FAILED';

const TRANSFER_ROW_UNREADABLE = 'transfer-row-unreadable';

const TRANSFER_NOT_SETTLED = 'transfer-not-settled';

const TRANSFER_WALLET_UNKNOWN = 'bybit-transfer-wallet-unknown';

const TRANSFER_AMOUNT_INVALID = 'transfer-amount-invalid';

const TRANSFER_TIME_MISSING = 'transfer-time-missing';

const TRANSFER_HOLDING_MISSING = 'transfer-holding-missing';

/**
 * The stops of one transfer that the forward pass owes and goes past: the transfer stays owed at
 * its own point, or its span stays owed in its series, until a read settles it or the floor drops
 * it, and holding the cursor behind it would keep every newer transfer from importing. A page that
 * drifted is owed as the span in this series, so it is in this list too. A holding that cannot be
 * found is no one transfer's stop and is not in this list.
 */
const TRANSFER_FORWARD_OWES: readonly string[] = [
  TRANSFER_ROW_UNREADABLE,
  TRANSFER_NOT_SETTLED,
  TRANSFER_WALLET_UNKNOWN,
  TRANSFER_AMOUNT_INVALID,
  TRANSFER_TIME_MISSING,
  BYBIT_PAGE_DRIFT,
  ...AMOUNT_STOP_CODES,
];

type TransferItem = Awaited<ReturnType<typeof fetchTransferPage>>['rows'][number];

type TransferRow = Extract<TransferItem, { kind: 'row' }>['row'];

/**
 * A leg mapped from a transfer, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's holding it sits on, `counterpartWallet` the other leg's.
 */
type PlannedTransferRow = {
  wallet: string;
  counterpartWallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId: string;
  description: string;
};

/**
 * The imported-transaction shape the walk hands to `transactionsRepo.addManyDedup`: the leg, the
 * holding it sits on and its other leg's, and the id the two legs share.
 */
type BybitTransferRow = Omit<PlannedTransferRow, 'wallet' | 'counterpartWallet'> & {
  holdingId: string;
  source: 'bybit';
  exchangeCounterpartHoldingId?: string;
};

type BybitTransferHistoryDeps = BybitRowWalkDeps<BybitTransferRow> & {
  fetchTransferPage: typeof fetchTransferPage;
};

const defaultBybitTransferHistoryDeps: BybitTransferHistoryDeps = {
  ...defaultBybitRowWalkDeps,
  fetchTransferPage,
};

type TransferContext = BybitWalkContext<BybitTransferHistoryDeps>;

/**
 * The wallet a word of the page names. The enum page holds UNIFIED and FUND, and the page's own
 * sample shows SPOT, so any other word names no wallet Kiko tracks: the transfer is owed, and no
 * wallet is guessed from it.
 */
const walletOf = (word: string): BybitWallet | undefined =>
  match(word)
    .returnType<BybitWallet | undefined>()
    .with('UNIFIED', () => 'unified')
    .with('FUND', () => 'fund')
    .otherwise(() => undefined);

/**
 * The two legs of one settled transfer of a tracked coin, each on the coin's own wallet holding:
 * the debit on the source, then the credit on the destination, under one pair id and one key for
 * each (the pair id and the leg's holding key). A transfer that failed is final and gives none, and
 * so does a settled one that moves no money between the holdings Kiko keeps (the same wallet at
 * both ends, an amount of zero): no leg, and nothing owed. A transfer the walk cannot trust (not
 * settled, a wallet it does not track, a coin it cannot read, a negative or inexact amount, no time
 * to date the legs by) stops that transfer alone, and a skipped one would be silent loss.
 */
const legsOf = (accountId: string, row: TransferRow): PlannedTransferRow[] => {
  const { coin, transferId, amount, time } = row;

  if (row.status === TRANSFER_FAILED) {
    return [];
  }

  if (row.status !== TRANSFER_SETTLED) {
    throw new BinanceWalkStop(TRANSFER_NOT_SETTLED);
  }

  const source = walletOf(row.fromAccountType);
  const destination = walletOf(row.toAccountType);

  if (source === undefined || destination === undefined) {
    throw new BinanceWalkStop(TRANSFER_WALLET_UNKNOWN);
  }

  if (!isTrackedBybitAsset(coin)) {
    throw new BinanceWalkStop(TRANSFER_ROW_UNREADABLE);
  }

  if (source === destination) {
    return [];
  }

  const units = rowMinorUnits(coin, amount);

  if (units === 0) {
    return [];
  }

  if (units < 0) {
    throw new BinanceWalkStop(TRANSFER_AMOUNT_INVALID);
  }

  if (time === undefined) {
    throw new BinanceWalkStop(TRANSFER_TIME_MISSING);
  }

  const exchangePairId = exchangePairIdOf(`${accountId}:xfer:${transferId}`, coin);
  const legOf = (wallet: BybitWallet, counterpart: BybitWallet, signedUnits: number) => ({
    wallet: holdingKeyOf(coin, wallet),
    counterpartWallet: holdingKeyOf(coin, counterpart),
    amountMinorUnits: signedUnits,
    time: time.start,
    externalId: `${exchangePairId}:${holdingKeyOf(coin, wallet)}`,
    exchangePairId,
    description: '',
  });

  return [legOf(source, destination, -units), legOf(destination, source, units)];
};

const legsOfItem = (accountId: string, item: TransferItem): PlannedTransferRow[] =>
  match(item)
    .returnType<PlannedTransferRow[]>()
    .with({ kind: 'unreadable' }, () => {
      throw new BinanceWalkStop(TRANSFER_ROW_UNREADABLE);
    })
    .with({ kind: 'untracked' }, () => [])
    .with({ kind: 'row' }, ({ row }) => legsOf(accountId, row))
    .exhaustive();

/**
 * The ticker of an item of a coin the walk does not track, once its transfer is settled: the walk
 * counts it, imports no row for it and lists its ticker. A transfer not settled yet is counted and
 * not listed.
 */
const untrackedTickerOf = (item: TransferItem): string | undefined =>
  match(item)
    .returnType<string | undefined>()
    .with({ kind: 'untracked' }, ({ ticker, status }) =>
      status === TRANSFER_SETTLED ? ticker : undefined,
    )
    .otherwise(() => undefined);

const keyOf = (item: TransferItem): string =>
  match(item)
    .returnType<string>()
    .with({ kind: 'row' }, ({ row }) => row.transferId)
    .with({ kind: P.union('unreadable', 'untracked') }, () => '')
    .exhaustive();

/**
 * Where the transfers of a span may sit before a page counts as drifted, and the ground a read of
 * the span returns transfers from. Bybit compares the window at the second, so a transfer just
 * before the span's start can be in it.
 */
const reachOf = (span: WalkWindow): WalkWindow => ({ start: flooredStart(span), end: span.end });

type SpanRecords = { items: TransferItem[]; drifted: boolean };

/**
 * One span read, a page at a time, in the transfer lane. `undefined` is a clean stop (the budget
 * ran out, or Bybit rate-limited and the account cools). A page that drifted is no one transfer's
 * stop: it gives no item and the span is owed.
 */
const readSpan = (
  context: TransferContext,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SpanRecords> | undefined> =>
  readUnderCooldown(context, async () => {
    const { deps, apiKey, secret, options } = context;
    const read = await readCursorSpan<TransferItem>({
      run: context.run,
      lane: 'transfer',
      span,
      keep,
      minSplitMs: DAY_MS,
      readPage: (cursor) => deps.fetchTransferPage(apiKey, secret, { span, cursor }, options),
      timesOf: (item) => item.times,
      reachOf,
    });

    if (read === undefined || read.kind === 'split') {
      return read;
    }

    return {
      kind: 'page',
      page: match(read.page)
        .returnType<SpanRecords>()
        .with({ kind: 'drift' }, () => ({ items: [], drifted: true }))
        .with({ kind: 'rows' }, ({ rows }) => ({ items: rows, drifted: false }))
        .exhaustive(),
    };
  });

/**
 * The transfers of a span, each on its own (see `settleRecords`): one the walk cannot trust owes
 * its own point and the others still import. A transfer with no time to give a point owes the
 * whole span, tagged with the series, so the forward pass goes past it; the tagged range is read
 * again by every run. A page that drifted owes the span in the same way.
 */
const settledSpanOf = (
  context: TransferContext,
  span: WalkWindow,
  records: SpanRecords,
): SettledSpan<PlannedTransferRow> => {
  const settled = settleRecords<TransferItem, PlannedTransferRow>({
    span,
    reach: reachOf(span),
    records: [...records.items].sort(byTimeThenKey<TransferItem>(timeOfItem, keyOf)),
    rowsOf: (item) => legsOfItem(context.accountId, item),
    extentOf: timeOfItem,
    seriesOf: () => TRANSFER_SERIES,
    untrackedOf: untrackedTickerOf,
  });

  return joinSettled<PlannedTransferRow>([
    driftOf(span, records.drifted ? [TRANSFER_SERIES] : []),
    { ...settled, owed: taggedWith(TRANSFER_SERIES, settled.owed) },
  ]);
};

/**
 * Commit one span: place and write the legs of the transfers the walk can trust, then move the
 * walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * re-imports idempotently).
 */
const commitSpan = (
  context: TransferContext,
  window: OwedWindow,
  span: WalkWindow,
  records: SpanRecords,
  pass: WalkPass,
): Promise<SpanCommit | undefined> =>
  commitExchangeSpan<PlannedTransferRow, BybitTransferRow>({
    context,
    pass,
    span,
    settled: settledSpanOf(context, span, records),
    place: (planned) => placeBybitWindowRows(context, planned, TRANSFER_HOLDING_MISSING),
    restartMs: BYBIT_RESTART_FLOOR_MS,
    series: window.series,
    forwardOwes: TRANSFER_FORWARD_OWES,
  });

/**
 * Import the transfers between the Unified and Funding wallets of every tracked coin as two legs
 * under one pair id, idempotently, committing a span's legs before the walk's marks move past it.
 * A run goes forward from the cursor first, then reads the ground earlier runs left owed, then
 * re-scans the last window behind the cursor, then the owed points, each on what the lane has left
 * (see `planWalkPasses`). Missing credentials give a no-op, and so does an active cooldown.
 * `complete: false` means history, owed ground or the re-scan remains; a failure other than a rate
 * limit rejects, so the caller can log it without failing the balance sync.
 */
export const syncBybitTransferHistory = (
  request: { targetAccountId: string; run: BybitHistoryRun },
  overrides: Partial<BybitTransferHistoryDeps> = {},
): Promise<WalkResult> =>
  runBybitWalk({
    deps: { ...defaultBybitTransferHistoryDeps, ...overrides },
    accountId: request.targetAccountId,
    run: request.run,
    walkId: 'transfer',
    lane: 'transfer',
    series: [TRANSFER_SERIES],
    windowMs: WINDOW_MS,
    maxWindows: MAX_WINDOWS,
    callsOf: () => 1,
    read: (context, _window, span, keep) => readSpan(context, span, keep),
    commit: commitSpan,
  });
