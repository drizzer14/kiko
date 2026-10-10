import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_RESCAN_CURSOR_FIELD,
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
  advanceWalkMarks,
  BinanceWalkStop,
  btcSatoshis,
  logWalkStop,
  planWalkPasses,
  resolveWalletHoldings,
  runWalkPlan,
  type SpanRead,
  splitOrStop,
  type WalkMarkFields,
  type WalkMarks,
  walkSpans,
  type WalkPass,
  type WalkPlan,
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

const PAY_MARK_FIELDS: WalkMarkFields = {
  cursor: BINANCE_PAY_HISTORY_CURSOR_FIELD,
  rescan: BINANCE_PAY_RESCAN_CURSOR_FIELD,
};

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

/**
 * Whether the user paid or received an order, from the user's own uid alone: the payer's
 * Binance id is the uid for an outgoing order, the receiver's for an incoming one. The
 * shape of the parties is no signal (a real incoming C2C order names the counterparty as
 * payer too), so an unknown uid, a uid that matches neither party or both, and a sign
 * that disagrees with the uid are all no direction. `null` means the window stops. The
 * Binance ids are read here and nowhere else; they never reach a row or a log.
 */
export const payDirection = (order: BinancePayOrder, uid: string | null): PayDirection | null => {
  const sign = directionOfSign(order.amount);
  const isPayer = uid !== null && order.payerInfo.binanceId === uid;
  const isReceiver = uid !== null && order.receiverInfo.binanceId === uid;

  if (sign === undefined || isPayer === isReceiver) {
    return null;
  }

  const own = isPayer ? 'out' : 'in';

  return own === sign ? own : null;
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

/** What an order's BTC funds entries say each wallet paid: the wallets with a cost above zero. */
const costsOf = (order: BinancePayOrder): WalletShare[] => {
  const costs = order.fundsDetail.filter(isBtcFunds).flatMap((entry) => entry.walletAssetCost);
  const satoshisByWallet = new Map<number, number>();

  for (const cost of costs) {
    const costSatoshis = btcSatoshis(cost.amount);

    if (costSatoshis === null || costSatoshis < 0) {
      throw new BinanceWalkStop('pay-amount-invalid');
    }

    const stored = satoshisByWallet.get(cost.walletType) ?? 0;
    satoshisByWallet.set(cost.walletType, stored + costSatoshis);
  }

  return [...satoshisByWallet]
    .filter(([, costSatoshis]) => costSatoshis > 0)
    .map(([walletType, costSatoshis]) => ({ walletType, satoshis: costSatoshis }));
};

/**
 * The wallets an order names. Binance sends `walletType` as 1 even on a split order, so it
 * is only the fallback for an order that sends no `walletTypes`.
 */
const namedWalletsOf = (order: BinancePayOrder): number[] => {
  const declared = [...new Set(order.walletTypes ?? [])];

  if (declared.length > 0 || order.walletType === undefined) {
    return declared;
  }

  return [order.walletType];
};

/**
 * What a send paid from: the wallets with a cost above zero. They must be among the
 * wallets the order names and their costs must add up to the order amount to the satoshi,
 * or the order is one this walk cannot place. A named wallet with no cost is left out: a
 * send is paid from the wallets that were charged, and `walletTypes` can list one that was
 * not.
 */
const sharesOfSend = (
  order: BinancePayOrder,
  wallets: number[],
  satoshis: number,
): WalletShare[] => {
  const shares = costsOf(order);
  const total = shares.reduce((sum, share) => sum + share.satoshis, 0);
  const costedOnNamed = shares.every((share) => wallets.includes(share.walletType));

  if (!costedOnNamed || total !== satoshis) {
    throw new BinanceWalkStop('pay-split-mismatch');
  }

  return shares;
};

/**
 * The wallet a receive lands on: the one `walletTypes` names. A receive's costs describe
 * the payer's wallets, which need not be the receiver's, so no cost is read, and the
 * receiver's split (two wallets) cannot be told from them.
 */
const shareOfReceive = (wallets: number[], satoshis: number): WalletShare[] => {
  if (wallets.length >= 2) {
    throw new BinanceWalkStop('pay-split-mismatch');
  }

  return wallets.map((walletType) => ({ walletType, satoshis }));
};

/**
 * The wallets an order's satoshis land on. A funds detail that names no BTC at all
 * means the order did not move BTC, so no BTC row is guessed from it.
 */
const sharesOf = (
  order: BinancePayOrder,
  direction: PayDirection,
  satoshis: number,
): WalletShare[] => {
  if (order.fundsDetail.length > 0 && !order.fundsDetail.some(isBtcFunds)) {
    throw new BinanceWalkStop('pay-funds-not-btc');
  }

  const wallets = namedWalletsOf(order);

  if (wallets.length === 0) {
    throw new BinanceWalkStop('pay-wallet-unknown');
  }

  return direction === 'out'
    ? sharesOfSend(order, wallets, satoshis)
    : shareOfReceive(wallets, satoshis);
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

  return sharesOf(order, direction, satoshis).map((share) => ({
    wallet: walletOf(share.walletType),
    amountMinorUnits: direction === 'out' ? -share.satoshis : share.satoshis,
    time: order.transactionTime,
    externalId: `${accountId}:pay:${order.orderType}:${order.transactionId}:${share.walletType}`,
    description,
  }));
};

/**
 * The injectable seams of the Pay walk: the credential, holding and uid reads, the Pay
 * read, the insert-only holding creation, the deduping import, and the cursor write.
 * Pacing and the weight budget come from the run.
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
};

type PayContext = {
  deps: BinancePayHistoryDeps;
  run: BinanceHistoryRun;
  accountId: string;
  spot: HoldingRow;
  apiKey: string;
  secret: string;
  options: FetchAccountOptions;
  uid: string;
  marks: WalkMarks;
  plan: WalkPlan;
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

/** Turn the planned rows into importable ones, creating a missing wallet holding at zero first. */
const placeRows = async (
  context: PayContext,
  planned: PlannedPayRow[],
): Promise<BinanceTransactionRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { accountId, deps } = context;
  const holdings = await resolveWalletHoldings({
    accountId,
    keys: walletsOf(planned),
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });

  return planned.map(({ wallet, ...row }) => {
    const holding = holdings.get(wallet);

    if (holding === undefined) {
      throw new BinanceWalkStop('pay-holding-missing');
    }

    return { ...row, holdingId: holding.id, source: 'binance' };
  });
};

/**
 * Commit one span's page: plan and place its rows, write them, then move the walk's mark
 * (rows first, mark second, so a crash between the two just re-imports idempotently). BTC
 * that paid for an order of another coin is a BTC movement with no row rule yet, so
 * committing past it would lose the movement for good: a `BinanceWalkStop` leaves the span
 * uncommitted, as it does for any row the walk cannot trust. Returns the rows imported.
 */
const commitSpan = async (
  context: PayContext,
  span: WalkWindow,
  page: PayHistoryPage,
  pass: WalkPass,
): Promise<number> => {
  if (page.hasBtcFundedOtherCoinOrder) {
    throw new BinanceWalkStop('pay-btc-funded-other-coin');
  }

  const rows = await placeRows(context, plannedRowsOf(context, page.rows));
  let imported = 0;

  if (rows.length > 0) {
    imported = await context.deps.addTransactions(rows);
  }

  const { deps, spot, plan, marks } = context;
  await advanceWalkMarks({
    pass,
    span,
    plan,
    marks,
    restartMs: HISTORY_FLOOR_MS,
    fields: PAY_MARK_FIELDS,
    write: (field, cursorMs) => deps.writeWalkCursor(spot.id, field, cursorMs),
  });

  return imported;
};

/** `commitSpan`, with a row the walk cannot trust logged and answered as `undefined`. */
const commitOrStop = async (
  context: PayContext,
  span: WalkWindow,
  page: PayHistoryPage,
  pass: WalkPass,
): Promise<number | undefined> => {
  try {
    return await commitSpan(context, span, page, pass);
  } catch (error) {
    if (error instanceof BinanceWalkStop) {
      logWalkStop(error.code);

      return undefined;
    }

    throw error;
  }
};

/**
 * Read one span. A full page (it may hold more than it shows) is answered with the half
 * to read instead, so a page that is not full is the whole of its span whatever order
 * Binance sorts in and whichever end of the range it leaves open. A span of one
 * millisecond that is still full stops the walk rather than skip.
 */
const readSpan = async (
  context: PayContext,
  span: WalkWindow,
): Promise<SpanRead<PayHistoryPage> | undefined> => {
  const page = await fetchSpan(context, span);

  if (page === undefined) {
    return undefined;
  }

  return page.gathered >= PAY_PAGE_LIMIT
    ? splitOrStop(span, 'pay-page-stuck')
    : { kind: 'page', page };
};

/** A walk without the user's uid has no direction for any order, so it stops. */
const stopWithoutUid = (): undefined => {
  logWalkStop('pay-uid-unavailable');

  return undefined;
};

/**
 * The user's own uid, the only signal of the direction rule. `undefined` is a clean stop
 * with the cursors unmoved: the budget ran out, Binance rate-limited, or the uid could
 * not be read (a failed read, or an account that carries none).
 */
const readOwnUid = async (context: Omit<PayContext, 'uid'>): Promise<string | undefined> => {
  const { deps, run, apiKey, secret, options } = context;

  if (!run.budget.canAfford('pay', COSTS.account)) {
    return undefined;
  }

  await run.gate.wait();

  try {
    const { uid } = await deps.fetchAccount(apiKey, secret, options);

    return uid ?? stopWithoutUid();
  } catch (error) {
    return stopOnRateLimit(context, error) ? undefined : stopWithoutUid();
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

  const payCursor = binanceWalkCursorOf(PAY_MARK_FIELDS.cursor, spot.metadata);
  const rescanCursor = binanceWalkCursorOf(PAY_MARK_FIELDS.rescan, spot.metadata);
  const plan = planWalkPasses({
    cursor: payCursor,
    rescanCursor,
    floorMs: payFloorMs(now),
    endTime: now,
    windowMs: PAY_WINDOW_MS,
    overlapMs: RESYNC_OVERLAP_MS,
    maxWindows: MAX_WINDOWS,
  });

  if (plan.forward.length === 0 && plan.rescan.length === 0) {
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
    marks: { cursor: payCursor, rescanCursor },
    plan,
  };
  const uid = await readOwnUid(base);

  if (uid === undefined) {
    return { imported: 0, complete: false };
  }

  const context: PayContext = { ...base, uid };

  return runWalkPlan({
    plan,
    canAfford: () => run.budget.canAfford('pay', COSTS.pay),
    runWindow: (window, pass) =>
      walkSpans({
        window,
        read: (span) => readSpan(context, span),
        commit: (span, page) => commitOrStop(context, span, page, pass),
      }),
  });
};

/**
 * Import the user's BTC Binance Pay history as transactions on the wallet each order
 * names (Spot, Funding or Earn), committing a window's rows before advancing the mark
 * past it. A run goes forward from the watermark first, then re-scans the last window
 * behind it on what budget is left (see `planWalkPasses`). `complete: false` means history
 * or the re-scan remains and a later run resumes from the stored watermark and re-scan
 * mark; a failure other than a rate limit rejects, so the caller can log it without
 * failing the balance sync.
 */
export const syncBinancePayHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinancePayHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultPayHistoryDeps, ...overrides }, request.targetAccountId, request.run);
