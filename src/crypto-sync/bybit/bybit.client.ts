import { match, P } from 'ts-pattern';
import { BYBIT_API_ENDPOINT } from '@env';
import { isRecord } from '@kiko/type-guards';
import either, { bifoldr } from 'fnts/either';
import { signQuery } from '@kiko/crypto-sync/exchange/signing';

import { setBybitCooldownUntil } from './bybit.cooldown';
import type { BybitSignedPath } from './bybit.endpoints';

export type BybitReadOptions = {
  fetchImpl?: typeof fetch;
  /** Injected clock (same seam as `SyncDeps.now`) so a clock test needs no real timer. */
  now?: () => number;
  /** The account a rate refusal puts in cooldown; a connect has no account yet. */
  accountId?: string;
  /** The stored `expiredAt` of the connected key (see `isPastExpiry`). */
  expiredAt?: string;
};

/**
 * Bybit refuses a signed request whose `timestamp` is not within this many milliseconds of its
 * server time (code 10002). 5000 is Bybit's default; 20000 and 60000 are accepted too, and a
 * wider window would only let a captured request be replayed for longer.
 */
const RECV_WINDOW_MS = 5000;

/** The wait when the reset header of a rate refusal is missing, past, or not believable. */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * The wait of an HTTP 403, which Bybit answers to a banned IP and to a US or China IP alike. It is
 * also the longest wait a reset header may ask for: a header further off than this is not believed,
 * so a wrong value cannot cool an account for good.
 */
const FORBIDDEN_COOLDOWN_MS = 600_000;

const RESET_HEADER = 'X-Bapi-Limit-Reset-Timestamp';

/**
 * Why a read was refused, as the text and the next step need it. `malformed` is an answer that
 * went through and holds no code or no list of its route: it is a failure, never a zero.
 */
export type BybitRefusalClass =
  | 'expired'
  | 'rejected'
  | 'clock'
  | 'sign'
  | 'permission'
  | 'window'
  | 'ip'
  | 'notUnified'
  | 'unknown'
  | 'malformed';

/**
 * Bybit refuses a read for its rate (codes 10006 and 10018) or answers HTTP 403: both carry how
 * long the account waits, as ONE typed error, so a caller does not parse a message. The message is
 * fixed: a server text never enters an error.
 */
export class BybitRateLimitError extends Error {
  constructor(
    public readonly code: number,
    public readonly retryAfterMs: number,
  ) {
    super('Bybit rate limit');
    this.name = 'BybitRateLimitError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BybitRateLimitError.prototype);
  }
}

/** Any other refusal of a read, with the code (or the HTTP status) it was read from. */
export class BybitRefusalError extends Error {
  constructor(
    public readonly refusal: BybitRefusalClass,
    public readonly code?: number,
  ) {
    super('Bybit refusal');
    this.name = 'BybitRefusalError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BybitRefusalError.prototype);
  }
}

type FailureKind = BybitRefusalClass | 'rate' | 'forbidden';

/** What a refused read was read from: a code of the body, or the HTTP status when it has none. */
type Failure = { code: number; kind: FailureKind };

const failureOfCode = (code: number): Failure => ({
  code,
  kind: match(code)
    .returnType<FailureKind>()
    .with(P.union(33004, -2015), () => 'expired')
    .with(P.union(10003, 81007), () => 'rejected')
    .with(10002, () => 'clock')
    .with(10004, () => 'sign')
    .with(10005, () => 'permission')
    .with(131203, () => 'window')
    .with(P.union(10006, 10018), () => 'rate')
    .with(10010, () => 'ip')
    .with(10028, () => 'notUnified')
    .otherwise(() => 'unknown'),
});

const failureOfStatus = (response: Response): Failure => ({
  code: response.status,
  kind: match(response.status)
    .returnType<FailureKind>()
    .with(403, () => 'forbidden')
    .with(401, () => 'rejected')
    .otherwise(() => (response.ok ? 'malformed' : 'unknown')),
});

/**
 * The wait to the reset time the answer names, when that is a time after now and within the
 * longest wait; else the default.
 */
const retryAfterMsOf = (headers: Headers, now: number): number => {
  const wait = Number(headers.get(RESET_HEADER)) - now;

  return Number.isFinite(wait) && wait > 0 && wait <= FORBIDDEN_COOLDOWN_MS
    ? wait
    : DEFAULT_COOLDOWN_MS;
};

/**
 * Whether the stored end of the key has come. A refusal that says only "no" (a rejected key, a
 * code this client does not know) reads as the key having ended when it has; one that names its
 * cause keeps it.
 */
const isPastExpiry = (expiredAt: string | undefined, now: number): boolean =>
  now >= Date.parse(expiredAt ?? '');

const errorOf = (failure: Failure, response: Response, options: BybitReadOptions, now: number) =>
  match(failure.kind)
    .returnType<BybitRateLimitError | BybitRefusalError>()
    .with('forbidden', () => new BybitRateLimitError(failure.code, FORBIDDEN_COOLDOWN_MS))
    .with(
      'rate',
      () => new BybitRateLimitError(failure.code, retryAfterMsOf(response.headers, now)),
    )
    .with(
      P.union('rejected', 'unknown'),
      (refusal) =>
        new BybitRefusalError(
          isPastExpiry(options.expiredAt, now) ? 'expired' : refusal,
          failure.code,
        ),
    )
    .with(
      P.union('expired', 'clock', 'sign', 'permission', 'window', 'ip', 'notUnified', 'malformed'),
      (refusal) => new BybitRefusalError(refusal, failure.code),
    )
    .exhaustive();

/** A body that is not JSON (a gateway page) is no body at all. */
const bodyOf = async (response: Response): Promise<Record<string, unknown>> => {
  const parsed = bifoldr(await either<unknown, unknown>(() => response.json()));

  return isRecord(parsed) ? parsed : {};
};

/**
 * The `result` of an answer. The code of the body is read first and decides, whatever the HTTP
 * status says (Bybit answers HTTP 200 for most refusals); the status decides only when the body
 * holds no code. A rate refusal also puts the account in cooldown.
 */
const resultOf = async (
  response: Response,
  options: BybitReadOptions,
  now: number,
): Promise<unknown> => {
  const body = await bodyOf(response);

  if (body.retCode === 0) {
    return body.result;
  }

  const failure =
    typeof body.retCode === 'number' && Number.isInteger(body.retCode)
      ? failureOfCode(body.retCode)
      : failureOfStatus(response);
  const error = errorOf(failure, response, options, now);

  if (error instanceof BybitRateLimitError && options.accountId !== undefined) {
    setBybitCooldownUntil(options.accountId, now + error.retryAfterMs);
  }

  throw error;
};

/**
 * One signed Bybit read. The signature is the HMAC-SHA256 of the timestamp, the key, the recv
 * window and the query, in that order, under the API secret; it travels in a header with the key,
 * the timestamp and the window, so the URL holds nothing secret. Only GET exists here, on a path of
 * the closed list. `no-store` keeps the key header and the signed URL out of NSURLCache's Cache.db.
 * Returns the `result` of an answer with code 0, and throws `BybitRateLimitError` or
 * `BybitRefusalError` for every other answer.
 */
export const signedBybitGet = async (
  apiKey: string,
  secret: string,
  path: BybitSignedPath,
  params: Record<string, string>,
  options: BybitReadOptions = {},
): Promise<unknown> => {
  const { fetchImpl = fetch, now: clock = Date.now } = options;
  const now = clock();
  const query = new URLSearchParams(params).toString();
  const signature = signQuery(secret, String(now).concat(apiKey, String(RECV_WINDOW_MS), query));
  const response = await fetchImpl(
    `${BYBIT_API_ENDPOINT}${path}${query === '' ? '' : `?${query}`}`,
    {
      method: 'GET',
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-TIMESTAMP': String(now),
        'X-BAPI-RECV-WINDOW': String(RECV_WINDOW_MS),
        'X-BAPI-SIGN': signature,
        'Cache-Control': 'no-store',
      },
    },
  );

  return resultOf(response, options, now);
};

const recordOf = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new BybitRefusalError('malformed');
  }

  return value;
};

const listOf = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) {
    throw new BybitRefusalError('malformed');
  }

  return value;
};

const finiteNumberOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** The one shape of the date the key-info page measured (UTC, to the second). */
const EXPIRED_AT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const expiredAtOf = (value: unknown): string | undefined =>
  typeof value === 'string' && EXPIRED_AT_SHAPE.test(value) && Number.isFinite(Date.parse(value))
    ? value
    : undefined;

/**
 * What the key-info read gives. `expiredAt` and `deadlineDay` are the key's end, read on a sync.
 * `readOnly` (1 for a read-only key) and `isMaster` are read at connect only and never stored.
 * Every other field of the answer (the permissions, the user and inviter ids, the region, the
 * note) is dropped here, so none of it reaches state. A field of another shape reads as absent.
 */
type BybitKeyInfo = {
  expiredAt: string | undefined;
  deadlineDay: number | undefined;
  readOnly: number | undefined;
  isMaster: boolean | undefined;
};

/** `GET /v5/user/query-api`: the key's own facts. Any key reads it, whatever its boxes. */
export const fetchKeyInfo = async (
  apiKey: string,
  secret: string,
  options: BybitReadOptions = {},
): Promise<BybitKeyInfo> => {
  const info = recordOf(await signedBybitGet(apiKey, secret, '/v5/user/query-api', {}, options));

  return {
    expiredAt: expiredAtOf(info.expiredAt),
    deadlineDay: finiteNumberOf(info.deadlineDay),
    readOnly: finiteNumberOf(info.readOnly),
    isMaster: typeof info.isMaster === 'boolean' ? info.isMaster : undefined,
  };
};

/**
 * One coin of the UNIFIED account. The values are passed on as the answer holds them (a decimal
 * string, as Bybit sends), for the provider to read and to refuse one coin alone; no price and no
 * value of the account is read.
 */
type BybitUnifiedCoin = {
  coin: unknown;
  walletBalance: unknown;
  spotBorrow: unknown;
  borrowAmount: unknown;
};

const unifiedCoinOf = (row: unknown): BybitUnifiedCoin => {
  const fields = isRecord(row) ? row : {};

  return {
    coin: fields.coin,
    walletBalance: fields.walletBalance,
    spotBorrow: fields.spotBorrow,
    borrowAmount: fields.borrowAmount,
  };
};

/**
 * `GET /v5/account/wallet-balance`, the UNIFIED account: every coin it holds. An answer with no
 * list, or an entry with no coin list, is malformed and throws: it is never an account of no coin,
 * which the provider would write as a zero for each coin held.
 */
export const fetchUnifiedBalance = async (
  apiKey: string,
  secret: string,
  options: BybitReadOptions = {},
): Promise<BybitUnifiedCoin[]> => {
  const result = recordOf(
    await signedBybitGet(
      apiKey,
      secret,
      '/v5/account/wallet-balance',
      { accountType: 'UNIFIED' },
      options,
    ),
  );

  return listOf(result.list).flatMap((entry) =>
    listOf(recordOf(entry).coin).map((row) => unifiedCoinOf(row)),
  );
};

/** One coin of the FUND account, as `BybitUnifiedCoin` is. `transferBalance` is never read. */
type BybitFundCoin = { coin: unknown; walletBalance: unknown };

const fundCoinOf = (row: unknown): BybitFundCoin => {
  const fields = isRecord(row) ? row : {};

  return { coin: fields.coin, walletBalance: fields.walletBalance };
};

/**
 * `GET /v5/asset/transfer/query-account-coins-balance`, the FUND account: every coin it holds,
 * with no coin filter and no bonus parameter. An answer with no balance list is malformed.
 */
export const fetchFundBalance = async (
  apiKey: string,
  secret: string,
  options: BybitReadOptions = {},
): Promise<BybitFundCoin[]> => {
  const result = recordOf(
    await signedBybitGet(
      apiKey,
      secret,
      '/v5/asset/transfer/query-account-coins-balance',
      { accountType: 'FUND' },
      options,
    ),
  );

  return listOf(result.balance).map((row) => fundCoinOf(row));
};
