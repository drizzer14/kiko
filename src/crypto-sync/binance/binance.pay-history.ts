import { rethrow } from 'fnts';
import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import {
  BinanceWalkStop,
  type ExchangeStateDeps,
  exchangeStateDepsOf,
  halfOf,
  instantAt,
  joinSettled,
  logWalkStop,
  multiCoinPatchesOf,
  planWalkPasses,
  readPendingMark,
  readWalkMarks,
  readWalkRoundRobins,
  rowMinorUnits,
  settleRecords,
  settleUnreadable,
  type SpanCommit,
  type SpanRead,
  walkMarkWriterOf,
  type WalkPass,
  type WalkResult,
  type WalkWindow,
} from '@kiko/crypto-sync/exchange/walk';
import type { HoldingRow } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';
import { type ExchangeHolding, holdingsRepo } from '@kiko/holdings/repo';

import {
  type BinanceAccount,
  BINANCE_ASSET,
  BinanceRateLimitError,
  fetchAccount,
  type FetchAccountOptions,
} from './binance.client';
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
  type BinancePayOrder,
  directionOfAmount,
  fetchPayHistory,
  PAY_PAGE_LIMIT,
  type PayHistoryPage,
} from './binance.history-client';
import { isTrackedBinanceAsset } from './binance.tracked-coin';
import { type BinanceWallet, holdingKeyOf } from './binance.holding-keys';
import { type BinanceCredentials, readCredentials } from './binance.credentials';
import { isBinanceCoolingDown, setBinanceCooldownUntil } from './binance.cooldown';
import { type BinanceHistoryRun, COSTS, recordFailedCall } from './binance.history-budget';

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

/** The stop of an item the client could not read: logged by its code alone, never its content. */
const PAY_ROW_UNREADABLE = 'pay-row-unreadable';

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

/**
 * Whether the user paid or received an order, from the user's own uid alone: the payer's
 * Binance id is the uid for an outgoing order, the receiver's for an incoming one. The
 * shape of the parties is no signal (a real incoming C2C order names the counterparty as
 * payer too), so an unknown uid, a uid that matches neither party or both, and a sign
 * that disagrees with the uid are all no direction. `null` means the window stops. The
 * party ids are read for this rule alone; they are never stored or logged.
 */
export const payDirection = (order: BinancePayOrder, uid: string | null): PayDirection | null => {
  const sign = directionOfAmount(order.amount);
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
  const counterparty = match(direction)
    .with('out', () => order.receiverInfo)
    .with('in', () => order.payerInfo)
    .exhaustive();

  return counterparty.name?.trim() || PAY_BRAND;
};

const FUNDING_WALLET_TYPE = 1;

const SPOT_WALLET_TYPE = 2;

const EARN_WALLET_TYPE = 5;

/**
 * A receive carries no field that says which wallet took it (`walletType` and `walletTypes`
 * may describe the payer), so its time decides: Spot from this UTC midnight, Funding before.
 * Where the date comes from: kiko-architecture, the Binance Pay section.
 */
const PAY_RECEIPTS_TO_SPOT_FROM_MS = Date.UTC(2026, 8, 29);

/** Binance's wallet ids for a Pay order: 2 Spot, 1 Funding, 5 Earn. Any other is untracked. */
const walletOf = (walletType: number): BinanceWallet =>
  match(walletType)
    .returnType<BinanceWallet>()
    .with(SPOT_WALLET_TYPE, () => 'spot')
    .with(FUNDING_WALLET_TYPE, () => 'funding')
    .with(EARN_WALLET_TYPE, () => 'earn')
    .otherwise(() => {
      throw new BinanceWalkStop('pay-wallet-unknown');
    });

/** What a wallet paid or took, in the minor units of the coin it is placed in. */
type WalletShare = { walletType: number; units: number };

type FundsEntry = BinancePayOrder['fundsDetail'][number];

/** The funds entries of one tracked coin, which are placed together. */
type CoinFunds = { coin: Currency; entries: FundsEntry[] };

/** One coin of an order, placed on the wallets that paid it or took it. */
type CoinShares = { coin: Currency; shares: WalletShare[] };

/** What an order's amount is in its own coin, which is a tracked one. */
type OrderAmount = { coin: Currency; units: number };

/** What a wallet paid, as Binance's decimal text, before any rounding to the coin's scale. */
type WalletCost = { walletType: number; amount: string };

/**
 * `sum` plus `amount`, exactly. The coin's own read of `amount` comes first: it stops a text
 * the sum could not parse, and a coin stored at its own scale refuses digits past it there.
 */
const addAmount = (coin: Currency, sum: string, amount: string): string => {
  rowMinorUnits(coin, amount);

  return addDecimal(sum, amount);
};

/**
 * `addAmount`, but a negative `amount` stops the walk once its text has read: a sign error, and
 * left to the sum it could cancel a positive amount or turn a row negative.
 */
const addNonNegative = (coin: Currency, sum: string, amount: string): string => {
  const next = addAmount(coin, sum, amount);

  if (compareDecimal(amount, '0') < 0) {
    throw new BinanceWalkStop('pay-amount-invalid');
  }

  return next;
};

/**
 * What a coin's funds entries say each wallet paid, exactly: the wallets with a cost above zero.
 * Rounding happens once, on a sum (`sharesFromCosts`), never on each cost, because the costs of
 * a coin stored at a reduced scale can each round on their own to more or less than their total.
 */
const costsOf = (coin: Currency, entries: FundsEntry[]): WalletCost[] => {
  const amountByWallet = new Map<number, string>();

  for (const cost of entries.flatMap((entry) => entry.walletAssetCost)) {
    amountByWallet.set(
      cost.walletType,
      addNonNegative(coin, amountByWallet.get(cost.walletType) ?? '0', cost.amount),
    );
  }

  return [...amountByWallet]
    .filter(([, amount]) => compareDecimal(amount, '0') > 0)
    .map(([walletType, amount]) => ({ walletType, amount }));
};

const declaredWalletsOf = (order: BinancePayOrder): number[] => [
  ...new Set(order.walletTypes ?? []),
];

/**
 * The wallets an order names. Binance sends `walletType` as 1 even on a split order, so it
 * is only the fallback for an order that sends no `walletTypes`.
 */
const namedWalletsOf = (order: BinancePayOrder): number[] => {
  const declared = declaredWalletsOf(order);

  if (declared.length > 0 || order.walletType === undefined) {
    return declared;
  }

  return [order.walletType];
};

/**
 * What a send paid from: the wallets with a cost above zero. They must be among the
 * wallets the order names and their costs, summed exactly and rounded once, must come to `units`,
 * or the order is one this walk cannot place. A named wallet with no cost is left out: a send is
 * paid from the wallets that were charged, and `walletTypes` can list one that was not.
 *
 * Each wallet's share is the step the rounded running sum takes at it, the wallets taken in
 * ascending order so the shares do not depend on the order Binance lists them in. The shares
 * add up to the rounded total whatever the scale, and a share that rounds to nothing has no row.
 */
const sharesFromCosts = (input: {
  coin: Currency;
  costs: WalletCost[];
  wallets: number[];
  units: number;
}): WalletShare[] => {
  const { coin, costs, wallets, units } = input;
  const ascending = [...costs].sort((a, b) => a.walletType - b.walletType);
  const runningUnits = ascending.map((_cost, index) =>
    rowMinorUnits(
      coin,
      ascending.slice(0, index + 1).reduce((sum, cost) => addDecimal(sum, cost.amount), '0'),
    ),
  );
  const costedOnNamed = costs.every((cost) => wallets.includes(cost.walletType));

  if (!costedOnNamed || (runningUnits.at(-1) ?? 0) !== units) {
    throw new BinanceWalkStop('pay-split-mismatch');
  }

  const unitsByWallet = new Map(
    ascending.map((cost, index) => [
      cost.walletType,
      runningUnits[index] - (runningUnits[index - 1] ?? 0),
    ]),
  );

  return costs
    .map(({ walletType }) => ({ walletType, units: unitsByWallet.get(walletType) ?? 0 }))
    .filter((share) => share.units > 0);
};

/**
 * The wallet a receive lands on, by the order's time alone (see
 * `PAY_RECEIPTS_TO_SPOT_FROM_MS`). No wallet field and no cost is read: they describe the
 * payer's side, and a receive that names two wallets is placed like any other.
 */
const shareOfReceive = (order: BinancePayOrder, units: number): WalletShare[] => [
  {
    walletType:
      order.transactionTime < PAY_RECEIPTS_TO_SPOT_FROM_MS ? FUNDING_WALLET_TYPE : SPOT_WALLET_TYPE,
    units,
  },
];

/**
 * What one coin of a send must add up to: the order amount when every funds entry is in the
 * order's own coin (or none is listed), else the coin's own funds entries, since a send paid in
 * another coin, or in several, has no amount of that coin to compare with. `undefined` is the
 * second case.
 */
const ownUnitsOf = (order: BinancePayOrder, amount: OrderAmount | undefined): number | undefined =>
  foldMap(maybe(amount), ({ coin, units }) =>
    order.fundsDetail.every((entry) => entry.currency === coin) ? units : undefined,
  );

/**
 * The wallets one coin of a send was paid from. An order that carries no cost entry of the coin
 * at all, with `walletTypes` naming exactly one wallet, was paid whole from that wallet when the
 * coin's funds add up to what it must (an empty funds detail adds up to nothing, so it cannot
 * show that the whole amount was paid in the order's coin); without a cost entry, any other
 * shape leaves the wallet unknown. An entry that rounds to nothing at the coin's scale is no row.
 * An order amount of 0 units is dust, so funds of its own coin above dust stop whatever their cost
 * shape: costs and wallets cannot show the dust is what was paid. Only an order whose funds are all
 * in its own coin reaches this with `orderUnits` 0, which BTC's scale never gives. A funds entry
 * with a negative amount stops whatever its cost shape: a sign error, as a negative cost is, and
 * left to the sum it could cancel a positive entry or turn a row negative.
 */
const sharesOfCoin = (input: {
  funds: CoinFunds;
  wallets: number[];
  declared: number[];
  orderUnits: number | undefined;
}): WalletShare[] => {
  const { funds, wallets, declared, orderUnits } = input;
  const { coin, entries } = funds;
  const entrySum = entries.reduce((sum, entry) => addNonNegative(coin, sum, entry.amount), '0');
  const entryUnits = (): number => rowMinorUnits(coin, entrySum);

  if (orderUnits === 0 && entryUnits() !== 0) {
    throw new BinanceWalkStop('pay-split-mismatch');
  }

  if (entries.every((entry) => entry.walletAssetCost.length === 0) && declared.length === 1) {
    const units = entryUnits();

    if (units !== (orderUnits ?? units)) {
      throw new BinanceWalkStop('pay-split-mismatch');
    }

    return units > 0 ? [{ walletType: declared[0], units }] : [];
  }

  return sharesFromCosts({
    coin,
    costs: costsOf(coin, entries),
    wallets,
    units: orderUnits ?? entryUnits(),
  });
};

/**
 * The tracked coins a send's funds name, each with its entries, in the order they first appear.
 * A send that lists no funds at all is placed in its own coin, where it can only stop, unless its
 * amount is dust, which has nothing to place. A coin the walk does not track has no row.
 */
const fundsToPlace = (order: BinancePayOrder, amount: OrderAmount | undefined): CoinFunds[] => {
  if (order.fundsDetail.length === 0) {
    return (
      foldMap(maybe(amount), ({ coin, units }) => (units > 0 ? [{ coin, entries: [] }] : [])) ?? []
    );
  }

  const entriesByCoin = new Map<Currency, FundsEntry[]>();

  for (const entry of order.fundsDetail) {
    if (isTrackedBinanceAsset(entry.currency)) {
      entriesByCoin.set(entry.currency, [...(entriesByCoin.get(entry.currency) ?? []), entry]);
    }
  }

  return [...entriesByCoin].map(([coin, entries]) => ({ coin, entries }));
};

/**
 * The wallets a send's money comes from, per coin: one row per tracked coin its funds name,
 * each placed by the rules above. Funds in no tracked coin give no row. (A receive's funds are
 * the payer's, whatever coin they are in; they say nothing of what the user received.)
 */
const sharesOfSend = (order: BinancePayOrder, amount: OrderAmount | undefined): CoinShares[] => {
  const coins = fundsToPlace(order, amount);

  if (coins.length === 0) {
    return [];
  }

  const wallets = namedWalletsOf(order);

  if (wallets.length === 0) {
    throw new BinanceWalkStop('pay-wallet-unknown');
  }

  const declared = declaredWalletsOf(order);
  const orderUnits = ownUnitsOf(order, amount);

  return coins.map((funds) => ({
    coin: funds.coin,
    shares: sharesOfCoin({ funds, wallets, declared, orderUnits }),
  }));
};

/** A receive is one row in the order's own coin, when that coin is tracked and it is not dust. */
const sharesOfReceive = (order: BinancePayOrder, amount: OrderAmount | undefined): CoinShares[] =>
  foldMap(maybe(amount), ({ coin, units }) =>
    units > 0 ? [{ coin, shares: shareOfReceive(order, units) }] : [],
  ) ?? [];

const sharesOf = (
  order: BinancePayOrder,
  direction: PayDirection,
  amount: OrderAmount | undefined,
): CoinShares[] =>
  match(direction)
    .with('out', () => sharesOfSend(order, amount))
    .with('in', () => sharesOfReceive(order, amount))
    .exhaustive();

const signedUnits = (direction: PayDirection, units: number): number =>
  match(direction)
    .with('out', () => -units)
    .with('in', () => units)
    .exhaustive();

/**
 * What a tracked coin's order is worth in that coin. An order of any other coin has none: its
 * scale is unknown, so its amount is never read beyond its sign (`payDirection`). An order whose
 * amount rounds to nothing at its coin's scale keeps its coin with 0 units: it is dust that has no
 * row and does not stop the walk, but the funds of its own coin must still come to nothing too.
 */
const orderAmountOf = (order: BinancePayOrder): OrderAmount | undefined => {
  const { currency } = order;

  return isTrackedBinanceAsset(currency)
    ? { coin: currency, units: Math.abs(rowMinorUnits(currency, order.amount)) }
    : undefined;
};

const LEADING_MINUS = /^-/;

/**
 * The key of a row. The BTC row of a BTC order keeps the key it always had, so a row already
 * stored is refreshed in place; every other row adds its coin, which keeps the rows of one
 * order apart.
 */
const rowKeyOf = (input: {
  accountId: string;
  order: BinancePayOrder;
  walletType: number;
  coin: Currency;
}): string => {
  const { accountId, order, walletType, coin } = input;
  const key = `${accountId}:pay:${order.orderType}:${order.transactionId}:${walletType}`;

  return coin === BINANCE_ASSET && order.currency === BINANCE_ASSET ? key : `${key}:${coin}`;
};

/**
 * A row in a coin other than the order's own says which order it paid: the order's amount as
 * Binance wrote it, less the sign, and its code, with no words. It is written on insert only.
 */
const crossCoinNoteOf = (order: BinancePayOrder, coin: Currency): { comment?: string } =>
  coin === order.currency
    ? {}
    : { comment: `${order.amount.trim().replace(LEADING_MINUS, '')} ${order.currency}` };

/** A row mapped from an order, before its wallet is turned into a holding. */
type PlannedPayRow = {
  wallet: string;
  amountMinorUnits: number;
  time: number;
  externalId: string;
  description: string;
  comment?: string;
};

/**
 * The rows of one order, one per coin and wallet it was paid from or into. An order the
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

  const amount = orderAmountOf(order);
  const description = payDescription(order, direction);

  return sharesOf(order, direction, amount).flatMap(({ coin, shares }) =>
    shares.map((share) => ({
      wallet: holdingKeyOf(coin, walletOf(share.walletType)),
      amountMinorUnits: signedUnits(direction, share.units),
      time: order.transactionTime,
      externalId: rowKeyOf({ accountId, order, walletType: share.walletType, coin }),
      description,
      ...crossCoinNoteOf(order, coin),
    })),
  );
};

/**
 * The injectable seams of the Pay walk: the credential, holding and uid reads, the Pay
 * read, the insert-only holding creation, the deduping import, and the walk state read and
 * write. Pacing and the weight budget come from the run.
 */
export type BinancePayHistoryDeps = ExchangeStateDeps & {
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
};

const defaultPayHistoryDeps: BinancePayHistoryDeps = {
  ...exchangeStateDepsOf('binance'),
  now: () => Date.now(),
  fetchImpl: fetch,
  readCredentials,
  listHoldings: async (accountId) => holdingsRepo.listByAccountQuery(accountId),
  fetchAccount,
  fetchPayHistory,
  ensureHoldings: (holdings) => holdingsRepo.ensureExchangeHoldings(holdings),
  addTransactions: (rows) => transactionsRepo.addManyDedup(rows),
};

type PayContext = BinanceWalkContext<BinancePayHistoryDeps> & { uid: string };

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
 * rate-limited. `keep` calls stay unspent for the passes that come later in the run.
 */
const fetchSpan = async (
  context: PayContext,
  span: WalkWindow,
  keep: number,
): Promise<PayHistoryPage | undefined> => {
  const { deps, run, apiKey, secret, options } = context;

  if (!run.budget.canAfford('pay', COSTS.pay, keep)) {
    return undefined;
  }

  try {
    await run.gate.wait();
    const page = await deps
      .fetchPayHistory(apiKey, secret, { startTime: span.start, endTime: span.end }, options)
      .catch(rethrow(() => recordFailedCall(run, 'pay')));
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
 * The tickers the orders of a page name that the walk does not track: the coin of an order read
 * strictly that is not tracked (a send in it is paid in a tracked coin, a receive of it has no
 * row), a coin of the funds of a send that is not tracked, and the tickers of an order counted
 * and never read. The funds of a receive are the payer's, and an order with no direction has
 * none the walk can place, so each names only its own coin: the direction of an order read
 * strictly is the uid's (`payDirection`), and that of an order never read is its amount's sign,
 * as it has no parties.
 */
const untrackedTickersOf = (page: PayHistoryPage, uid: string): string[] => [
  ...page.rows.flatMap((order) =>
    (payDirection(order, uid) === 'out'
      ? [order.currency, ...order.fundsDetail.map((entry) => entry.currency)]
      : [order.currency]
    ).filter((ticker) => !isTrackedBinanceAsset(ticker)),
  ),
  ...page.untracked.flatMap((order) =>
    order.direction === 'out' ? order.tickers : order.tickers.slice(0, 1),
  ),
];

/**
 * The orders of one page, each on its own (see `settleRecords`). An order counted and never read
 * gives no row, no stop and no owed ground. A page that is still full once its span cannot be
 * halved (one millisecond) may hold more orders than it shows: that is no one order's stop, so
 * the whole span is owed.
 */
const settledOrdersOf = (context: PayContext, span: WalkWindow, page: PayHistoryPage) =>
  joinSettled<PlannedPayRow>([
    ...(page.gathered >= PAY_PAGE_LIMIT
      ? [{ rows: [], codes: ['pay-page-stuck'], owed: [span], returned: [] }]
      : []),
    settleRecords({
      span,
      records: page.rows,
      rowsOf: (order) => payRowsOf({ accountId: context.accountId, order, uid: context.uid }),
      extentOf: (order) => instantAt(order.transactionTime),
    }),
    settleUnreadable({
      span,
      unreadable: page.unreadable,
      code: PAY_ROW_UNREADABLE,
      extentOf: (row) => foldMap(maybe(row.time), (time) => instantAt(Number(time))),
    }),
    settleRecords({
      span,
      records: page.untracked,
      rowsOf: () => [],
      extentOf: (order) => instantAt(order.transactionTime),
    }),
    {
      rows: [],
      codes: [],
      owed: [],
      returned: [],
      untracked: untrackedTickersOf(page, context.uid),
    },
  ]);

/**
 * Commit one span's page: place and write the rows of the orders the walk can trust, then move
 * the walk's marks (see `commitSettledSpan`: rows first, marks second, so a crash between the
 * two just re-imports idempotently, and an order the walk cannot trust stays owed at its own
 * point, or stops the forward pass). One row per key: an order on the boundary of two spans is
 * read twice.
 */
const commitSpan = (
  context: PayContext,
  span: WalkWindow,
  page: PayHistoryPage,
  pass: WalkPass,
): Promise<SpanCommit | undefined> =>
  commitBinanceSpan({
    context,
    pass,
    span,
    settled: settledOrdersOf(context, span, page),
    place: walletPlacerOf(context, 'pay-holding-missing'),
    restartMs: HISTORY_FLOOR_MS,
  });

/**
 * Read one span. A full page (it may hold more than it shows) is answered with the half
 * to read instead, so a page that is not full is the whole of its span whatever order
 * Binance sorts in and whichever end of the range it leaves open. A span of one
 * millisecond that is still full stops the walk rather than skip.
 */
const readSpan = async (
  context: PayContext,
  span: WalkWindow,
  keep: number,
): Promise<SpanRead<PayHistoryPage> | undefined> => {
  const page = await fetchSpan(context, span, keep);

  if (page === undefined) {
    return undefined;
  }

  const half = halfOf(span);

  return page.gathered >= PAY_PAGE_LIMIT && half !== undefined
    ? { kind: 'split', half }
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

  const credentials = await deps.readCredentials(accountId);

  if (credentials === undefined) {
    return { imported: 0, complete: true };
  }

  const stored = await readWalkMarks(deps, accountId, 'pay');

  const { cursor: payCursor, rescan: rescanCursor } = stored;
  const write = walkMarkWriterOf(deps, accountId, 'pay');
  const roundRobins = await readWalkRoundRobins({ stored, write });
  const floorMs = payFloorMs(now);
  const pending = await readPendingMark({
    stored: stored.pending,
    owedIfUnreadable: { start: floorMs, end: payCursor ?? floorMs },
    write,
  });
  const plan = planWalkPasses({
    cursor: payCursor,
    rescanCursor,
    pointCursor: roundRobins.pointCursor,
    rangeCursor: roundRobins.rangeCursor,
    pending,
    floorMs,
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
    apiKey,
    secret,
    options: { fetchImpl: deps.fetchImpl, now: deps.now },
    marks: {
      cursor: payCursor,
      rescanCursor,
      ...roundRobins,
      pending,
      multiCoinPatches: multiCoinPatchesOf({ stored, planCursor: payCursor }),
    },
    plan,
    write,
  };
  const uid = await readOwnUid(base);

  if (uid === undefined) {
    return { imported: 0, complete: false };
  }

  const context: PayContext = { ...base, uid };

  return runBinanceWalkPlan({
    context,
    lane: 'pay',
    cost: COSTS.pay,
    read: (_window, span, keepCalls) => readSpan(context, span, keepCalls),
    commit: (_window, span, page, pass) => commitSpan(context, span, page, pass),
  });
};

/**
 * Import the user's Binance Pay history, in every tracked coin, as transactions on the wallet
 * each order names (Spot, Funding or Earn), committing a window's rows before advancing the mark
 * past it. A run goes forward from the watermark first, then reads the overlap ground
 * earlier runs left owed, then re-scans the last window behind the watermark, each on what
 * budget is left (see `planWalkPasses`). `complete: false` means history, owed ground or
 * the re-scan remains and a later run resumes from the stored watermark, owed ranges and
 * re-scan mark; a failure other than a rate limit rejects, so the caller can log it
 * without failing the balance sync.
 */
export const syncBinancePayHistory = (
  request: { targetAccountId: string; run: BinanceHistoryRun },
  overrides: Partial<BinancePayHistoryDeps> = {},
): Promise<WalkResult> =>
  runSync({ ...defaultPayHistoryDeps, ...overrides }, request.targetAccountId, request.run);
