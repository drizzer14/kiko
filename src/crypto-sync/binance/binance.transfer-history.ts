import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  AMOUNT_STOP_CODES,
  backfillGroundOf,
  BinanceWalkStop,
  createDepthMemories,
  type DepthGuard,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  instantAt,
  joinSettled,
  multiCoinPatchesOf,
  type OwedWindow,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  rowMinorUnits,
  type SettledSpan,
  settleRecords,
  settleUnreadable,
  type SpanCommit,
  type SpanRead,
  storePlannedList,
  walkMarkWriterOf,
  type WalkPass,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import {
  type UNTRACKED_WALLETS,
  untrackedWalletCode,
} from '@kiko/transactions/untracked-counterpart';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';
import { readSeriesSpan, type SeriesSpan } from '@kiko/crypto-sync/exchange/paging';

import {
  type BinanceWalkContext,
  commitBinanceSpan,
  runBinanceWalkPlan,
  walletPlacerOf,
} from './binance.walk-wiring';
import {
  type BinanceTransactionRow,
  HISTORY_FLOOR_MS,
  RESYNC_OVERLAP_MS,
} from './binance.transactions';
import {
  type BinanceUniversalTransfer,
  fetchUniversalTransfers,
  type TotalPage,
  TRANSFER_SETTLED_STATUS,
  UNIVERSAL_TRANSFER_TYPES,
  type UniversalTransferType,
} from './binance.history-client';
import { BINANCE_WALK_CONFIG } from './binance.walk-config';
import { BINANCE_DEPTH_CONFIG } from './binance.depth-config';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { BinanceHistoryTooOldError, type FetchAccountOptions } from './binance.client';
import { type BinanceWallet, exchangePairIdOf, holdingKeyOf } from './binance.holding-keys';

/** Binance does not document the widest range a transfer read takes; 30 days is the working cap. */
export const TRANSFER_WINDOW_MS = 30 * DAY_MS;

/**
 * Binance documents the last six months of transfer history. A `startTime` 180 days back is
 * served and one 200 days back is refused (HTTP 400, code -5026); what lies between is unknown,
 * so the walk asks for no more than 179 whole days.
 */
const TRANSFER_HISTORY_DAYS = 179;

/** Safety stop on the window walk: the 179 days are 6 windows. */
const MAX_WINDOWS = 12;

/** Safety stop on paging one type within a span of one millisecond (100 rows x 50 pages). */
const MAX_PAGES_PER_SPAN = 50;

/** The status Binance gives a transfer that did not go through, and never will. */
const TRANSFER_FAILED_STATUS = 'FAILED';

const TRANSFER_FAILED = 'transfer-failed';

const TRANSFER_TYPE_MISMATCH = 'transfer-type-mismatch';

const TRANSFER_NOT_SETTLED = 'transfer-not-settled';

const TRANSFER_ID_MISSING = 'transfer-id-missing';

const TRANSFER_AMOUNT_INVALID = 'transfer-amount-invalid';

const TRANSFER_PAGE_DRIFT = 'transfer-page-drift';

/** The stop of a row the client could not read: logged by its code alone, never its content. */
const TRANSFER_ROW_UNREADABLE = 'transfer-row-unreadable';

/**
 * The stops of one transfer that the forward pass owes and goes past: the transfer stays owed at
 * its own point until it settles or the floor drops it, so no later read of the span settles it
 * differently, and holding the cursor behind it would keep every newer transfer from importing.
 * It applies only to a transfer with a usable time, which owes a point (`commitSettledSpan`): a
 * row with no time owes the whole span, and a stop that is no one transfer's
 * (`transfer-page-drift`, `transfer-holding-missing`) is not in this list, so both hold the
 * cursor back.
 */
export const TRANSFER_FORWARD_OWES: readonly string[] = [
  TRANSFER_FAILED,
  TRANSFER_TYPE_MISMATCH,
  TRANSFER_NOT_SETTLED,
  TRANSFER_ID_MISSING,
  TRANSFER_AMOUNT_INVALID,
  TRANSFER_ROW_UNREADABLE,
  ...AMOUNT_STOP_CODES,
];

/**
 * The earliest `startTime` the walk asks transfer history for: 179 whole days back (see
 * `TRANSFER_HISTORY_DAYS`), so the request is never older than the history Binance was seen to
 * serve. Never before the shared history floor.
 */
export const transferFloorMs = (now: number): number =>
  Math.max(HISTORY_FLOOR_MS, now - TRANSFER_HISTORY_DAYS * DAY_MS);

type OwnWallet = 'MAIN' | 'FUNDING';

type UntrackedWallet = (typeof UNTRACKED_WALLETS)[number];

/**
 * The two ends of a transfer type: a move between the two wallets Kiko tracks, or between one of
 * them and a wallet it does not (`sign` is -1 when the tracked wallet is the source).
 */
type Endpoints =
  | { kind: 'paired'; source: OwnWallet; destination: OwnWallet }
  | { kind: 'untracked'; tracked: OwnWallet; other: UntrackedWallet; sign: 1 | -1 };

const sends = (tracked: OwnWallet, other: UntrackedWallet): Endpoints => ({
  kind: 'untracked',
  tracked,
  other,
  sign: -1,
});

const receives = (tracked: OwnWallet, other: UntrackedWallet): Endpoints => ({
  kind: 'untracked',
  tracked,
  other,
  sign: 1,
});

const TRANSFER_ENDPOINTS: Record<UniversalTransferType, Endpoints> = {
  MAIN_FUNDING: { kind: 'paired', source: 'MAIN', destination: 'FUNDING' },
  FUNDING_MAIN: { kind: 'paired', source: 'FUNDING', destination: 'MAIN' },
  MAIN_UMFUTURE: sends('MAIN', 'UMFUTURE'),
  UMFUTURE_MAIN: receives('MAIN', 'UMFUTURE'),
  MAIN_CMFUTURE: sends('MAIN', 'CMFUTURE'),
  CMFUTURE_MAIN: receives('MAIN', 'CMFUTURE'),
  MAIN_MARGIN: sends('MAIN', 'MARGIN'),
  MARGIN_MAIN: receives('MAIN', 'MARGIN'),
  MAIN_OPTION: sends('MAIN', 'OPTION'),
  OPTION_MAIN: receives('MAIN', 'OPTION'),
  MAIN_PORTFOLIO_MARGIN: sends('MAIN', 'PORTFOLIO_MARGIN'),
  PORTFOLIO_MARGIN_MAIN: receives('MAIN', 'PORTFOLIO_MARGIN'),
  FUNDING_UMFUTURE: sends('FUNDING', 'UMFUTURE'),
  UMFUTURE_FUNDING: receives('FUNDING', 'UMFUTURE'),
  FUNDING_CMFUTURE: sends('FUNDING', 'CMFUTURE'),
  CMFUTURE_FUNDING: receives('FUNDING', 'CMFUTURE'),
  FUNDING_MARGIN: sends('FUNDING', 'MARGIN'),
  MARGIN_FUNDING: receives('FUNDING', 'MARGIN'),
  FUNDING_OPTION: sends('FUNDING', 'OPTION'),
  OPTION_FUNDING: receives('FUNDING', 'OPTION'),
};

const WALLET_OF: Record<OwnWallet, BinanceWallet> = {
  MAIN: 'spot',
  FUNDING: 'funding',
};

/**
 * A row mapped from a transfer, before its wallets are turned into holdings: `wallet` is the key
 * of the coin's holding it sits on, `counterpartWallet` the other leg's of a move between the two
 * wallets Kiko tracks.
 */
type PlannedTransferRow = {
  wallet: string;
  counterpartWallet?: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
  description: string;
};

/**
 * The imported-transaction shape the transfer walk hands to `transactionsRepo.addManyDedup`: the
 * capital row plus the markers of a transfer, the other leg's holding (and the id the two legs
 * share) or the wallet Kiko does not track.
 */
export type BinanceHistoryRow = BinanceTransactionRow & {
  exchangeCounterpartHoldingId?: string;
  exchangePairId?: string;
  untrackedCounterpart?: string;
};

/**
 * The rows of one transfer of a tracked coin read under `readAs`: two legs for a move between the
 * two tracked wallets, one for a move to or from a wallet Kiko does not track, each on the coin's
 * own wallet holding. Each leg is keyed by the type, the transfer's own id and the holding, so a
 * `tranId` two types or two coins share never refreshes another row. A transfer the walk cannot
 * trust (not the type it was read under, not settled, no id, no positive amount) throws a
 * `BinanceWalkStop`: a skipped one would be silent loss. A transfer of a coin that is not tracked
 * never gets here: the client counts it without parsing it (`UntrackedTotalRow`).
 */
export const transferRowsOf = (
  accountId: string,
  record: BinanceUniversalTransfer,
  readAs: UniversalTransferType,
): PlannedTransferRow[] => {
  const { asset } = record;

  if (!isTrackedBinanceAsset(asset)) {
    throw new BinanceWalkStop(TRANSFER_ROW_UNREADABLE);
  }

  if (record.type !== readAs) {
    throw new BinanceWalkStop(TRANSFER_TYPE_MISMATCH);
  }

  if (record.status === TRANSFER_FAILED_STATUS) {
    throw new BinanceWalkStop(TRANSFER_FAILED);
  }

  if (record.status !== TRANSFER_SETTLED_STATUS) {
    throw new BinanceWalkStop(TRANSFER_NOT_SETTLED);
  }

  if (record.tranId === '') {
    throw new BinanceWalkStop(TRANSFER_ID_MISSING);
  }

  const units = rowMinorUnits(asset, record.amount);

  if (units <= 0) {
    throw new BinanceWalkStop(TRANSFER_AMOUNT_INVALID);
  }

  const transferId = `${accountId}:xfer:${readAs}:${record.tranId}`;
  const pairId = exchangePairIdOf(transferId, asset);
  const keyOf = (wallet: OwnWallet): string => holdingKeyOf(asset, WALLET_OF[wallet]);
  const legOf = (wallet: OwnWallet, signedUnits: number) => ({
    wallet: keyOf(wallet),
    amountMinorUnits: signedUnits,
    time: record.timestamp,
    externalId: `${transferId}:${keyOf(wallet)}`,
    description: '',
  });

  return match(TRANSFER_ENDPOINTS[readAs])
    .returnType<PlannedTransferRow[]>()
    .with({ kind: 'paired' }, ({ source, destination }) => [
      {
        ...legOf(source, -units),
        counterpartWallet: keyOf(destination),
        exchangePairId: pairId,
      },
      {
        ...legOf(destination, units),
        counterpartWallet: keyOf(source),
        exchangePairId: pairId,
      },
    ])
    .with({ kind: 'untracked' }, ({ tracked, other, sign }) => [
      {
        ...legOf(tracked, sign * units),
        untrackedCounterpart: untrackedWalletCode(other),
      },
    ])
    .exhaustive();
};

/**
 * The injectable seams of the Transfer walk: the credential and holding reads, the transfer read
 * (one page of one type of one range), the insert-only holding creation, the deduping import, and
 * the walk state read and write. Pacing and the weight budget come from the run.
 */
export type BinanceTransferHistoryDeps = ExchangeStateDeps & {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchUniversalTransfers: (
    apiKey: string,
    secret: string,
    query: { type: UniversalTransferType; startTime: number; endTime: number; current: number },
    options?: FetchAccountOptions,
  ) => Promise<TotalPage<BinanceUniversalTransfer>>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceHistoryRow[]) => Promise<number>;
};

const defaultTransferHistoryDeps: BinanceTransferHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchUniversalTransfers,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type TransferContext = BinanceWalkContext<BinanceTransferHistoryDeps> & {
  depthMemories: Pick<DepthGuard, 'config' | 'memoryOf' | 'hintMs' | 'refusedBoundMs'>;
};

/** The types a window is read in: every one, or the ones its owed points name. */
const typesOf = (window: OwedWindow): readonly UniversalTransferType[] =>
  window.series === undefined
    ? UNIVERSAL_TRANSFER_TYPES
    : UNIVERSAL_TRANSFER_TYPES.filter((type) => window.series?.includes(type));

/** The calls one read of a window costs: one for each type it asks. */
const callsOf = (window: OwedWindow): number => typesOf(window).length;

/**
 * One span read in every type of `window`. A type whose first page is full with more rows behind
 * it halves the span (every type is read again in the half). `undefined` is a clean stop: the
 * budget cannot afford every type, or Binance rate-limited (which also sets the account's
 * cooldown). `keep` calls stay unspent for the passes that come later in the run.
 *
 * A start Binance refuses as older than it keeps (-5026) is not read as empty: the clock moves on
 * after a run is planned, so the span may still hold ground Binance keeps. The floor of now says
 * whether the span lies below it (nothing to ask); otherwise each type is read from the oldest
 * start Binance serves it (see `readSeriesSpan`; the types keep a depth of their own), and only
 * the ground it refuses is read as empty.
 */
const readSpan = async (
  context: TransferContext,
  window: OwedWindow,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<SeriesSpan<UniversalTransferType, BinanceUniversalTransfer>> | undefined> => {
  const { deps, run, accountId, apiKey, secret, options } = context;

  return readSeriesSpan({
    run,
    config: BINANCE_WALK_CONFIG,
    lane: 'transfer',
    cost: COSTS.transfer,
    span,
    keep,
    series: typesOf(window),
    maxPages: MAX_PAGES_PER_SPAN,
    fetchPage: (type, read, current) =>
      deps.fetchUniversalTransfers(
        apiKey,
        secret,
        { type, startTime: read.start, endTime: read.end, current },
        options,
      ),
    onRateLimit: (error) => setBinanceCooldownUntil(accountId, deps.now() + error.retryAfterMs),
    depth: {
      isRefusal: (error) => error instanceof BinanceHistoryTooOldError,
      nowMs: deps.now,
      floorMs: () => transferFloorMs(deps.now()),
      ...context.depthMemories,
    },
  });
};

/**
 * The records of one span, each on its own (see `settleRecords`): a transfer the walk cannot
 * trust, or a row the client could not read, owes its own point in the type it was read under
 * and the others still import. A type whose pages drifted is no one record's stop: the span is
 * owed, as a range, in that type alone, and the types that did not drift still commit. The ground
 * a type left owed in itself (the edge band its read began above, when Binance refused it, or the
 * whole span for a type whose read stopped) is owed as a range in that type alone, and holds
 * nothing back. A transfer of a coin that is not tracked is counted by its point and gives no row
 * and no stop; its coin is listed once the transfer is settled.
 */
export const settledTransfersOf = (input: {
  accountId: string;
  span: WalkWindow;
  read: SeriesSpan<UniversalTransferType, BinanceUniversalTransfer>;
}): SettledSpan<PlannedTransferRow> => {
  const { accountId, span, read } = input;
  const drift: SettledSpan<PlannedTransferRow> = {
    rows: [],
    codes: [TRANSFER_PAGE_DRIFT],
    owed: read.drifted.map((series) => ({ ...span, series })),
    returned: [],
  };

  const unread: SettledSpan<PlannedTransferRow> = {
    rows: [],
    codes: [],
    owed: (read.owed ?? []).map(({ series, window }) => ({ ...window, series })),
    returned: [],
  };

  return joinSettled<PlannedTransferRow>([
    unread,
    ...(read.drifted.length > 0 ? [drift] : []),
    settleRecords({
      span,
      records: read.read.flatMap(({ series, rows }) => rows.map((row) => ({ type: series, row }))),
      rowsOf: ({ type, row }) => transferRowsOf(accountId, row, type),
      extentOf: ({ row }) => instantAt(row.timestamp),
      seriesOf: ({ type }) => type,
    }),
    settleRecords({
      span,
      records: read.read.flatMap(({ series, untracked }) =>
        untracked.map((row) => ({ type: series, row })),
      ),
      rowsOf: () => [],
      extentOf: ({ row }) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
      seriesOf: ({ type }) => type,
      untrackedOf: ({ row }) => (row.status === TRANSFER_SETTLED_STATUS ? row.ticker : undefined),
    }),
    settleUnreadable({
      span,
      unreadable: read.read.flatMap(({ series, unreadable }) =>
        unreadable.map((row) => ({ ...row, type: series })),
      ),
      code: TRANSFER_ROW_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
      seriesOf: (row) => row.type,
    }),
  ]);
};

/**
 * Commit one span's read: place and write the rows of the transfers the walk can trust, then move
 * the walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the two
 * just re-imports idempotently, and a transfer the walk cannot trust stays owed at its own point
 * or stops the forward pass). One row per key: a transfer on the boundary of two spans is read
 * twice.
 */
const commitSpan = (
  context: TransferContext,
  window: OwedWindow,
  span: WalkWindow,
  read: SeriesSpan<UniversalTransferType, BinanceUniversalTransfer>,
  pass: WalkPass,
): Promise<SpanCommit | undefined> =>
  commitBinanceSpan({
    context,
    pass,
    span,
    settled: settledTransfersOf({ accountId: context.accountId, span, read }),
    forwardOwes: TRANSFER_FORWARD_OWES,
    place: walletPlacerOf(context, 'transfer-holding-missing'),
    restartMs: HISTORY_FLOOR_MS,
    series: window.series,
    scope: window.scope,
  });

const runSync = async (
  deps: BinanceTransferHistoryDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  const now = deps.now();

  if (isBinanceCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, 'transfer');

  const { cursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, 'transfer');
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const floorMs = transferFloorMs(now);
  const { pending, stored: converted } = await backfillGroundOf({
    stored,
    pending: await readPendingMark({
      stored: stored.pending,
      owedIfUnreadable: { start: floorMs, end: cursor ?? floorMs },
      knownSeries: UNIVERSAL_TRANSFER_TYPES,
      write,
    }),
    floorMs,
    write,
  });
  const plan = planWalkPasses({
    cursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    backfillCursor: roundRobins.backfillCursor,
    pending,
    floorMs,
    endTime: now,
    windowMs: TRANSFER_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: MAX_WINDOWS,
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
    return { imported: 0, complete: false };
  }

  const context: TransferContext = {
    deps,
    run,
    accountId,
    apiKey: credentials.apiKey,
    secret: credentials.secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: {
      cursor,
      rescanCursor,
      ...roundRobins,
      pending,
      multiCoinPatches: multiCoinPatchesOf({ stored: converted, planCursor: cursor }),
    },
    plan,
    write,
    depthMemories: createDepthMemories(deps.now, BINANCE_DEPTH_CONFIG),
  };

  await storePlannedList({ plan, marks: context.marks, write });

  return runBinanceWalkPlan({
    context,
    lane: 'transfer',
    cost: COSTS.transfer,
    callsOf,
    owedFirst: true,
    read: (window, span, keepCalls) => readSpan(context, window, span, keepCalls),
    commit: (window, span, read, pass) => commitSpan(context, window, span, read, pass),
  });
};

/**
 * Import the user's universal transfers of every tracked coin (Spot and Funding, to each other and
 * to the wallets Kiko does not track) as transactions, and list the coins of the transfers it
 * counts but does not import, committing a span's rows before advancing the mark past
 * it. A run goes forward from the watermark first, then reads the overlap ground earlier runs left
 * owed, then re-scans the last window behind the watermark, then reads the owed points, each on
 * what budget is left (see `planWalkPasses`); every span asks all 20 types. `complete: false`
 * means history, owed ground or the re-scan remains and a later run resumes from the stored marks;
 * a failure other than a rate limit rejects, so the caller can log it without failing the balance
 * sync.
 */
export const syncBinanceTransferHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinanceTransferHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultTransferHistoryDeps, ...overrides }, request.targetAccountId, request.run);
