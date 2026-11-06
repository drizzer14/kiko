import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldMap, eitherSync } from 'fnts/either';
import type { WalkWindow } from '@kiko/crypto-sync/exchange/walk';

import type { BybitSignedPath } from './bybit.endpoints';
import { isTrackedBybitAsset } from './bybit.tracked-coin';
import { BYBIT_HISTORY_PAGE_SIZE } from './bybit.walk-config';
import { type BybitReadOptions, signedBybitGet } from './bybit.client';

/**
 * A class of its own, with a fixed message, because a swallowed failure logs only the error's name:
 * a URL or a body in the message would carry an amount or an id into a log.
 */
export class BybitHistoryParseError extends Error {
  constructor() {
    super('Bybit history response malformed');
    this.name = 'BybitHistoryParseError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BybitHistoryParseError.prototype);
  }
}

const parseFailure = (): never => {
  throw new BybitHistoryParseError();
};

type Reader<Value> = (value: unknown) => Value;

const text: Reader<string> = (value) => (typeof value === 'string' ? value : parseFailure());

const nonEmptyText: Reader<string> = (value) => {
  const read = text(value);

  return read === '' ? parseFailure() : read;
};

const integer: Reader<number> = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : parseFailure();

/**
 * Bybit sends an id, or a type code, as text or as a JSON integer. An empty text and an integer
 * past 2^53 name nothing, so a key built from it is never built from a mangled value.
 */
const optionalIdentifier: Reader<string | undefined> = (value) => {
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  return typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : undefined;
};

const identifier: Reader<string> = (value) => optionalIdentifier(value) ?? parseFailure();

const SECOND_MS = 1_000;
const MILLISECOND_DIGITS = 13;
const SECOND_DIGITS = 10;
const TIME_DIGITS = /^[1-9]\d*$/;

const digitsOf: Reader<string> = (value) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : text(value);

/**
 * The instants a time of a row can be. The pages state no unit, so the digit count decides: 13
 * digits are milliseconds, and 10 are a whole second, which holds its first millisecond to its
 * last. A time of any other digit count is not read. An empty text, `0` and an absent field are
 * one case: the row has no time yet, which is what a pending row looks like.
 */
const timeOf: Reader<WalkWindow | undefined> = (value) => {
  const digits = foldMap(maybe(value), digitsOf);

  if (digits === undefined || digits === '' || digits === '0') {
    return undefined;
  }

  if (!TIME_DIGITS.test(digits)) {
    return parseFailure();
  }

  const read = Number(digits);

  if (digits.length === MILLISECOND_DIGITS) {
    return { start: read, end: read };
  }

  return digits.length === SECOND_DIGITS
    ? { start: read * SECOND_MS, end: read * SECOND_MS + SECOND_MS - 1 }
    : parseFailure();
};

/** A time that is read when it can be, and is no time when it cannot: for a row not parsed. */
const readableTimeOf = (value: unknown): WalkWindow | undefined =>
  bifoldMap(
    eitherSync<unknown, WalkWindow | undefined>(() => timeOf(value)),
    (): WalkWindow | undefined => undefined,
    (time) => time,
  );

/** What an untracked row says of its status: text or a finite number, as its series sends it. */
const statusOf = (value: unknown): string | number | undefined =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined;

/**
 * One item of a page. `times` holds every reading of the series' window field that can be read:
 * the instants of each time, so a whole second gives its first and last millisecond, and a row
 * with no time gives none. The reader of a span tests a row against its reach with them.
 *
 * - `row`: a tracked coin that parsed. Its `time` is the point the row shows (`undefined` while it
 *   has none).
 * - `unreadable`: a tracked row that did not parse, or an item that is no row. `time` is the point
 *   it shows when that time can be read, so the walk owes its point and not the whole span.
 * - `untracked`: a row of a coin the app does not track, counted and never parsed.
 */
type BybitHistoryItem<Row> = { times: readonly number[] } & (
  | { kind: 'row'; row: Row }
  | { kind: 'unreadable'; time: WalkWindow | undefined }
  | {
      kind: 'untracked';
      ticker: string;
      status: string | number | undefined;
      time: WalkWindow | undefined;
    }
);

/**
 * One page of one series. `rows` holds every item of the page, whatever its kind, which is the
 * name the cursor reader of a span reads a page by. A cursor that is empty or absent is the end.
 */
type BybitHistoryPage<Row> = {
  rows: BybitHistoryItem<Row>[];
  nextPageCursor: string | undefined;
};

type Series<Row> = {
  path: BybitSignedPath;
  /** The field of `result` that holds the list: it differs by route. */
  list: 'rows' | 'list';
  params: Record<string, string>;
  /** The fields a window filters on. The first is the time the row shows. */
  timeFields: readonly string[];
  readRow: (fields: Record<string, unknown>) => Row;
};

const readingsOf = (fields: Record<string, unknown>, names: readonly string[]): WalkWindow[] =>
  names.flatMap((name) => foldMap(maybe(readableTimeOf(fields[name])), (time) => [time]) ?? []);

const instantsOf = ({ start, end }: WalkWindow): number[] =>
  start === end ? [start] : [start, end];

const itemOf =
  <Row>(series: Series<Row>) =>
  (value: unknown): BybitHistoryItem<Row> => {
    if (!isRecord(value)) {
      return { kind: 'unreadable', times: [], time: undefined };
    }

    const times = readingsOf(value, series.timeFields).flatMap(instantsOf);
    const time = readableTimeOf(value[series.timeFields[0]]);

    if (typeof value.coin === 'string' && value.coin !== '' && !isTrackedBybitAsset(value.coin)) {
      return { kind: 'untracked', times, ticker: value.coin, status: statusOf(value.status), time };
    }

    return bifoldMap(
      eitherSync<unknown, Row>(() => series.readRow(value)),
      (): BybitHistoryItem<Row> => ({ kind: 'unreadable', times, time }),
      (row): BybitHistoryItem<Row> => ({ kind: 'row', times, row }),
    );
  };

const cursorOf: Reader<string | undefined> = (value) => foldMap(maybe(value), text);

const pageOf =
  <Row>(series: Series<Row>) =>
  (result: unknown): BybitHistoryPage<Row> => {
    const list = isRecord(result) ? result[series.list] : undefined;

    if (!isRecord(result) || !Array.isArray(list)) {
      return parseFailure();
    }

    return {
      rows: list.map(itemOf(series)),
      nextPageCursor: cursorOf(result.nextPageCursor),
    };
  };

type PageRead = { span: WalkWindow; cursor: string | undefined };

const queryOf = (series: Series<unknown>, { span, cursor }: PageRead): Record<string, string> => ({
  ...series.params,
  startTime: String(span.start),
  endTime: String(span.end),
  limit: String(BYBIT_HISTORY_PAGE_SIZE),
  ...foldMap(maybe(cursor), (value) => ({ cursor: value })),
});

/**
 * One page of one span, signed and read-only. The cursor lives only in the caller's read of one
 * span and is never stored.
 */
const fetcherOf =
  <Row>(series: Series<Row>) =>
  async (
    apiKey: string,
    secret: string,
    read: PageRead,
    options: BybitReadOptions = {},
  ): Promise<BybitHistoryPage<Row>> =>
    pageOf(series)(
      await signedBybitGet(apiKey, secret, series.path, queryOf(series, read), options),
    );

/**
 * Deposits. The row's point is `successAt`. The transaction hash, the addresses and the tag are
 * never read. `depositType` is kept as the text it came as, for the walk to compare, and is not
 * guessed when it is absent.
 */
export const fetchDepositPage = fetcherOf({
  path: '/v5/asset/deposit/query-record',
  list: 'rows',
  params: {},
  timeFields: ['successAt'],
  readRow: (fields) => ({
    id: identifier(fields.id),
    coin: nonEmptyText(fields.coin),
    amount: text(fields.amount),
    status: integer(fields.status),
    depositType: optionalIdentifier(fields.depositType),
    time: timeOf(fields.successAt),
  }),
});

/** Internal deposits (a transfer from another Bybit account). The sender is never read. */
export const fetchInternalDepositPage = fetcherOf({
  path: '/v5/asset/deposit/query-internal-record',
  list: 'rows',
  params: {},
  timeFields: ['createdTime'],
  readRow: (fields) => ({
    id: identifier(fields.id),
    coin: nonEmptyText(fields.coin),
    amount: text(fields.amount),
    status: integer(fields.status),
    time: timeOf(fields.createdTime),
  }),
});

/**
 * Withdrawals of both kinds: the route answers on-chain ones alone unless `withdrawType` is 2. The
 * row's point is `createTime`, which never changes, so the row keeps its day when it settles.
 * `updateTime` is a window field only: it is read for the drift test and never into the row, so
 * an `updateTime` that cannot be read does not make a settled withdrawal unreadable.
 */
export const fetchWithdrawalPage = fetcherOf({
  path: '/v5/asset/withdraw/query-record',
  list: 'rows',
  params: { withdrawType: '2' },
  timeFields: ['createTime', 'updateTime'],
  readRow: (fields) => ({
    withdrawId: identifier(fields.withdrawId),
    coin: nonEmptyText(fields.coin),
    amount: text(fields.amount),
    status: text(fields.status),
    time: timeOf(fields.createTime),
  }),
});

/** Transfers between the account types of one user. The list of this route is `result.list`. */
export const fetchTransferPage = fetcherOf({
  path: '/v5/asset/transfer/query-inter-transfer-list',
  list: 'list',
  params: {},
  timeFields: ['timestamp'],
  readRow: (fields) => ({
    transferId: identifier(fields.transferId),
    coin: nonEmptyText(fields.coin),
    amount: text(fields.amount),
    fromAccountType: text(fields.fromAccountType),
    toAccountType: text(fields.toAccountType),
    status: text(fields.status),
    time: timeOf(fields.timestamp),
  }),
});
