import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BINANCE_HISTORY_CURSOR_FIELD,
  BINANCE_PAY_HISTORY_CURSOR_FIELD,
  binanceWalkCursorOf,
  type BinanceWalkCursorField,
} from '@kiko/holdings/holding-metadata';
import { transactionsRepo } from '@kiko/transactions/repo';
import type { HoldingRow, TransactionRow } from '@kiko/db';
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
  type BinancePayOrder,
  fetchPayHistory,
  PAY_PAGE_LIMIT,
  type PayHistoryPage,
} from './binance.history-client';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceTransactionRow, HISTORY_FLOOR_MS } from './binance.transactions';

/** Binance rejects a Pay `startTime`/`endTime` gap of 90 days or more. */
export const PAY_WINDOW_MS = 89 * DAY_MS;

/**
 * How far either side of a Pay row a capital row of the same size still reads as the
 * same movement. The two histories stamp one movement seconds apart, never minutes.
 */
export const PAY_OVERLAP_GUARD_MS = 10 * 60_000;

/** Binance serves the last 18 months of Pay history and nothing older. */
const PAY_HISTORY_MONTHS = 18;

/** Same slack as the capital walk: a row that settles late is still caught by a re-scan. */
const RESYNC_OVERLAP_MS = DAY_MS;

/** Safety stop on the window walk: the 18 months are 7 windows. */
const MAX_WINDOWS = 12;

/** A proper noun, never a catalogue string: the stored description when no name is given. */
const PAY_BRAND = 'Binance Pay';

/**
 * The earliest `startTime` Binance accepts for Pay history: 18 calendar months back
 * (UTC, the day clamped to the target month's length) plus one day, so the request is
 * never older than the window it may ask for. Never before the shared history floor.
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

  return Math.max(HISTORY_FLOOR_MS, monthsAgo + DAY_MS);
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

type CapitalRow = Pick<TransactionRow, 'externalId' | 'amountMinorUnits' | 'time'>;

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
  listHoldingTransactions: (holdingId: string) => Promise<CapitalRow[]>;
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
  capitalRowsByHolding: Map<string, CapitalRow[]>;
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
 * Page one window by narrowing `endTime` to the oldest order of a full page: the
 * history has no cursor and its order is not relied on. A full page that does not
 * move `endTime` strictly down (more than a page of orders in one millisecond, or an
 * order outside the window) cannot be paged, so the window stops rather than skip.
 * Returns `undefined` on a clean stop: the budget ran out, or Binance rate-limited.
 */
const fetchWindowOrders = async (
  context: PayContext,
  window: WalkWindow,
): Promise<BinancePayOrder[] | undefined> => {
  const { deps, run, apiKey, secret, options } = context;
  const orders: BinancePayOrder[] = [];
  let endTime = window.end;

  try {
    // Each pass records a call on the lane, so its per-run cap ends the loop.
    while (run.budget.canAfford('pay', COSTS.pay)) {
      await run.gate.wait();
      const page = await deps.fetchPayHistory(
        apiKey,
        secret,
        { startTime: window.start, endTime },
        options,
      );
      run.budget.record('pay', page);
      orders.push(...page.rows);

      if (page.hasBtcFundedOtherCoinOrder) {
        noticeOnce(context, 'pay-non-btc-funds');
      }

      if (page.gathered < PAY_PAGE_LIMIT) {
        return orders;
      }

      const oldest = page.oldestTransactionTime;

      if (oldest === undefined || oldest >= endTime || oldest < window.start) {
        throw new BinanceWalkStop('pay-page-stuck');
      }

      endTime = oldest;
    }
  } catch (error) {
    if (stopOnRateLimit(context, error)) {
      return undefined;
    }

    throw error;
  }

  return undefined;
};

/** One row per key: an order on the boundary of two pages is read twice. */
const plannedRowsOf = (context: PayContext, orders: BinancePayOrder[]): PlannedPayRow[] => {
  const planned = orders.flatMap((order) =>
    payRowsOf({ accountId: context.accountId, order, uid: context.uid }),
  );

  return [...new Map(planned.map((row) => [row.externalId, row])).values()];
};

const capitalRowsOf = async (context: PayContext, holdingId: string): Promise<CapitalRow[]> => {
  const cached = context.capitalRowsByHolding.get(holdingId);

  if (cached !== undefined) {
    return cached;
  }

  const prefixes = [`${context.accountId}:deposit:`, `${context.accountId}:withdraw:`];
  const rows = (await context.deps.listHoldingTransactions(holdingId)).filter((row) =>
    prefixes.some((prefix) => row.externalId?.startsWith(prefix)),
  );
  context.capitalRowsByHolding.set(holdingId, rows);

  return rows;
};

/** The same signed size, within the guard, as a capital row already on the holding. */
const duplicatesCapitalRow = async (
  context: PayContext,
  holdingId: string,
  row: PlannedPayRow,
): Promise<boolean> =>
  (await capitalRowsOf(context, holdingId)).some(
    (capital) =>
      capital.amountMinorUnits === row.amountMinorUnits &&
      Math.abs(capital.time - row.time) <= PAY_OVERLAP_GUARD_MS,
  );

const walletsOf = (rows: PlannedPayRow[]): BinanceWalletKey[] => [
  ...new Set(rows.map((row) => row.wallet)),
];

/**
 * Turn the planned rows into importable ones. A Pay row that repeats a capital
 * deposit or withdrawal is left out (the capital walk already holds it), and a missing
 * wallet holding is created at zero only for a wallet that still receives a row.
 */
const placeRows = async (
  context: PayContext,
  planned: PlannedPayRow[],
): Promise<BinanceTransactionRow[]> => {
  if (planned.length === 0) {
    return [];
  }

  const { accountId, deps } = context;
  const existing = await resolveWalletHoldings({
    accountId,
    keys: walletsOf(planned),
    createKeys: [],
    listHoldings: deps.listHoldings,
    ensureHoldings: deps.ensureHoldings,
  });
  const kept: PlannedPayRow[] = [];

  for (const row of planned) {
    const holding = existing.get(row.wallet);

    if (holding !== undefined && (await duplicatesCapitalRow(context, holding.id, row))) {
      noticeOnce(context, 'pay-overlap-skip');
    } else {
      kept.push(row);
    }
  }

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

type WindowOutcome = { kind: 'committed'; imported: number } | { kind: 'stop' };

/**
 * Run one window: read and plan it, then either commit (rows first, watermark second,
 * so a crash between the two just re-imports idempotently) or stop without committing.
 */
const runOneWindow = async (context: PayContext, window: WalkWindow): Promise<WindowOutcome> => {
  let rows: BinanceTransactionRow[];

  try {
    const orders = await fetchWindowOrders(context, window);

    if (orders === undefined) {
      return { kind: 'stop' };
    }

    rows = await placeRows(context, plannedRowsOf(context, orders));
  } catch (error) {
    if (error instanceof BinanceWalkStop) {
      logWalkStop(error.code);

      return { kind: 'stop' };
    }

    throw error;
  }

  let imported = 0;

  if (rows.length > 0) {
    imported = await context.deps.addTransactions(rows);
  }

  await context.deps.writeWalkCursor(context.spot.id, BINANCE_PAY_HISTORY_CURSOR_FIELD, window.end);

  return { kind: 'committed', imported };
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

  // A Pay row is only judged against capital rows that are already stored, so a window
  // never reaches past the capital walk's watermark.
  const capitalCursor = binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, spot.metadata);

  if (capitalCursor === null) {
    return { imported: 0, complete: false };
  }

  const endTime = Math.min(now, capitalCursor);
  const windows = buildWalkWindows(
    resolveWalkStart({
      cursor: binanceWalkCursorOf(BINANCE_PAY_HISTORY_CURSOR_FIELD, spot.metadata),
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
    capitalRowsByHolding: new Map<string, CapitalRow[]>(),
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

    if (outcome.kind === 'stop') {
      return { imported, complete: false };
    }

    imported += outcome.imported;
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
