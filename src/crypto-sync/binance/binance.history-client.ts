import type {
  TotalPage as ExchangeTotalPage,
  UntrackedTotalRow,
} from '@kiko/crypto-sync/exchange/paging';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldMap, eitherSync } from 'fnts/either';
import type { UnreadableRow, WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import {
  type FetchAccountOptions,
  type RequestPage,
  publicRequestPage,
  signedRequestPage,
  usedApiWeightFromHeaders,
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
 * two. `rows` are the rows of the coins the read parses that did parse, and `untracked` the rows
 * of every other coin.
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
 * Whether a row's `status` is the one its kind settles on; a kind with no status (`undefined`) is
 * settled whatever the row says.
 */
const isSettledStatus = (settledStatus: string | undefined, status: unknown): boolean =>
  settledStatus === undefined || status === settledStatus;

/**
 * A row is read by its `asset`, upper-cased once. A tracked asset (`isTrackedBinanceAsset`) parses
 * strictly, and a malformed row is unreadable and owed. Any other row is counted and never parsed
 * (`undefined`), but a SETTLED row with a blank asset cannot be told from a row of a tracked
 * asset, so it is unreadable and owed too. A row with no string asset is rejected by the strict
 * reader, and a row that is not settled yet (no row of it can be imported) is counted whatever
 * its asset.
 */
const trackedRowOf =
  <Row>(readRow: Reader<Row>, settledStatus: string | undefined): Reader<Row | undefined> =>
  (item) => {
    if (!isRecord(item) || typeof item.asset !== 'string') {
      return readRow(item);
    }

    const ticker = binanceTickerOf(item.asset);

    if (isTrackedBinanceAsset(ticker)) {
      return readRow(item);
    }

    return ticker === '' && isSettledStatus(settledStatus, item.status)
      ? parseFailure()
      : undefined;
  };

/** What a row the walk does not read says: its ticker, its status text and its time. */
const untrackedTotalRowOf = (item: unknown, timeOf: TimeReader): UntrackedTotalRow => ({
  ticker: isRecord(item) && typeof item.asset === 'string' ? binanceTickerOf(item.asset) : '',
  status: isRecord(item) ? optionalText(item.status) : undefined,
  time: timeOf(item),
});

type TotalItem<Row> = { row: Row } | { untracked: UntrackedTotalRow };

/**
 * Transfer and Earn rows: `readRow` answers a row it reads (strictly, and one that does not goes
 * to `unreadable` with its own time field, so a malformed row never fails the read), or
 * `undefined` for a row of a coin the walk does not read, which is counted and reported in
 * `untracked`. A malformed envelope (a body or `rows` that is no list, a `total` that is no
 * number) still fails the read.
 */
const totalPage =
  <Row>(readRow: Reader<Row | undefined>, timeOf: TimeReader) =>
  ({ body, headers }: RequestPage): TotalPage<Row> => {
    if (!isRecord(body)) {
      return parseFailure();
    }

    const readings = readingsOf(
      body.rows ?? [],
      (item): TotalItem<Row> => {
        const row = readRow(item);

        return row === undefined ? { untracked: untrackedTotalRowOf(item, timeOf) } : { row };
      },
      timeOf,
    );
    const items = valuesOf(readings);

    return {
      rows: items.flatMap((item) => ('row' in item ? [item.row] : [])),
      unreadable: unreadableOf(readings),
      untracked: items.flatMap((item) => ('untracked' in item ? [item.untracked] : [])),
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

export type CapitalKind = 'deposit' | 'withdraw';

/** Binance's own settled states: a credited deposit, a completed withdrawal. */
const CAPITAL_SETTLED_STATUS: Record<CapitalKind, number> = { deposit: 1, withdraw: 6 };

/**
 * Whether a capital record has reached Binance's settled state for its kind. The one definition,
 * for the client (which makes a settled record with no coin unreadable and owed) and the walk
 * (which imports or lists only a settled one).
 */
export const isCapitalSettled = (kind: CapitalKind, status: number | undefined): boolean =>
  status === CAPITAL_SETTLED_STATUS[kind];

/** What differs between the two capital endpoints: the time field, how to read it, its kind. */
type CapitalField = { time: string; readTime: TimeReader; kind: CapitalKind };

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
    { time: timeField, readTime, kind }: CapitalField,
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

    if (ticker === '' && isCapitalSettled(kind, status)) {
      return parseFailure();
    }

    return { untracked: { ticker, status, time: readTime(item[timeField]) } };
  };

const capitalPage =
  <Row>(readRow: Reader<Row>, field: CapitalField) =>
  ({ body, headers }: RequestPage): CapitalPage<Row> => {
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
 * settled record with no usable coin cannot be told from one of a tracked coin, so it is
 * unreadable and owed, and one not settled yet is counted with an empty ticker (`capitalItemOf`).
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
  kind: 'deposit',
});

const withdrawalPage = capitalPage(recordReader(WITHDRAWAL_FIELDS), {
  time: 'applyTime',
  readTime: epochOrDatetimeTime,
  kind: 'withdraw',
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
 * A Pay or transfer coin, upper-cased once here like a capital coin (`binanceTickerOf`). A blank
 * one names no coin, so it cannot be told from a tracked coin: it is unreadable, never an
 * untracked one.
 */
const coinTicker: Reader<string> = (value) => {
  const ticker = binanceTickerOf(text(value));

  return ticker === '' ? parseFailure() : ticker;
};

const readFundsDetailEntry = recordReader({
  currency: coinTicker,
  amount: text,
  walletAssetCost,
});

const PAY_ORDER_FIELDS = {
  orderType: text,
  transactionId: identifierOrEmpty,
  transactionTime: finiteNumber,
  amount: text,
  currency: coinTicker,
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
 * where it sits in a span. `direction` is the sign of its amount: an order that is never parsed
 * has no parties to read a direction from, so its sign is the only signal, and an amount that is
 * zero or no usable number has none.
 */
export type BinanceUntrackedPayOrder = {
  tickers: string[];
  transactionTime: number | undefined;
  direction: 'in' | 'out' | undefined;
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
 * The coins a funds list names. An entry that is no object or names no usable coin cannot be told
 * from one of a tracked coin, so it makes the order unreadable and owed, whatever its own coin. A
 * funds detail that is absent or is no list names none: the order is counted.
 */
const fundsTickersOf = (fundsDetail: unknown): string[] =>
  (Array.isArray(fundsDetail) ? fundsDetail : []).map((entry) =>
    coinTicker(isRecord(entry) ? entry.currency : undefined),
  );

export const directionOfAmount = (amount: unknown): 'in' | 'out' | undefined => {
  const value = typeof amount === 'string' ? Number(amount) : amount;

  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
    return undefined;
  }

  return value > 0 ? 'in' : 'out';
};

const readPayItem: Reader<PayItem> = (value) => {
  if (!isRecord(value)) {
    return parseFailure();
  }

  const ticker = coinTicker(value.currency);
  const tickers = [...new Set([ticker, ...fundsTickersOf(value.fundsDetail)])];

  return tickers.some(isTrackedBinanceAsset)
    ? { order: readTrackedPayOrder(value) }
    : {
        untracked: {
          tickers,
          transactionTime: optionalFiniteNumber(value.transactionTime),
          direction: directionOfAmount(value.amount),
        },
      };
};

const payPage = ({ body, headers }: RequestPage): PayHistoryPage => {
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

/** The status Binance gives a transfer that went through; any other is owed, a failed one too. */
export const TRANSFER_SETTLED_STATUS = 'CONFIRMED';

const TRANSFER_FIELDS = {
  asset: coinTicker,
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

const transferPage = totalPage(
  trackedRowOf(recordReader(TRANSFER_FIELDS), TRANSFER_SETTLED_STATUS),
  timeFieldOf('timestamp', epochTime),
);

/**
 * `GET /sapi/v1/asset/transfer` (universal transfer history) for ONE page of ONE
 * transfer type in ONE window. The endpoint takes no `asset`, so rows of every
 * coin come back: a tracked coin's rows are read, any other's are counted and reported
 * (`untracked`). Signed, read-only.
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

/** The status Binance gives a subscription that went through. */
export const EARN_SUBSCRIPTION_SETTLED_STATUS = 'SUCCESS';

/** The status Binance gives a redemption that was paid out (a redemption is never `SUCCESS`). */
export const EARN_REDEMPTION_SETTLED_STATUS = 'PAID';

/**
 * The six Simple Earn history reads. `settledStatus` is the status a record of the kind has once
 * it went through; a reward has none and is always settled. Only the fields a walk uses are read;
 * an id
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
    settledStatus: EARN_SUBSCRIPTION_SETTLED_STATUS,
    readRow: recordReader({
      amount: text,
      asset: coinTicker,
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
    settledStatus: EARN_REDEMPTION_SETTLED_STATUS,
    readRow: recordReader({
      amount: text,
      asset: coinTicker,
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
    settledStatus: undefined,
    readRow: recordReader({
      asset: coinTicker,
      rewards: text,
      projectId: text,
      type: text,
      time: finiteNumber,
    }),
  },
  lockedSubscription: {
    path: `${EARN_HISTORY_ROOT}/locked/history/subscriptionRecord`,
    extraParams: {},
    settledStatus: EARN_SUBSCRIPTION_SETTLED_STATUS,
    readRow: recordReader({
      positionId: optionalIdentifier,
      purchaseId: identifier,
      time: finiteNumber,
      asset: coinTicker,
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
    settledStatus: EARN_REDEMPTION_SETTLED_STATUS,
    readRow: recordReader({
      positionId: optionalIdentifier,
      redeemId: identifier,
      time: finiteNumber,
      asset: coinTicker,
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
    settledStatus: undefined,
    readRow: recordReader({
      positionId: identifier,
      time: finiteNumber,
      asset: coinTicker,
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
 * record kind in ONE window (at most 30 days). The reads take no `asset`, so rows of every coin
 * come back: a tracked coin's rows are read, any other's are counted and reported (`untracked`).
 * Signed, read-only.
 */
export const fetchEarnRecords = async <Kind extends EarnRecordKind>(
  apiKey: string,
  secret: string,
  kind: Kind,
  query: TotalQuery,
  options: FetchAccountOptions = {},
): Promise<TotalPage<EarnRecordByKind[Kind]>> => {
  const { path, extraParams, readRow, settledStatus } = EARN_READS[kind];
  const page = await signedRequestPage(
    apiKey,
    secret,
    'GET',
    path,
    { ...extraParams, ...totalParams(query) },
    options,
  );

  return totalPage(
    trackedRowOf(readRow as Reader<EarnRecordByKind[Kind]>, settledStatus),
    timeFieldOf('time', epochTime),
  )(page);
};

/**
 * Whether a record of `kind` with this `status` text went through, so the coin of one the walk
 * does not read is listed. A reward has no status and is always settled.
 */
export const isEarnRecordSettled = (kind: EarnRecordKind, status: string | undefined): boolean =>
  isSettledStatus(EARN_READS[kind].settledStatus, status);

/** Binance's cap on `limit` for the Convert trade flow; a window with `moreData` holds more. */
export const CONVERT_PAGE_LIMIT = 1000;

const optionalTicker: Reader<string | undefined> = (value) =>
  foldMap(maybe(optionalText(value)), binanceTickerOf);

/**
 * The key of a Convert record: its `quoteId` when that is a non-empty text, else none. A live read
 * measured `orderId` as a JSON integer past 2^53, which `JSON.parse` has already rounded, so it
 * cannot name a record, and `quoteId` as a non-empty text. The key must never change once shipped:
 * the pair id and the external ids derive from it, so a different key makes a re-read insert a
 * second pair of rows.
 */
const convertRecordIdOf = (item: Record<string, unknown>): string | undefined =>
  typeof item.quoteId === 'string' && item.quoteId !== '' ? item.quoteId : undefined;

/**
 * The status and the wallet are optional text, and so are the assets and amounts: the walk decides
 * on the status first, so a record that is not settled never fails on a field it does not use.
 * `createTime` is required, because it says where the record sits in a window.
 */
const CONVERT_FIELDS = {
  orderStatus: optionalText,
  walletType: optionalText,
  fromAsset: optionalTicker,
  fromAmount: optionalText,
  toAsset: optionalTicker,
  toAmount: optionalText,
  createTime: finiteNumber,
};

/** One conversion from `/sapi/v1/convert/tradeFlow`, keyed by `recordId` (`convertRecordIdOf`). */
export type BinanceConvertRecord = Parsed<typeof CONVERT_FIELDS> & { recordId: string };

const readConvertFields = recordReader(CONVERT_FIELDS);

const readConvertRecord: Reader<BinanceConvertRecord> = (item) => {
  const recordId = isRecord(item) ? convertRecordIdOf(item) : undefined;

  return recordId === undefined ? parseFailure() : { recordId, ...readConvertFields(item) };
};

/**
 * One Convert page. Every record of the window is read whatever its coins, because a record's
 * coins are decided by the walk, so `rows` holds each record that parsed and `unreadable` each one
 * that did not, with its `createTime` when that is usable. `moreData` says the window holds more
 * records than `limit` returned.
 */
export type ConvertHistoryPage = HistoryPage<BinanceConvertRecord> & { moreData: boolean };

const convertPage = ({ body, headers }: RequestPage): ConvertHistoryPage => {
  if (!isRecord(body)) {
    return parseFailure();
  }

  const readings = readingsOf(body.list, readConvertRecord, timeFieldOf('createTime', epochTime));

  return {
    rows: valuesOf(readings),
    unreadable: unreadableOf(readings),
    moreData: flag(body.moreData),
    ...usedWeightsFromHeaders(headers),
  };
};

/**
 * `GET /sapi/v1/convert/tradeFlow` (Convert trade history) for ONE page of ONE window, at most 30
 * days wide. Signed, read-only. The body must carry a `list` array and a `moreData` flag, or the
 * read throws `BinanceHistoryParseError`.
 */
export const fetchConvertHistory = async (
  apiKey: string,
  secret: string,
  query: { startTime: number; endTime: number },
  options: FetchAccountOptions = {},
): Promise<ConvertHistoryPage> =>
  convertPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/convert/tradeFlow',
      {
        startTime: String(query.startTime),
        endTime: String(query.endTime),
        limit: String(CONVERT_PAGE_LIMIT),
      },
      options,
    ),
  );

/**
 * Binance spells `transfered` with one `r` on both amount fields. The record totals and an
 * entry's `serviceChargeAmount`, `transId` and `operateTime` are never read: the record's
 * `transId` keys the pair, and `transferedAmount` is the net amount received in `targetAsset`.
 * A coin or an amount that is absent is `undefined`, because the read of a record decides what to
 * do with it, not the parser.
 */
const DUST_ENTRY_FIELDS = {
  fromAsset: optionalTicker,
  targetAsset: optionalTicker,
  amount: optionalText,
  transferedAmount: optionalText,
};

/** One coin of a dust conversion from `/sapi/v1/asset/dribblet`, converted into `targetAsset`. */
export type BinanceDustEntry = Parsed<typeof DUST_ENTRY_FIELDS>;

/** One dust conversion record, one `userAssetDribblets` item, read from its named fields only. */
export type BinanceDustRecord = {
  transId: string;
  operateTime: number;
  entries: BinanceDustEntry[];
};

const readDustEntryList = listOf(recordReader(DUST_ENTRY_FIELDS));

const readDustEntries: Reader<BinanceDustEntry[]> = (value) => {
  const entries = readDustEntryList(value);

  return entries.length > 0 ? entries : parseFailure();
};

/**
 * The record's own `transId` keys its pairs, so it must be a non-empty text or a safe integer
 * (`identifier`): a record without one is unreadable, never keyed on a fallback. Its `operateTime`
 * says where the record sits, so it is required too. An entry list that is absent, empty, or holds
 * an item that is no object makes the record unreadable: a record's coins are never half-read, and
 * a conversion of no coin is never skipped silently.
 */
const readDustRecord: Reader<BinanceDustRecord> = (item) =>
  isRecord(item)
    ? {
        transId: identifier(item.transId),
        operateTime: finiteNumber(item.operateTime),
        entries: readDustEntries(item.userAssetDribbletDetails),
      }
    : parseFailure();

/**
 * One dust page: the newest records Binance keeps. `rows` holds each record that parsed and
 * `unreadable` each one that did not, with its `operateTime` when that is usable.
 */
export type DustHistoryPage = HistoryPage<BinanceDustRecord>;

/**
 * An empty log is an object with `userAssetDribblets` present as an empty array and no `total`
 * (measured live). `total` is never required or read; a body without the list array is malformed.
 */
const dustPage = ({ body, headers }: RequestPage): DustHistoryPage => {
  if (!isRecord(body)) {
    return parseFailure();
  }

  const readings = readingsOf(
    body.userAssetDribblets,
    readDustRecord,
    timeFieldOf('operateTime', epochTime),
  );

  return {
    rows: valuesOf(readings),
    unreadable: unreadableOf(readings),
    ...usedWeightsFromHeaders(headers),
  };
};

/**
 * `GET /sapi/v1/asset/dribblet` (dust log) with no parameter: Binance returns the last 100 records
 * after 2020/12/01 of the Spot account. Signed, read-only. The body must be an object with a
 * `userAssetDribblets` array, or the read throws `BinanceHistoryParseError`.
 */
export const fetchDustHistory = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<DustHistoryPage> =>
  dustPage(await signedRequestPage(apiKey, secret, 'GET', '/sapi/v1/asset/dribblet', {}, options));

const tickerText: Reader<string> = (value) => binanceTickerOf(text(value));

const PLAIN_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * An amount is summed with `addDecimal`, which reads an empty, signed or exponent text as a
 * number without failing, so only Binance's plain unsigned decimal text is let through, as sent.
 */
const decimalText: Reader<string> = (value) => {
  const amount = text(value);

  return PLAIN_DECIMAL_PATTERN.test(amount) ? amount : parseFailure();
};

/**
 * Only these four fields of a listed symbol are read, so the rest of its large entry (filters,
 * order types, precisions) is never kept. The coins are upper-cased once here, the symbol is kept
 * as Binance sent it, and a field that is not text makes the item unreadable.
 */
const EXCHANGE_SYMBOL_FIELDS = {
  symbol: text,
  status: text,
  baseAsset: tickerText,
  quoteAsset: tickerText,
};

/** One symbol of `/api/v3/exchangeInfo`: its name, status and its two coins as tickers. */
export type BinanceExchangeSymbol = Parsed<typeof EXCHANGE_SYMBOL_FIELDS>;

/**
 * The listed Spot symbols as sent (a name sent twice is listed twice; `tradeCandidatesOf` keeps
 * each once), with the number of items that did not read and the minute's spent `/api/*` weight
 * when Binance reports it.
 */
export type ExchangeSymbolsPage = {
  symbols: BinanceExchangeSymbol[];
  unreadable: number;
  usedApiWeight1m: number | undefined;
};

const readExchangeSymbol = recordReader(EXCHANGE_SYMBOL_FIELDS);

const exchangeSymbolsPage = ({ body, headers }: RequestPage): ExchangeSymbolsPage => {
  if (!isRecord(body)) {
    return parseFailure();
  }

  const readings = readingsOf(body.symbols, readExchangeSymbol, () => undefined);
  const readable = valuesOf(readings);
  const unreadable = unreadableOf(readings).length;

  if (readable.length === 0 && unreadable > 0) {
    return parseFailure();
  }

  return {
    symbols: readable,
    unreadable,
    usedApiWeight1m: usedApiWeightFromHeaders(headers),
  };
};

/**
 * `GET /api/v3/exchangeInfo?showPermissionSets=false`, public (no key, no signature), weight 20.
 * No `permissions` filter is sent: `permissions=SPOT` leaves out the BREAK leveraged-token
 * symbols (isSpotTradingAllowed false) a user can still hold old Spot fills on, and the body
 * stays within 1% of the filtered one. A body that is no object, with no `symbols` array, or with
 * items of which none reads, throws `BinanceHistoryParseError`; an empty `symbols` array is an
 * empty list; a 429 or 418 throws `BinanceRateLimitError`.
 */
export const fetchExchangeSymbols = async (
  options: Pick<FetchAccountOptions, 'fetchImpl'> = {},
): Promise<ExchangeSymbolsPage> =>
  exchangeSymbolsPage(
    await publicRequestPage('/api/v3/exchangeInfo', { showPermissionSets: 'false' }, options),
  );

/**
 * Binance's cap on `limit` for `myTrades` (the default is 500). A page of fewer fills than this
 * is the last, which is what the trade walk reads its end from.
 */
export const TRADE_PAGE_LIMIT = 1000;

const unchecked: Reader<unknown> = (value) => value;

/**
 * Every field a trade's rows are built from is read strictly, so a field of another JSON type
 * fails the page. `id` is left as sent: the id-cursor pager checks it, because it is the cursor.
 * The price, the list id and the maker flags are never read.
 */
const MY_TRADE_FIELDS = {
  id: unchecked,
  orderId: integer,
  qty: decimalText,
  quoteQty: decimalText,
  commission: decimalText,
  commissionAsset: tickerText,
  isBuyer: flag,
  time: integer,
};

/** One fill of `/api/v3/myTrades`: amounts as Binance's decimal text, `time` in epoch ms. */
export type BinanceMyTrade = Parsed<typeof MY_TRADE_FIELDS>;

/** One page of fills and the minute's spent weights when Binance reports them. */
type MyTradesPage = { rows: BinanceMyTrade[] } & BinancePageWeights;

const readMyTrades = listOf(recordReader(MY_TRADE_FIELDS));

/**
 * A page with any unreadable row fails whole: a fill skipped here would be lost behind the
 * cursor that moves past it.
 */
const myTradesPage = ({ body, headers }: RequestPage): MyTradesPage => ({
  rows: readMyTrades(body),
  ...usedWeightsFromHeaders(headers),
  usedApiWeight1m: usedApiWeightFromHeaders(headers),
});

/**
 * `GET /api/v3/myTrades?symbol&fromId&limit=1000`, signed, ONE page of the symbol's fills from
 * `fromId` on (inclusive, ascending by id). A symbol Binance does not know throws
 * `BinanceInvalidSymbolError`, a 429 or 418 `BinanceRateLimitError`, and an unreadable page
 * `BinanceHistoryParseError`.
 */
export const fetchMyTrades = async (
  apiKey: string,
  secret: string,
  symbol: string,
  fromId: number,
  options: FetchAccountOptions = {},
): Promise<MyTradesPage> =>
  myTradesPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/api/v3/myTrades',
      { symbol, fromId: String(fromId), limit: String(TRADE_PAGE_LIMIT) },
      options,
    ),
  );

/**
 * `GET /api/v3/myTrades?symbol&orderId&limit=1000`, signed, ONE page of one order's fills. The
 * first page (`fromId` 0) sends no `fromId`; a later page sends it, the supported combination
 * `symbol` + `orderId` + `fromId`. Errors are those of `fetchMyTrades`.
 */
export const fetchOrderFills = async (
  apiKey: string,
  secret: string,
  symbol: string,
  orderId: number,
  fromId: number,
  options: FetchAccountOptions = {},
): Promise<MyTradesPage> =>
  myTradesPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/api/v3/myTrades',
      {
        symbol,
        orderId: String(orderId),
        ...(fromId > 0 ? { fromId: String(fromId) } : {}),
        limit: String(TRADE_PAGE_LIMIT),
      },
      options,
    ),
  );

/** Binance's cap on `rows` for the P2P order history; `page` starts at 1. */
export const P2P_PAGE_ROWS = 100;

const P2P_SUCCESS_CODE = '000000';

const nonEmptyText: Reader<string> = (value) =>
  typeof value === 'string' && value !== '' ? value : parseFailure();

/**
 * What places an order in a window and names its row: a missing or empty `orderNumber` or a
 * `createTime` that is no safe integer makes the order unreadable and owed (the Convert rule), with
 * its `createTime` as the time when that is usable.
 */
const P2P_IDENTITY_FIELDS = {
  orderNumber: nonEmptyText,
  createTime: integer,
};

/**
 * Every field the walk decides on is read with its documented type, and left `undefined` when
 * Binance sends none (null or left out), so an absent amount differs from an empty one. A field of
 * another JSON type fails the page. The counterparty (`counterPartNickName`, `payMethodName`,
 * `additionalKycVerify`, `advNo`) is never read, nor are the unit price, the rate, the fiat symbol
 * and the `commission` the doc lists: none decides the row or its marker.
 */
const P2P_FIELDS = {
  orderStatus: strictOptionalText,
  tradeType: strictOptionalText,
  advertisementRole: strictOptionalText,
  asset: optional(tickerText),
  fiat: strictOptionalText,
  amount: strictOptionalText,
  totalPrice: strictOptionalText,
  takerCommission: strictOptionalText,
  takerAmount: strictOptionalText,
};

/** One order from `/sapi/v1/c2c/orderMatch/listUserOrderHistory`, amounts as Binance's text. */
export type BinanceP2pOrder = Parsed<typeof P2P_IDENTITY_FIELDS> & Parsed<typeof P2P_FIELDS>;

const readP2pIdentity = recordReader(P2P_IDENTITY_FIELDS);

const readP2pFields = recordReader(P2P_FIELDS);

const readP2pIdentified: Reader<{ item: unknown; identity: Parsed<typeof P2P_IDENTITY_FIELDS> }> = (
  item,
) => ({ item, identity: readP2pIdentity(item) });

/**
 * One P2P page. An order that cannot be placed (`P2P_IDENTITY_FIELDS`) is `unreadable`; any other
 * order is read outside that guard, so a field of the wrong type fails the whole page and no order
 * is skipped. The orders of every asset are rows: the walk decides on the status, side and role
 * before it asks whether the asset is tracked, so `untracked` is always empty. The envelope is
 * an object with the success code, a `data` list (null or left out is empty) and a `total`.
 */
const p2pPage = ({ body, headers }: RequestPage): TotalPage<BinanceP2pOrder> => {
  if (!isRecord(body) || body.code !== P2P_SUCCESS_CODE) {
    return parseFailure();
  }

  const readings = readingsOf(
    body.data ?? [],
    readP2pIdentified,
    timeFieldOf('createTime', epochTime),
  );

  return {
    rows: valuesOf(readings).map(({ item, identity }) => ({ ...identity, ...readP2pFields(item) })),
    unreadable: unreadableOf(readings),
    untracked: [],
    gathered: readings.length,
    total: finiteNumber(body.total),
    ...usedWeightsFromHeaders(headers),
  };
};

/**
 * `GET /sapi/v1/c2c/orderMatch/listUserOrderHistory` for ONE page of ONE side in ONE window, at
 * most 30 days wide. Signed, read-only. A body that is not the documented envelope, or an order
 * with a field of the wrong type, throws `BinanceHistoryParseError`; a start Binance keeps no
 * history for throws `BinanceHistoryTooOldError`, a 429 or 418 `BinanceRateLimitError`.
 */
export const fetchP2pOrders = async (
  apiKey: string,
  secret: string,
  side: 'BUY' | 'SELL',
  span: WalkWindow,
  page: number,
  options: FetchAccountOptions = {},
): Promise<TotalPage<BinanceP2pOrder>> =>
  p2pPage(
    await signedRequestPage(
      apiKey,
      secret,
      'GET',
      '/sapi/v1/c2c/orderMatch/listUserOrderHistory',
      {
        tradeType: side,
        startTimestamp: String(span.start),
        endTimestamp: String(span.end),
        page: String(page),
        rows: String(P2P_PAGE_ROWS),
      },
      options,
    ),
  );
