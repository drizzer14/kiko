import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldMap, eitherSync } from 'fnts/either';

import {
  BINANCE_ASSET,
  type FetchAccountOptions,
  type SignedPage,
  signedRequestPage,
  usedWeightsFromHeaders,
} from './binance.client';

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

/**
 * A row the client could not read, kept for the walk instead of failing the read: it holds
 * nothing of the row but its own time field when that is usable (a finite number or, for a
 * withdrawal, a datetime text), else `undefined`. The walk owes the row's point, or its span.
 */
export type UnreadableRow = { time: number | string | undefined };

/**
 * One page of one window, with the minute's spent weight when Binance reports it. `rows` are the
 * rows that parsed; every other row is in `unreadable`, so one malformed row never fails the read.
 */
export type HistoryPage<Row> = {
  rows: Row[];
  unreadable: UnreadableRow[];
  usedUidWeight1m: number | undefined;
  usedIpWeight1m: number | undefined;
};

/** A page of a `{ rows, total }` endpoint, paged by `current`. */
type TotalPage<Row> = HistoryPage<Row> & { total: number };

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

const arrayPage =
  <Row>(readRow: Reader<Row>, timeOf: TimeReader) =>
  ({ body, headers }: SignedPage): HistoryPage<Row> => {
    const readings = readingsOf(body, readRow, timeOf);

    return {
      rows: valuesOf(readings),
      unreadable: unreadableOf(readings),
      ...usedWeightsFromHeaders(headers),
    };
  };

/**
 * Transfer and Earn rows parse strictly: a malformed row still fails the read, so `unreadable`
 * is always empty here.
 */
const totalPage =
  <Row>(readRow: Reader<Row>) =>
  ({ body, headers }: SignedPage): TotalPage<Row> => {
    if (!isRecord(body)) {
      return parseFailure();
    }

    return {
      rows: listOf(readRow)(body.rows ?? []),
      unreadable: [],
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
  coin: BINANCE_ASSET,
  startTime: String(window.startTime),
  endTime: String(window.endTime),
  offset: String(window.offset),
  limit: String(HISTORY_PAGE_LIMIT),
});

/**
 * `walletType` is 0 for Spot and 1 for Funding. `txId` is empty for a movement
 * with no on-chain hash.
 */
const DEPOSIT_FIELDS = {
  id: identifierOrEmpty,
  amount: text,
  coin: textOrEmpty,
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
  coin: textOrEmpty,
  txId: textOrEmpty,
  applyTime: textOrNumber,
  status: finiteNumber,
  walletType: optional(integer),
};

/** One withdrawal from `/sapi/v1/capital/withdraw/history`. */
export type BinanceWithdrawal = Parsed<typeof WITHDRAWAL_FIELDS>;

const depositPage = arrayPage(recordReader(DEPOSIT_FIELDS), timeFieldOf('insertTime', epochTime));

const withdrawalPage = arrayPage(
  recordReader(WITHDRAWAL_FIELDS),
  timeFieldOf('applyTime', epochOrDatetimeTime),
);

/**
 * `GET /sapi/v1/capital/deposit/hisrec` (deposit history), filtered to BTC, for
 * ONE offset page of ONE window. Signed, read-only. Returns the page; the
 * offset-paging and window walk live in `binance.transactions.ts`.
 */
export const fetchDepositHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<HistoryPage<BinanceDeposit>> =>
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
 * `GET /sapi/v1/capital/withdraw/history` (withdrawal history), filtered to BTC,
 * for ONE offset page of ONE window. Signed, read-only. Same window/paging
 * contract as `fetchDepositHistory`; the page carries the minute's spent UID weight
 * the resumable walk budgets its next call against.
 */
export const fetchWithdrawHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<HistoryPage<BinanceWithdrawal>> =>
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
 * direction rule and the receiver check of an order paid in another coin, and is never
 * stored or logged; email, phone, account id, country, card number, institution and
 * digital-wallet id are never parsed.
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

const readFundsDetailEntry = recordReader({
  currency: text,
  amount: text,
  walletAssetCost,
});

const PAY_ORDER_FIELDS = {
  orderType: text,
  transactionId: identifierOrEmpty,
  transactionTime: finiteNumber,
  amount: text,
  currency: text,
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
 * One Pay page. The history lists the orders of EVERY coin, but only a BTC order can
 * reach a row, so only `rows` (the BTC orders) are parsed strictly: an order of another
 * coin that is off-contract must not stall the BTC walk. The window walk still needs the
 * whole page, so it reads these from every coin: `gathered`, a full page of
 * `PAY_PAGE_LIMIT` meaning the window holds more orders than one page returns.
 */
export type PayHistoryPage = HistoryPage<BinancePayOrder> & {
  gathered: number;
  /**
   * The non-BTC orders that were paid with BTC funds, by the Binance ids of their parties.
   * Whether BTC left the user's wallet depends on who paid, which only the walk, holding
   * the user's uid, can tell, so the client reports the parties and leaves the decision.
   */
  btcFundedOtherCoinOrders: BtcFundedOtherCoinOrder[];
};

/**
 * The Binance ids of a non-BTC order's payer and receiver, and its time, which says where it
 * lies in a span; a party that names none, or a time that is no finite number, has `undefined`.
 */
export type BtcFundedOtherCoinOrder = {
  payerId: string | undefined;
  receiverId: string | undefined;
  transactionTime: number | undefined;
};

type PayItem = {
  btcOrder: BinancePayOrder | undefined;
  btcFunded: BtcFundedOtherCoinOrder | undefined;
};

const readBtcPayOrder = recordReader(PAY_ORDER_FIELDS);

const paidWithBtc = (fundsDetail: unknown): boolean =>
  Array.isArray(fundsDetail) &&
  fundsDetail.some((entry) => isRecord(entry) && entry.currency === BINANCE_ASSET);

/**
 * A malformed party reads as no id, never an error: an order of another coin must not
 * stall the walk.
 */
const partyIdOf = (party: unknown): string | undefined =>
  isRecord(party) ? optionalIdentifier(party.binanceId) : undefined;

const readOtherCoinItem = (order: Record<string, unknown>): PayItem => ({
  btcOrder: undefined,
  btcFunded: paidWithBtc(order.fundsDetail)
    ? {
        payerId: partyIdOf(order.payerInfo),
        receiverId: partyIdOf(order.receiverInfo),
        transactionTime: optionalFiniteNumber(order.transactionTime),
      }
    : undefined,
});

const readPayItem: Reader<PayItem> = (value) => {
  if (!isRecord(value) || typeof value.currency !== 'string') {
    return parseFailure();
  }

  if (value.currency === BINANCE_ASSET) {
    return { btcOrder: readBtcPayOrder(value), btcFunded: undefined };
  }

  return readOtherCoinItem(value);
};

const payPage = ({ body, headers }: SignedPage): PayHistoryPage => {
  const readings = readingsOf(
    isRecord(body) && body.code === PAY_SUCCESS_CODE ? body.data : undefined,
    readPayItem,
    timeFieldOf('transactionTime', epochTime),
  );
  const items = valuesOf(readings);

  return {
    rows: items.flatMap((item) => item.btcOrder ?? []),
    unreadable: unreadableOf(readings),
    gathered: readings.length,
    btcFundedOtherCoinOrders: items.flatMap((item) => item.btcFunded ?? []),
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

type TotalQuery = { startTime: number; endTime: number; current: number };

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

type UniversalTransferType = (typeof UNIVERSAL_TRANSFER_TYPES)[number];

const TRANSFER_FIELDS = {
  asset: text,
  amount: text,
  type: text,
  status: text,
  tranId: identifier,
  timestamp: finiteNumber,
};

/** One transfer from `/sapi/v1/asset/transfer`; its `tranId` is kept as text. */
type BinanceUniversalTransfer = Parsed<typeof TRANSFER_FIELDS>;

const transferPage = totalPage(recordReader(TRANSFER_FIELDS));

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
 * a walk keys a row by is required, and a field it only inspects is optional. The
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
      type: optionalText,
      sourceAccount: optionalText,
      amtFromSpot: optionalText,
      amtFromFunding: optionalText,
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
      type: optionalText,
      sourceAccount: optionalText,
      amtFromSpot: optionalText,
      amtFromFunding: optionalText,
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
      type: optionalText,
      status: text,
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

type EarnRecordKind = keyof typeof EARN_READS;

type EarnRecordByKind = {
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

  return totalPage(readRow as Reader<EarnRecordByKind[Kind]>)(page);
};
