import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldMap, eitherSync } from 'fnts/either';
import type { UnreadableRow } from '@kiko/crypto-sync/exchange/walk';
import type { TotalPage as ExchangeTotalPage } from '@kiko/crypto-sync/exchange/paging';

import {
  BINANCE_ASSET,
  type FetchAccountOptions,
  type SignedPage,
  signedRequestPage,
  usedWeightsFromHeaders,
} from './binance.client';
import { binanceTickerOf, isTrackedBinanceAsset } from './binance.tracked-coin';

/**
 * The message of every unexpected response shape. It is fixed on purpose: a URL
 * or a body in it would carry an amount, a name, or an id into a log.
 */
export const BINANCE_HISTORY_PARSE_ERROR = 'Binance history response malformed';

/**
 * A class of its own, because a swallowed failure logs only the error's name and
 * code: a bare `Error` would log as `Error`, with nothing to tell it from any other.
 */
export class BinanceHistoryParseError extends Error {
  constructor() {
    super(BINANCE_HISTORY_PARSE_ERROR);
    this.name = 'BinanceHistoryParseError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BinanceHistoryParseError.prototype);
  }
}

const parseFailure = (): never => {
  throw new BinanceHistoryParseError();
};

type Reader<Value> = (value: unknown) => Value;

const text: Reader<string> = (value) => (typeof value === 'string' ? value : parseFailure());

const textOrEmpty: Reader<string> = (value) => (typeof value === 'string' ? value : '');

const optionalText: Reader<string | undefined> = (value) =>
  typeof value === 'string' ? value : undefined;

const flag: Reader<boolean> = (value) => (typeof value === 'boolean' ? value : parseFailure());

const finiteNumber: Reader<number> = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : parseFailure();

const optionalFiniteNumber: Reader<number | undefined> = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const integer: Reader<number> = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : parseFailure();

/**
 * Binance sends an id as a string or, on some endpoints, as a JSON integer. An
 * empty string and an integer past 2^53 are no id, so a caller that keys a row by
 * it never keys on a mangled value.
 */
const optionalIdentifier: Reader<string | undefined> = (value) => {
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
};

const identifier: Reader<string> = (value) => optionalIdentifier(value) ?? parseFailure();

const identifierOrEmpty: Reader<string> = (value) => optionalIdentifier(value) ?? '';

/** A string, or a number kept as it is: a datetime text, or epoch milliseconds. */
const textOrNumber: Reader<string | number> = (value) =>
  typeof value === 'string' ? value : finiteNumber(value);

/**
 * An absent field (undefined or null) reads as `undefined`; any other value must
 * satisfy `read`.
 */
const optional =
  <Value>(read: Reader<Value>): Reader<Value | undefined> =>
  (value) =>
    foldMap(maybe(value), read);

/** Absent when null or left out; a value of another JSON type than text is no text. */
const strictOptionalText = optional(text);

const strictOptionalFlag = optional(flag);

const listOf =
  <Item>(readItem: Reader<Item>): Reader<Item[]> =>
  (value) =>
    Array.isArray(value) ? value.map((item) => readItem(item)) : parseFailure();

type FieldReaders = Record<string, Reader<unknown>>;

type Parsed<Readers extends FieldReaders> = {
  [Field in keyof Readers]: ReturnType<Readers[Field]>;
};

/**
 * Parse a record by naming each field to read. A field outside `readers` is never
 * touched, so nothing the response carries beyond them (an email, a card number)
 * can reach a parsed row.
 */
const recordReader =
  <Readers extends FieldReaders>(readers: Readers): Reader<Parsed<Readers>> =>
  (value) =>
    isRecord(value)
      ? (Object.fromEntries(
          Object.entries(readers).map(([field, read]) => [field, read(value[field])]),
        ) as Parsed<Readers>)
      : parseFailure();

/** The weights Binance reports on a response, which a page carries (`usedWeightsFromHeaders`). */
export type BinancePageWeights = {
  usedUidWeight1m: number | undefined;
  usedIpWeight1m: number | undefined;
  /** The `/api/*` weight (`X-MBX-USED-WEIGHT-1M`); only the public price reads carry it. */
  usedApiWeight1m?: number | undefined;
};

/**
 * One page of one window, with the minute's spent weight when Binance reports it. `rows` are the
 * rows that parsed; every other row is in `unreadable`, so one malformed row never fails the read.
 */
export type HistoryPage<Row> = {
  rows: Row[];
  unreadable: UnreadableRow[];
} & BinancePageWeights;

/**
 * A page of a `{ rows, total }` endpoint, paged by `current`. `gathered` counts every row of the
 * page, of any asset and unreadable ones too: `total` counts them all, so the pager compares the
 * two. `rows` are the BTC rows that parsed.
 */
export type TotalPage<Row> = ExchangeTotalPage<Row, BinancePageWeights>;

type Reading<Value> = { value: Value } | { unreadable: UnreadableRow };

type TimeReader = Reader<UnreadableRow['time']>;

/**
 * Read one item of a page: the parsed value, or, when `read` rejects it, the item as an
 * `UnreadableRow` carrying only the time `timeOf` finds in it.
 */
const readingOf =
  <Value>(read: Reader<Value>, timeOf: TimeReader) =>
  (item: unknown): Reading<Value> =>
    bifoldMap(
      eitherSync<unknown, Value>(() => read(item)),
      (): Reading<Value> => ({ unreadable: { time: timeOf(item) } }),
      (value): Reading<Value> => ({ value }),
    );

const readingsOf = <Value>(
  items: unknown,
  read: Reader<Value>,
  timeOf: TimeReader,
): Reading<Value>[] => (Array.isArray(items) ? items.map(readingOf(read, timeOf)) : parseFailure());

const valuesOf = <Value>(readings: Reading<Value>[]): Value[] =>
  readings.flatMap((reading) => ('value' in reading ? [reading.value] : []));

const unreadableOf = <Value>(readings: Reading<Value>[]): UnreadableRow[] =>
  readings.flatMap((reading) => ('unreadable' in reading ? [reading.unreadable] : []));

/** The time an item's own field holds, as `UnreadableRow` keeps it: `undefined` if unusable. */
const timeFieldOf =
  (field: string, read: TimeReader): TimeReader =>
  (item) =>
    isRecord(item) ? read(item[field]) : undefined;

const epochTime: TimeReader = optionalFiniteNumber;

const epochOrDatetimeTime: TimeReader = (value) =>
  typeof value === 'string' ? value : optionalFiniteNumber(value);

/**
 * A row of another asset is counted for the pager and never parsed (`undefined`): it can be off
 * contract in any way without stalling the BTC rows. A row with no string asset is not one of
 * another asset, and the strict reader rejects it.
 */
const btcRowOf =
  <Row>(readRow: Reader<Row>): Reader<Row | undefined> =>
  (item) =>
    isRecord(item) && typeof item.asset === 'string' && item.asset !== BINANCE_ASSET
      ? undefined
      : readRow(item);

/**
 * Transfer and Earn rows: the BTC rows parse strictly, and one that does not goes to
 * `unreadable` with its own time field, so a malformed row never fails the read. A malformed
 * envelope (a body or `rows` that is no list, a `total` that is no number) still does.
 */
const totalPage =
  <Row>(readRow: Reader<Row>, timeOf: TimeReader) =>
  ({ body, headers }: SignedPage): TotalPage<Row> => {
    if (!isRecord(body)) {
      return parseFailure();
    }

    const readings = readingsOf(body.rows ?? [], btcRowOf(readRow), timeOf);

    return {
      rows: valuesOf(readings).flatMap((row) => row ?? []),
      unreadable: unreadableOf(readings),
      gathered: readings.length,
      total: finiteNumber(body.total),
      ...usedWeightsFromHeaders(headers),
    };
  };

/**
 * Binance caps the deposit/withdraw history page at 1000 rows (the default too).
 * A page of exactly this many rows means "there may be more" — the caller pages
 * on `offset` until a short page. Exported so the offset-paging walk in
 * `binance.transactions.ts` uses the SAME limit the request sends.
 */
export const HISTORY_PAGE_LIMIT = 1000;

/**
 * One offset page of a ≤90-day history window. Both capital endpoints share this
 * shape: `startTime`/`endTime` bound the window (the API rejects a span of 90
 * days or more), `offset` pages within it.
 */
export type HistoryWindow = { startTime: number; endTime: number; offset: number };

const capitalParams = (window: HistoryWindow): Record<string, string> => ({
  startTime: String(window.startTime),
  endTime: String(window.endTime),
  offset: String(window.offset),
  limit: String(HISTORY_PAGE_LIMIT),
});

/**
 * A capital record of a coin the walk does not track: counted for the pager, never parsed, so it
 * can be off contract in any way without stalling the tracked rows. Only what the walk needs is
 * kept: the upper-cased ticker (empty for a record that is not settled and has no usable coin),
 * the `status` (`undefined` unless it is a finite number, so the walk lists the coin only once the
 * record is settled) and the time field as it stands (a number, a datetime text for a withdrawal,
 * or `undefined`), which says where the record sits in a span.
 */
export type BinanceUntrackedRecord = {
  ticker: string;
  status: number | undefined;
  time: UnreadableRow['time'];
};

/**
 * One page of a capital endpoint: the tracked rows that parsed, the rows it could not read, and the
 * records of other coins, which a full page counts like any other row.
 */
export type CapitalPage<Row> = HistoryPage<Row> & { untracked: BinanceUntrackedRecord[] };

type CapitalItem<Row> = { row: Row } | { untracked: BinanceUntrackedRecord };

/** Binance's own settled states: a credited deposit, a completed withdrawal. */
export const DEPOSIT_STATUS_SUCCESS = 1;
export const WITHDRAW_STATUS_COMPLETED = 6;

/** What differs between the two capital endpoints: the time field, how to read it, what settles. */
type CapitalField = { time: string; readTime: TimeReader; settledStatus: number };

/**
 * A capital row is read by its `coin`, upper-cased once. A tracked coin (`isTrackedBinanceAsset`)
 * parses strictly, and a malformed row is unreadable and owed. Any other row is counted and never
 * parsed, but a SETTLED row with no string coin, or a blank one, cannot be told from a row of a
 * tracked coin, so it is unreadable and owed. A row that is not settled yet (no row of it can be
 * imported) is counted whatever its coin, with an empty ticker when it has none.
 */
const capitalItemOf =
  <Row>(
    readRow: Reader<Row>,
    { time: timeField, readTime, settledStatus }: CapitalField,
  ): Reader<CapitalItem<Row>> =>
  (item) => {
    if (!isRecord(item)) {
      return parseFailure();
    }

    const ticker = typeof item.coin === 'string' ? binanceTickerOf(item.coin) : '';

    if (isTrackedBinanceAsset(ticker)) {
      return { row: readRow(item) };
    }

    const status = optionalFiniteNumber(item.status);

    if (ticker === '' && status === settledStatus) {
      return parseFailure();
    }

    return { untracked: { ticker, status, time: readTime(item[timeField]) } };
  };

const capitalPage =
  <Row>(readRow: Reader<Row>, field: CapitalField) =>
  ({ body, headers }: SignedPage): CapitalPage<Row> => {
    const readings = readingsOf(
      body,
      capitalItemOf(readRow, field),
      timeFieldOf(field.time, field.readTime),
    );
    const items = valuesOf(readings);

    return {
      rows: items.flatMap((item) => ('row' in item ? [item.row] : [])),
      unreadable: unreadableOf(readings),
      untracked: items.flatMap((item) => ('untracked' in item ? [item.untracked] : [])),
      ...usedWeightsFromHeaders(headers),
    };
  };

/**
 * `walletType` is 0 for Spot and 1 for Funding. `txId` is empty for a movement
 * with no on-chain hash. The read is account-wide, so `coin` names the asset of each record: a
 * record with no coin cannot be told from one of a coin that is not tracked, so it is unreadable.
 */
const DEPOSIT_FIELDS = {
  id: identifierOrEmpty,
  amount: text,
  coin: text,
  txId: textOrEmpty,
  insertTime: finiteNumber,
  status: finiteNumber,
  walletType: optional(integer),
};

/** One deposit from `/sapi/v1/capital/deposit/hisrec`. `insertTime` is epoch ms. */
export type BinanceDeposit = Parsed<typeof DEPOSIT_FIELDS>;

/**
 * `applyTime` is a UTC datetime STRING ("2019-10-12 11:12:02"), NOT epoch ms — see
 * `parseWithdrawTime` in `binance.transactions.ts`.
 */
const WITHDRAWAL_FIELDS = {
  id: identifierOrEmpty,
  amount: text,
  transactionFee: textOrEmpty,
  coin: text,
  txId: textOrEmpty,
  applyTime: textOrNumber,
  status: finiteNumber,
  walletType: optional(integer),
};

/** One withdrawal from `/sapi/v1/capital/withdraw/history`. */
export type BinanceWithdrawal = Parsed<typeof WITHDRAWAL_FIELDS>;

const depositPage = capitalPage(recordReader(DEPOSIT_FIELDS), {
  time: 'insertTime',
  readTime: epochTime,
  settledStatus: DEPOSIT_STATUS_SUCCESS,
});

const withdrawalPage = capitalPage(recordReader(WITHDRAWAL_FIELDS), {
  time: 'applyTime',
  readTime: epochOrDatetimeTime,
  settledStatus: WITHDRAW_STATUS_COMPLETED,
});

/**
 * `GET /sapi/v1/capital/deposit/hisrec` (deposit history), of every coin, for
 * ONE offset page of ONE window. Signed, read-only. Returns the page; the
 * offset-paging and window walk live in `binance.transactions.ts`.
 */
export const fetchDepositHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<CapitalPage<BinanceDeposit>> =>
  depositPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/capital/deposit/hisrec',
      capitalParams(window),
      options,
    ),
  );

/**
 * `GET /sapi/v1/capital/withdraw/history` (withdrawal history), of every coin,
 * for ONE offset page of ONE window. Signed, read-only. Same window/paging
 * contract as `fetchDepositHistory`; the page carries the minute's spent UID weight
 * the resumable walk budgets its next call against.
 */
export const fetchWithdrawHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<CapitalPage<BinanceWithdrawal>> =>
  withdrawalPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/capital/withdraw/history',
      capitalParams(window),
      options,
    ),
  );

/**
 * Only the nickname and the Binance id are read off a counterparty. The id is read for the
 * direction rule alone and is never stored or logged; email, phone, account id, country, card
 * number, institution and digital-wallet id are never parsed.
 */
const PAY_PARTY_FIELDS = {
  name: optionalText,
  binanceId: optionalIdentifier,
};

/** A Pay order's payer or receiver: a party the order does not name has both fields undefined. */
type BinancePayParty = Parsed<typeof PAY_PARTY_FIELDS>;

const readPayParty = recordReader(PAY_PARTY_FIELDS);

const payParty: Reader<BinancePayParty> = (value) => readPayParty(value ?? {});

const WALLET_ID_PATTERN = /^\d+$/;

/**
 * A Pay wallet id, as a JSON integer or a digit string: the live probe could not match
 * `walletType` against the entries of `walletTypes`, so one of the two is sent as text.
 * Either reads as the number, so the walk compares wallets by value.
 */
const walletId: Reader<number> = (value) =>
  integer(typeof value === 'string' && WALLET_ID_PATTERN.test(value) ? Number(value) : value);

const walletAssetCostEntry = ([key, amount]: [string, unknown]) =>
  WALLET_ID_PATTERN.test(key) && typeof amount === 'string'
    ? { walletType: Number(key), amount }
    : parseFailure();

/**
 * Binance sends the per-wallet cost of a Pay order as a map from wallet id to
 * amount (`{ "1": "0.6", "2": "0.6" }`); the parsed form is one entry per wallet.
 */
const walletAssetCost = (value: unknown): { walletType: number; amount: string }[] =>
  foldMap(maybe(value), (costByWallet) =>
    isRecord(costByWallet)
      ? Object.entries(costByWallet).map(walletAssetCostEntry)
      : parseFailure(),
  ) ?? [];

/**
 * A Pay coin, upper-cased once here like a capital coin (`binanceTickerOf`). A blank one names no
 * coin, so it cannot be told from a tracked coin: it is unreadable, never an untracked one.
 */
const payTicker: Reader<string> = (value) => {
  const ticker = binanceTickerOf(text(value));

  return ticker === '' ? parseFailure() : ticker;
};

const readFundsDetailEntry = recordReader({
  currency: payTicker,
  amount: text,
  walletAssetCost,
});

const PAY_ORDER_FIELDS = {
  orderType: text,
  transactionId: identifierOrEmpty,
  transactionTime: finiteNumber,
  amount: text,
  currency: payTicker,
  walletType: optional(walletId),
  walletTypes: optional(listOf(walletId)),
  fundsDetail: (value: unknown) => foldMap(maybe(value), listOf(readFundsDetailEntry)) ?? [],
  payerInfo: payParty,
  receiverInfo: payParty,
};

/**
 * One order from `/sapi/v1/pay/transactions`. `amount` is signed (positive is
 * income); `transactionId` may be empty, which the walk treats as a stop.
 */
export type BinancePayOrder = Parsed<typeof PAY_ORDER_FIELDS>;

/** Binance caps the Pay history page at 100 orders, and there is no cursor. */
export const PAY_PAGE_LIMIT = 100;

const PAY_SUCCESS_CODE = '000000';

/**
 * A Pay order that no tracked coin is in or was paid in: counted for the pager, never parsed, so
 * it can be off contract in any way without stalling the tracked orders. Only what the walk needs
 * is kept: the upper-cased tickers it names (its own coin first, then each coin of its funds
 * that names one), to list them, and its time as a finite number, or `undefined`, which says
 * where it sits in a span.
 */
export type BinanceUntrackedPayOrder = {
  tickers: string[];
  transactionTime: number | undefined;
};

/**
 * One Pay page. The history lists the orders of EVERY coin. An order is read strictly (`rows`)
 * when its coin or a coin of its funds is tracked, and one that does not parse is `unreadable`,
 * owed. Any other order is in `untracked`. The window walk needs every order of the page, so
 * `gathered` counts all three, a full page of `PAY_PAGE_LIMIT` meaning the window holds more
 * orders than one page returns.
 */
export type PayHistoryPage = HistoryPage<BinancePayOrder> & {
  gathered: number;
  untracked: BinanceUntrackedPayOrder[];
};

type PayItem = { order: BinancePayOrder } | { untracked: BinanceUntrackedPayOrder };

const readTrackedPayOrder = recordReader(PAY_ORDER_FIELDS);

/**
 * The coins a funds list names, whatever else is wrong with it: an entry that is no object or
 * names no usable coin is left out, and a list that is no list names none. An order of an
 * untracked coin must not stall the walk, so nothing here fails.
 */
const fundsTickersOf = (fundsDetail: unknown): string[] =>
  (Array.isArray(fundsDetail) ? fundsDetail : []).flatMap((entry) => {
    const ticker =
      isRecord(entry) && typeof entry.currency === 'string' ? binanceTickerOf(entry.currency) : '';

    return ticker === '' ? [] : [ticker];
  });

const readPayItem: Reader<PayItem> = (value) => {
  if (!isRecord(value)) {
    return parseFailure();
  }

  const ticker = payTicker(value.currency);
  const tickers = [...new Set([ticker, ...fundsTickersOf(value.fundsDetail)])];

  return tickers.some(isTrackedBinanceAsset)
    ? { order: readTrackedPayOrder(value) }
    : { untracked: { tickers, transactionTime: optionalFiniteNumber(value.transactionTime) } };
};

const payPage = ({ body, headers }: SignedPage): PayHistoryPage => {
  const readings = readingsOf(
    isRecord(body) && body.code === PAY_SUCCESS_CODE ? body.data : undefined,
    readPayItem,
    timeFieldOf('transactionTime', epochTime),
  );
  const items = valuesOf(readings);

  return {
    rows: items.flatMap((item) => ('order' in item ? [item.order] : [])),
    unreadable: unreadableOf(readings),
    untracked: items.flatMap((item) => ('untracked' in item ? [item.untracked] : [])),
    gathered: readings.length,
    ...usedWeightsFromHeaders(headers),
  };
};

/**
 * `GET /sapi/v1/pay/transactions` (Pay history) for ONE page of ONE window.
 * Signed, read-only, at most 90 days wide and 18 months deep. The envelope must
 * carry the success code and a `data` array, or the read throws
 * `BinanceHistoryParseError`.
 */
export const fetchPayHistory = async (
  apiKey: string,
  secret: string,
  query: { startTime: number; endTime: number },
  options: FetchAccountOptions = {},
): Promise<PayHistoryPage> =>
  payPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/pay/transactions',
      {
        startTime: String(query.startTime),
        endTime: String(query.endTime),
        limit: String(PAY_PAGE_LIMIT),
      },
      options,
    ),
  );

/**
 * Binance's cap on `size` for the universal-transfer and Simple Earn history
 * reads; `current` starts at 1.
 */
export const HISTORY_TOTAL_PAGE_SIZE = 100;

export type TotalQuery = { startTime: number; endTime: number; current: number };

const totalParams = (query: TotalQuery): Record<string, string> => ({
  startTime: String(query.startTime),
  endTime: String(query.endTime),
  current: String(query.current),
  size: String(HISTORY_TOTAL_PAGE_SIZE),
});

/**
 * Every transfer type that touches the Spot or Funding wallet: the two between
 * them, then the Spot and Funding legs to and from each wallet Kiko does not track.
 */
export const UNIVERSAL_TRANSFER_TYPES = [
  'MAIN_FUNDING',
  'FUNDING_MAIN',
  'MAIN_UMFUTURE',
  'UMFUTURE_MAIN',
  'MAIN_CMFUTURE',
  'CMFUTURE_MAIN',
  'MAIN_MARGIN',
  'MARGIN_MAIN',
  'MAIN_OPTION',
  'OPTION_MAIN',
  'MAIN_PORTFOLIO_MARGIN',
  'PORTFOLIO_MARGIN_MAIN',
  'FUNDING_UMFUTURE',
  'UMFUTURE_FUNDING',
  'FUNDING_CMFUTURE',
  'CMFUTURE_FUNDING',
  'FUNDING_MARGIN',
  'MARGIN_FUNDING',
  'FUNDING_OPTION',
  'OPTION_FUNDING',
] as const;

export type UniversalTransferType = (typeof UNIVERSAL_TRANSFER_TYPES)[number];

const TRANSFER_FIELDS = {
  asset: text,
  amount: text,
  type: text,
  status: text,
  tranId: identifierOrEmpty,
  timestamp: finiteNumber,
};

/**
 * One transfer from `/sapi/v1/asset/transfer`; its `tranId` is kept as text, empty when it is
 * not an id, which the walk stops on.
 */
export type BinanceUniversalTransfer = Parsed<typeof TRANSFER_FIELDS>;

const transferPage = totalPage(recordReader(TRANSFER_FIELDS), timeFieldOf('timestamp', epochTime));

/**
 * `GET /sapi/v1/asset/transfer` (universal transfer history) for ONE page of ONE
 * transfer type in ONE window. The endpoint takes no `asset`, so rows of every
 * coin come back and the walk filters to BTC. Signed, read-only.
 */
export const fetchUniversalTransfers = async (
  apiKey: string,
  secret: string,
  query: TotalQuery & { type: UniversalTransferType },
  options: FetchAccountOptions = {},
): Promise<TotalPage<BinanceUniversalTransfer>> =>
  transferPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/asset/transfer',
      { type: query.type, ...totalParams(query) },
      options,
    ),
  );

const EARN_HISTORY_ROOT = '/sapi/v1/simple-earn';

/**
 * The six Simple Earn history reads. Only the fields a walk uses are read; an id
 * a walk keys a row by is required, and a field it only inspects is optional. A field the
 * walk decides a wallet or a record's meaning by (the two split amounts, a `type`,
 * `isComplete`) is absent only when it is null or left out: one of another JSON type makes
 * the row unreadable, never absent, because absent changes what the walk writes. The
 * flexible rewards read always asks for `type=ALL`: the parameter is optional, but
 * an older doc revision calls it mandatory. The locked rewards read takes none.
 */
const EARN_READS = {
  flexibleSubscription: {
    path: `${EARN_HISTORY_ROOT}/flexible/history/subscriptionRecord`,
    extraParams: {},
    readRow: recordReader({
      amount: text,
      asset: text,
      time: finiteNumber,
      purchaseId: identifier,
      productId: optionalText,
      type: strictOptionalText,
      sourceAccount: optionalText,
      amtFromSpot: strictOptionalText,
      amtFromFunding: strictOptionalText,
      status: text,
    }),
  },
  flexibleRedemption: {
    path: `${EARN_HISTORY_ROOT}/flexible/history/redemptionRecord`,
    extraParams: {},
    readRow: recordReader({
      amount: text,
      asset: text,
      time: finiteNumber,
      projectId: optionalText,
      redeemId: identifier,
      destAccount: optionalText,
      status: text,
    }),
  },
  flexibleRewards: {
    path: `${EARN_HISTORY_ROOT}/flexible/history/rewardsRecord`,
    extraParams: { type: 'ALL' },
    readRow: recordReader({
      asset: text,
      rewards: text,
      projectId: text,
      type: text,
      time: finiteNumber,
    }),
  },
  lockedSubscription: {
    path: `${EARN_HISTORY_ROOT}/locked/history/subscriptionRecord`,
    extraParams: {},
    readRow: recordReader({
      positionId: optionalIdentifier,
      purchaseId: identifier,
      time: finiteNumber,
      asset: text,
      amount: text,
      type: strictOptionalText,
      sourceAccount: optionalText,
      amtFromSpot: strictOptionalText,
      amtFromFunding: strictOptionalText,
      status: text,
    }),
  },
  lockedRedemption: {
    path: `${EARN_HISTORY_ROOT}/locked/history/redemptionRecord`,
    extraParams: {},
    readRow: recordReader({
      positionId: optionalIdentifier,
      redeemId: identifier,
      time: finiteNumber,
      asset: text,
      amount: text,
      originalAmount: optionalText,
      type: strictOptionalText,
      status: text,
      isComplete: strictOptionalFlag,
    }),
  },
  lockedRewards: {
    path: `${EARN_HISTORY_ROOT}/locked/history/rewardsRecord`,
    extraParams: {},
    readRow: recordReader({
      positionId: identifier,
      time: finiteNumber,
      asset: text,
      amount: text,
      type: text,
    }),
  },
};

export type EarnRecordKind = keyof typeof EARN_READS;

export type EarnRecordByKind = {
  [Kind in EarnRecordKind]: ReturnType<(typeof EARN_READS)[Kind]['readRow']>;
};

/**
 * `GET /sapi/v1/simple-earn/{flexible,locked}/history/...` for ONE page of ONE
 * record kind in ONE window (at most 30 days), filtered to BTC. Signed,
 * read-only.
 */
export const fetchEarnRecords = async <Kind extends EarnRecordKind>(
  apiKey: string,
  secret: string,
  kind: Kind,
  query: TotalQuery,
  options: FetchAccountOptions = {},
): Promise<TotalPage<EarnRecordByKind[Kind]>> => {
  const { path, extraParams, readRow } = EARN_READS[kind];
  const page = await signedRequestPage(
    apiKey,
    secret,
    'GET',
    path,
    { asset: BINANCE_ASSET, ...extraParams, ...totalParams(query) },
    options,
  );

  return totalPage(readRow as Reader<EarnRecordByKind[Kind]>, timeFieldOf('time', epochTime))(page);
};
