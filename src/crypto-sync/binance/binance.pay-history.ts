import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  binanceWalkCursorOf,
  type BinanceWalkCursorField,
} from '@kiko/holdings/holding-metadata';
import type { HoldingRow } from '@kiko/db';
import { transactionsRepo } from '@kiko/transactions/repo';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';

import {
  type BinanceAccount,
  BINANCE_ASSET,
  BinanceRateLimitError,
  fetchAccount,
  type FetchAccountOptions,
} from './binance.client';
import {
  BinanceWalkStop,
  btcSatoshis,
  buildWalkWindows,
  logWalkNotice,
  logWalkStop,
  resolveWalkStart,
  resolveWalletHoldings,
  type WalkResult,
  type WalkWindow,
} from './binance.history-walk';
import {
  type BinanceWalletKey,
  binanceKeyOf,
  EARN_KEY,
  FUNDING_KEY,
  SPOT_KEY,
} from './binance.holding-keys';
import {
  type BinanceTransactionRow,
  HISTORY_FLOOR_MS,
  RESYNC_OVERLAP_MS,
} from './binance.transactions';
import {
  createMovementLedger,
  type MovementLedger,
  type StoredMovementRow,
  twinsOf,
} from './binance.overlap-guard';
import {
  type BinancePayOrder,
  fetchPayHistory,
  PAY_PAGE_LIMIT,
  type PayHistoryPage,
} from './binance.history-client';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';

/** Binance rejects a Pay `startTime`/`endTime` gap of 90 days or more. */
export const PAY_WINDOW_MS = 89 * DAY_MS;

/** Binance serves the last 18 months of Pay history and nothing older. */
const PAY_HISTORY_MONTHS = 18;

/**
 * Binance's own count of the 18 months is not documented (calendar months, 540 days, or an
 * overflow of the start time), so the first request stays this far inside the window it may
 * ask for. A start that is too old is rejected on every run, and the walk never begins.
 */
const PAY_FLOOR_MARGIN_MS = 10 * DAY_MS;

/** Safety stop on the window walk: the 18 months are 7 windows. */
const MAX_WINDOWS = 12;

/** A proper noun, never a catalogue string: the stored description when no name is given. */
const PAY_BRAND = 'Binance Pay';

/**
 * The earliest `startTime` the walk asks Pay history for: 18 calendar months back (UTC,
 * the day clamped to the target month's length) plus the margin, so the request is never
 * older than the window Binance may serve. Never before the shared history floor.
 */
export const payFloorMs = (now: number): number => {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() - PAY_HISTORY_MONTHS;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthsAgo = Date.UTC(
    year,
    month,
    Math.min(date.getUTCDate(), lastDayOfMonth),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );

  return Math.max(HISTORY_FLOOR_MS, monthsAgo + PAY_FLOOR_MARGIN_MS);
};

type PayDirection = 'out' | 'in';

const directionOfSign = (amount: string): PayDirection | undefined => {
  const value = Number(amount);

  if (!Number.isFinite(value) || value === 0) {
    return undefined;
  }

  return value > 0 ? 'in' : 'out';
};

/** A named payer id means the user paid; failing that, a named receiver id means they received. */
const directionOfShape = (order: BinancePayOrder): PayDirection | undefined => {
  if (order.payerInfo.binanceId !== undefined) {
    return 'out';
  }

  if (order.receiverInfo.binanceId !== undefined) {
    return 'in';
  }

  return undefined;
};

const directionOfUid = (
  order: BinancePayOrder,
  uid: string | null,
): PayDirection | 'both' | undefined => {
  if (uid === null) {
    return undefined;
  }

  const isPayer = order.payerInfo.binanceId === uid;
  const isReceiver = order.receiverInfo.binanceId === uid;

  if (isPayer && isReceiver) {
    return 'both';
  }

  if (isPayer) {
    return 'out';
  }

  if (isReceiver) {
    return 'in';
  }

  return undefined;
};

/**
 * Whether the user paid or received an order. The sign of the amount is never trusted
 * alone: the shape of the parties (who has a Binance id) and the user's own uid are two
 * more signals, and every signal that exists must agree. At least one of those two must
 * exist, and a self-payment or an amount that is zero or not a number is no direction.
 * `null` means the window stops. The Binance ids are read here and nowhere else; they
 * never reach a row or a log.
 */
export const payDirection = (order: BinancePayOrder, uid: string | null): PayDirection | null => {
  const sign = directionOfSign(order.amount);
  const shape = directionOfShape(order);
  const own = directionOfUid(order, uid);

  if (sign === undefined || own === 'both' || (shape === undefined && own === undefined)) {
    return null;
  }

  return [shape, own].every((signal) => signal === undefined || signal === sign) ? sign : null;
};

/** The counterparty's trimmed nickname exactly as Binance gives it, or the brand name. */
export const payDescription = (order: BinancePayOrder, direction: PayDirection): string => {
  const counterparty = direction === 'out' ? order.receiverInfo : order.payerInfo;

  return counterparty.name?.trim() || PAY_BRAND;
};

/** Binance's wallet ids for a Pay order: 2 Spot, 1 Funding, 5 Earn. Any other is untracked. */
const walletOf = (walletType: number): BinanceWalletKey =>
  match(walletType)
    .returnType<BinanceWalletKey>()
    .with(2, () => SPOT_KEY)
    .with(1, () => FUNDING_KEY)
    .with(5, () => EARN_KEY)
    .otherwise(() => {
      throw new BinanceWalkStop('pay-wallet-unknown');
    });

type WalletShare = { walletType: number; satoshis: number };

const isBtcFunds = (entry: BinancePayOrder['fundsDetail'][number]): boolean =>
  entry.currency === BINANCE_ASSET;

/**
 * An order paid from several wallets lists each wallet's cost per funds entry. The
 * costs must add up to the order amount to the satoshi, or the split is not trusted.
 */
const splitSharesOf = (order: BinancePayOrder, satoshis: number): WalletShare[] => {
  const satoshisByWallet = new Map<number, number>();

  for (const entry of order.fundsDetail.filter(isBtcFunds)) {
    for (const cost of entry.walletAssetCost) {
      const costSatoshis = btcSatoshis(cost.amount);

      if (costSatoshis === null || costSatoshis < 0) {
        throw new BinanceWalkStop('pay-amount-invalid');
      }

      const stored = satoshisByWallet.get(cost.walletType) ?? 0;
      satoshisByWallet.set(cost.walletType, stored + costSatoshis);
    }
  }

  const shares = [...satoshisByWallet]
    .filter(([, costSatoshis]) => costSatoshis > 0)
    .map(([walletType, costSatoshis]) => ({ walletType, satoshis: costSatoshis }));

  if (shares.reduce((total, share) => total + share.satoshis, 0) !== satoshis) {
    throw new BinanceWalkStop('pay-split-mismatch');
  }

  return shares;
};

/**
 * The wallets an order's satoshis land on. A funds detail that names no BTC at all
 * means the order did not move BTC, so no BTC row is guessed from it.
 */
const sharesOf = (order: BinancePayOrder, satoshis: number): WalletShare[] => {
  if (order.fundsDetail.length > 0 && !order.fundsDetail.some(isBtcFunds)) {
    throw new BinanceWalkStop('pay-funds-not-btc');
  }

  const declared = [...new Set(order.walletTypes ?? [])];

  if (declared.length >= 2) {
    return splitSharesOf(order, satoshis);
  }

  const only = declared.at(0);

  if (order.walletType !== undefined && only !== undefined && only !== order.walletType) {
    throw new BinanceWalkStop('pay-wallet-unknown');
  }

  const walletType = order.walletType ?? only;

  if (walletType === undefined) {
    throw new BinanceWalkStop('pay-wallet-unknown');
  }

  return [{ walletType, satoshis }];
};

/** A row mapped from an order, before its wallet is turned into a holding. */
type PlannedPayRow = {
  wallet: BinanceWalletKey;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
};

/**
 * The rows of one BTC order, one per wallet it was paid from or into. An order the
 * walk cannot trust (no id, no direction, no amount, an unknown or unbalanced wallet)
 * throws a `BinanceWalkStop`: a skipped order would be silent loss.
 */
export const payRowsOf = (input: {
  accountId: string;
  order: BinancePayOrder;
  uid: string | null;
}): PlannedPayRow[] => {
  const { accountId, order, uid } = input;

  if (order.transactionId === '') {
    throw new BinanceWalkStop('pay-id-missing');
  }

  const direction = payDirection(order, uid);

  if (direction === null) {
    throw new BinanceWalkStop('pay-direction-ambiguous');
  }

  const satoshis = Math.abs(btcSatoshis(order.amount) ?? 0);

  if (satoshis === 0) {
    throw new BinanceWalkStop('pay-amount-invalid');
  }

  const description = payDescription(order, direction);

  return sharesOf(order, satoshis).map((share) => ({
    wallet: walletOf(share.walletType),
    amountMinorUnits: direction === 'out' ? -share.satoshis : share.satoshis,
    time: order.transactionTime,
    externalId: `${accountId}:pay:${order.orderType}:${order.transactionId}:${share.walletType}`,
    description,
  }));
};

/**
 * The injectable seams of the Pay walk: the credential, holding and uid reads, the Pay
 * read, the insert-only holding creation, the deduping import, the cursor write, and
 * the rows already on a holding for the overlap guard. Pacing and the weight budget
 * come from the run.
 */
export type BinancePayHistoryDeps = {
  now: () => number;
  fetchImpl: typeof fetch;
  readCredentials: (accountId: string) => Promise<BinanceCredentials | undefined>;
  listHoldings: (accountId: string) => Promise<HoldingRow[]>;
  fetchAccount: (
    apiKey: string,
    secret: string,
    options?: FetchAccountOptions,
  ) => Promise<BinanceAccount>;
  fetchPayHistory: (
    apiKey: string,
    secret: string,
    query: { startTime: number; endTime: number },
    options?: FetchAccountOptions,
  ) => Promise<PayHistoryPage>;
  ensureHoldings: (holdings: ExchangeHolding[]) => Promise<void>;
  addTransactions: (rows: BinanceTransactionRow[]) => Promise<number>;
  writeWalkCursor: (
    holdingId: string,
    field: BinanceWalkCursorField,
    cursorMs: number,
  ) => Promise<void>;
  listHoldingTransactions: (holdingId: string) => Promise<StoredMovementRow[]>;
};

const defaultPayHistoryDeps: BinancePayHistoryDeps = {
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchAccount,
  fetchPayHistory,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
  writeWalkCursor: (holdingId, field, cursorMs) =>
    holdingsRepo.setBinanceWalkCursor(holdingId, field, cursorMs),
  listHoldingTransactions: async (holdingId) => transactionsRepo.listByHoldingQuery(holdingId),
};

type PayContext = {
  deps: BinancePayHistoryDeps;
  run: BinanceHistoryRun;
  accountId: string;
  spot: HoldingRow;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  uid: string | null;
  /** The Pay watermark as the run found it. */
  cursor: number | null;
  ledger: MovementLedger;
  noticed: Set<string>;
};

/** Logged once per run, so a long backlog cannot flood the log with one fixed tag. */
const noticeOnce = (context: PayContext, code: string): void => {
  if (!context.noticed.has(code)) {
    context.noticed.add(code);
    logWalkNotice(code);
  }
};

/** Whether `error` is Binance's rate limit, which also puts the account on its shared cooldown. */
const stopOnRateLimit = (
  context: Pick<PayContext, 'deps' | 'accountId'>,
  error: unknown,
): boolean => {
  if (!(error instanceof BinanceRateLimitError)) {
    return false;
  }

  setBinanceCooldownUntil(context.accountId, context.deps.now() + error.retryAfterMs);

  return true;
};

/**
 * One request for the span. `undefined` is a clean stop: the call budget ran out (each
 * request records a call on the lane, so its per-run cap ends the walk), or Binance
 * rate-limited.
 */
const fetchSpan = async (
  context: PayContext,
  span: WalkWindow,
): Promise<PayHistoryPage | undefined> => {
  const { deps, run, apiKey, secret, options } = context;

  if (!run.budget.canAfford('pay', COSTS.pay)) {
    return undefined;
  }

  try {
    await run.gate.wait();
    const page = await deps.fetchPayHistory(
      apiKey,
      secret,
      { startTime: span.start, endTime: span.end },
      options,
    );
    run.budget.record('pay', page);

    return page;
  } catch (error) {
    if (stopOnRateLimit(context, error)) {
      return undefined;
    }

    throw error;
  }
};

/**
 * The first half of a span, or `undefined` for a span of one millisecond, which cannot be
 * split. A half is at least one millisecond long, so no request has `startTime` equal to
 * `endTime`.
 */
const halfOf = (span: WalkWindow): WalkWindow | undefined => {
  const length = span.end - span.start;

  return length < 2 ? undefined : { start: span.start, end: span.start + Math.floor(length / 2) };
};

/**
 * BTC that paid for an order of another coin is a BTC movement with no row rule yet.
 * Committing past it would lose the movement for good, so the span stays uncommitted.
 */
const assertNoBtcFundedOtherCoinOrder = (page: PayHistoryPage): void => {
  if (page.hasBtcFundedOtherCoinOrder) {
    throw new BinanceWalkStop('pay-btc-funded-other-coin');
  }
};

/** One row per key: an order on the boundary of two spans is read twice. */
const plannedRowsOf = (context: PayContext, orders: BinancePayOrder[]): PlannedPayRow[] => {
  const planned = orders.flatMap((order) =>
    payRowsOf({ accountId: context.accountId, order, uid: context.uid }),
  );

  return [...new Map(planned.map((row) => [row.externalId, row])).values()];
};

const walletsOf = (rows: PlannedPayRow[]): BinanceWalletKey[] => [
  ...new Set(rows.map((row) => row.wallet)),
];

/**
 * Turn the planned rows into importable ones. A Pay row that is the twin of a stored
 * capital deposit or withdrawal on any Binance BTC holding of the account is left out (the
 * capital walk already holds it), and a missing wallet holding is created at zero only for
 * a wallet that still receives a row.
 */
const placeRows = async (
  context: PayContext,
  planned: PlannedPayRow[],
): Promise<BinanceTransactionRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { accountId, deps, ledger } = context;
  const stored = await ledger.read();
  const twins = twinsOf({
    kind: 'pay',
    candidates: planned,
    sameKind: stored.pay,
    otherKind: stored.capital,
  });

  if (twins.size > 0) {
    noticeOnce(context, 'pay-overlap-skip');
  }

  const kept = planned.filter((row) => !twins.has(row.externalId));
  const holdings = await resolveWalletHoldings({
    accountId,
    keys: walletsOf(kept),
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });

  return kept.map(({ wallet, ...row }) => {
    const holding = holdings.get(wallet);

    if (holding === undefined) {
      throw new BinanceWalkStop('pay-holding-missing');
    }

    return { ...row, holdingId: holding.id, source: 'binance' };
  });
};

/**
 * Commit one span's page: plan and place its rows, write them, then move the Pay watermark
 * to the span's end (rows first, watermark second, so a crash between the two just
 * re-imports idempotently). The watermark never moves back, because a re-scan can start
 * behind it. A `BinanceWalkStop` leaves the span uncommitted. Returns the rows imported.
 */
const commitSpan = async (
  context: PayContext,
  span: WalkWindow,
  page: PayHistoryPage,
): Promise<number> => {
  assertNoBtcFundedOtherCoinOrder(page);
  const rows = await placeRows(context, plannedRowsOf(context, page.rows));
  let imported = 0;

  if (rows.length > 0) {
    imported = await context.deps.addTransactions(rows);
    context.ledger.remember(rows);
  }

  await context.deps.writeWalkCursor(
    context.spot.id,
    BINANCE_PAY_HISTORY_CURSOR_FIELD,
    Math.max(span.end, context.cursor ?? span.end),
  );

  return imported;
};

/** `commitSpan`, with a row the walk cannot trust logged and answered as `undefined`. */
const commitOrStop = async (
  context: PayContext,
  span: WalkWindow,
  page: PayHistoryPage,
): Promise<number | undefined> => {
  try {
    return await commitSpan(context, span, page);
  } catch (error) {
    if (error instanceof BinanceWalkStop) {
      logWalkStop(error.code);

      return undefined;
    }

    throw error;
  }
};

/** What a window yielded: the rows committed, and whether it reached its end. */
type WindowOutcome = { imported: number; complete: boolean };

/**
 * The span that follows a committed one. It starts where the committed one ended and is
 * twice as wide, because a stretch that fit one page is likely to fit a longer one, and
 * it never reaches past the window.
 */
const nextSpanAfter = (committed: WalkWindow, window: WalkWindow): WalkWindow => ({
  start: committed.end,
  end: Math.min(window.end, committed.end + 2 * (committed.end - committed.start)),
});

/**
 * Walk one window with no cursor and no order to rely on: ask for the whole window, and
 * when the page comes back full (it may hold more than it shows) halve the span and ask
 * again, so a page that is not full is the whole of its span whatever order Binance
 * sorts in and whichever end of the range it leaves open. A non-full page commits and the
 * walk goes on from where it ended; the 1-millisecond boundary two spans share is read
 * twice and removed by the key. A span of one millisecond that is still full stops the
 * window rather than skip.
 */
const runOneWindow = async (context: PayContext, window: WalkWindow): Promise<WindowOutcome> => {
  let imported = 0;
  let span = window;

  while (span.start < window.end) {
    const page = await fetchSpan(context, span);

    if (page === undefined) {
      return { imported, complete: false };
    }

    if (page.gathered >= PAY_PAGE_LIMIT) {
      const half = halfOf(span);

      if (half === undefined) {
        logWalkStop('pay-page-stuck');

        return { imported, complete: false };
      }

      span = half;
    } else {
      const committed = await commitOrStop(context, span, page);

      if (committed === undefined) {
        return { imported, complete: false };
      }

      imported += committed;
      span = nextSpanAfter(span, window);
    }
  }

  return { imported, complete: true };
};

/**
 * The user's own uid, for the direction rule. Its failure is no walk failure: without
 * it that one signal is absent and the shape and the sign decide. `undefined` is a
 * clean stop: the budget ran out, or Binance rate-limited.
 */
const readOwnUid = async (
  context: Omit<PayContext, 'uid'>,
): Promise<{ uid: string | null } | undefined> => {
  const { deps, run, apiKey, secret, options } = context;

  if (!run.budget.canAfford('pay', COSTS.account)) {
    return undefined;
  }

  await run.gate.wait();

  try {
    return { uid: (await deps.fetchAccount(apiKey, secret, options)).uid };
  } catch (error) {
    if (stopOnRateLimit(context, error)) {
      return undefined;
    }

    logWalkNotice('pay-uid-unavailable');

    return { uid: null };
  } finally {
    run.budget.record('pay', { usedUidWeight1m: undefined, usedIpWeight1m: undefined });
  }
};

const runSync = async (
  deps: BinancePayHistoryDeps,
  accountId: string,
  run: BinanceHistoryRun,
): Promise<WalkResult> => {
  const now = deps.now();

  if (isBinanceCoolingDown(accountId, now)) {
    return { imported: 0, complete: false };
  }

  const holdings = await deps.listHoldings(accountId);
  const spot = holdings.find((holding) => binanceKeyOf(holding) === SPOT_KEY);
  const credentials = await deps.readCredentials(accountId);

  if (spot === undefined || credentials === undefined) {
    return { imported: 0, complete: true };
  }

  // A Pay window never reaches past the capital walk's watermark: beyond it the capital
  // rows are not stored yet, so a Pay row's twin could not be seen. A capital record that
  // settles later and lands behind the watermark is caught by the capital walk's own check
  // against the Pay row stored here.
  const capitalCursor = binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, spot.metadata);

  if (capitalCursor === null) {
    return { imported: 0, complete: false };
  }

  const payCursor = binanceWalkCursorOf(BINANCE_PAY_HISTORY_CURSOR_FIELD, spot.metadata);
  const endTime = Math.min(now, capitalCursor);
  const windows = buildWalkWindows(
    resolveWalkStart({
      cursor: payCursor,
      floorMs: payFloorMs(now),
      endTime,
      windowMs: PAY_WINDOW_MS,
      overlapMs: RESYNC_OVERLAP_MS,
    }),
    endTime,
    PAY_WINDOW_MS,
    MAX_WINDOWS,
  );

  if (windows.length === 0) {
    return { imported: 0, complete: false };
  }

  const { apiKey, secret } = credentials;
  const base = {
    deps,
    run,
    accountId,
    spot,
    apiKey,
    secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    cursor: payCursor,
    ledger: createMovementLedger({
      accountId,
      listHoldings: deps.listHoldings,
      listHoldingTransactions: deps.listHoldingTransactions,
    }),
    noticed: new Set<string>(),
  };
  const own = await readOwnUid(base);

  if (own === undefined) {
    return { imported: 0, complete: false };
  }

  const context: PayContext = { ...base, uid: own.uid };
  let imported = 0;

  for (const window of windows) {
    if (!run.budget.canAfford('pay', COSTS.pay)) {
      return { imported, complete: false };
    }

    const outcome = await runOneWindow(context, window);
    imported += outcome.imported;

    if (!outcome.complete) {
      return { imported, complete: false };
    }
  }

  return { imported, complete: true };
};

/**
 * Import the user's BTC Binance Pay history as transactions on the wallet each order
 * names (Spot, Funding or Earn), oldest window first, committing a window's rows
 * before advancing the Pay watermark past it. Runs after the capital walk and never
 * past its watermark. `complete: false` means history remains behind and a later run
 * resumes from the watermark; a failure other than a rate limit rejects, so the caller
 * can log it without failing the balance sync.
 */
export const syncBinancePayHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinancePayHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultPayHistoryDeps, ...overrides }, request.targetAccountId, request.run);
