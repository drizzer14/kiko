import { guard } from 'fnts';
import { i18n } from '@kiko/i18n/init';
import { BINANCE_API_ENDPOINT } from '@env';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import either, { bifoldr } from 'fnts/either';

import { signQuery } from './binance.hmac';

/** One spot balance from `/api/v3/account` — decimal strings, per Binance. */
export type BinanceBalance = { asset: string; free: string; locked: string };

/**
 * The `/api/v3/account` payload fields this client reads. `uid` is the user's own
 * Binance id as a string, or `null` when the response carries none; it is used in
 * memory for one run and never stored.
 */
export type BinanceAccount = { balances: BinanceBalance[]; uid: string | null };

export type FetchAccountOptions = {
  fetchImpl?: typeof fetch;
  /** Injected clock (same seam as `SyncDeps.now`) so a clock-skew test needs no real timer. */
  now?: () => number;
};

/**
 * Binance rejects a signed request whose `timestamp` is more than this many
 * milliseconds off its server time (error -1021). 5000 is Binance's default.
 */
const RECV_WINDOW_MS = 5000;

/**
 * Binance rejects a request under its weight limit with 429, or bans the IP
 * outright with 418 — both carry a `Retry-After` the caller must honour before
 * trying again, so both are surfaced as this ONE typed error rather than the
 * generic `binanceRequestFailed` text: a caller that needs to set a cooldown
 * would otherwise have to parse the localized message to tell them apart.
 */
export class BinanceRateLimitError extends Error {
  constructor(
    public readonly status: 429 | 418,
    public readonly retryAfterMs: number,
  ) {
    super(`Binance rate limit ${status}`);
    this.name = 'BinanceRateLimitError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, BinanceRateLimitError.prototype);
  }
}

/**
 * Binance sends `Retry-After` in seconds. Anything missing, non-numeric, or
 * non-positive falls back to this default rather than a zero or negative wait.
 */
export const DEFAULT_RETRY_AFTER_MS = 60_000;

const retryAfterMsFromHeaders = (headers: Headers): number => {
  const seconds = Number(headers.get('Retry-After'));

  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS;
};

/**
 * Binance error bodies are `{ code, msg }`. Surface `msg` (the clock-skew or
 * invalid-key text) so the user sees the real cause, not a bare status. A
 * non-JSON body (a gateway HTML page) yields no suffix.
 */
const errorSuffix = async (response: Response): Promise<string> => {
  const body = await either<unknown, unknown>(() => response.json());
  const parsed = bifoldr(body);
  const message = (parsed as { msg?: unknown } | undefined)?.msg;

  return typeof message === 'string' ? `: ${message}` : '';
};

/**
 * Read a Binance JSON body, or throw on a non-ok response — the same `guard`
 * validator/executor shape as the Monobank client, with an async throwing
 * executor so the error body can be read first.
 */
const readBody = guard(
  [
    (response: Response) => !response.ok,
    async (response: Response): Promise<never> => {
      throw new Error(
        i18n.t('accountDetail.binanceRequestFailed', {
          status: response.status,
          detail: await errorSuffix(response),
        }),
      );
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

/** The single asset this milestone reads; every SAPI read filters to it. */
export const BINANCE_ASSET = 'BTC';

/** A signed request's parsed body alongside its response headers. */
export type SignedPage = { body: unknown; headers: Headers };

/**
 * One signed Binance request. HMAC-SHA256 over the full query
 * (`params…&timestamp=…&recvWindow=…`) under the API secret, appended as
 * `signature`, with the key in the `X-MBX-APIKEY` header. Every read endpoint
 * (Spot account, Funding wallet, Simple Earn positions) shares this signing —
 * only the method, path, and extra params differ — so a key with only "Enable
 * Reading" is enough. `params` (an `asset` filter, a position page's
 * `current`/`size`) are signed together with the timestamp.
 *
 * A 429 (weight limit) or 418 (IP ban) is checked BEFORE the body is read —
 * both throw `BinanceRateLimitError` so a caller can set a cooldown, rather
 * than the generic `binanceRequestFailed` text `readBody` would otherwise
 * produce for any other non-ok status (which is what lets a caller SKIP a
 * failing wallet).
 */
export const signedRequestPage = async (
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  { fetchImpl = fetch, now = Date.now }: FetchAccountOptions = {},
): Promise<SignedPage> => {
  const query = new URLSearchParams({
    ...params,
    timestamp: String(now()),
    recvWindow: String(RECV_WINDOW_MS),
  }).toString();
  const signature = signQuery(secret, query);
  const response = await fetchImpl(
    `${BINANCE_API_ENDPOINT}${path}?${query}&signature=${signature}`,
    {
      method,
      // The key header and the signed URL must never reach NSURLCache's
      // Cache.db.
      headers: { 'X-MBX-APIKEY': apiKey, 'Cache-Control': 'no-store' },
    },
  );

  if (response.status === 429 || response.status === 418) {
    throw new BinanceRateLimitError(response.status, retryAfterMsFromHeaders(response.headers));
  }

  return { body: await readBody(response), headers: response.headers };
};

const signedRequest = async (
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  options: FetchAccountOptions = {},
): Promise<unknown> =>
  (await signedRequestPage(apiKey, secret, method, path, params, options)).body;

/**
 * A Binance uid arrives as a JSON integer, or as a digit string. Anything else
 * (missing, fractional, past 2^53, empty, non-digit) is no uid, so a caller that
 * compares it never matches on a mangled value.
 */
const uidFrom = (value: unknown): string | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? String(value) : null;
  }

  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
};

/**
 * `GET /api/v3/account` (Spot wallet). Read-only. The Spot balance is the one
 * wallet that MUST succeed — its failure fails the whole Binance sync. Only
 * `balances` and `uid` are picked off the body; `balances` is passed through
 * unchecked because the provider rejects a body without a usable array.
 */
export const fetchAccount = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceAccount> => {
  const body = await signedRequest(apiKey, secret, 'GET', '/api/v3/account', {}, options);
  const account: Record<string, unknown> = isRecord(body) ? body : {};

  return { balances: account.balances as BinanceBalance[], uid: uidFrom(account.uid) };
};

/** One Funding-wallet balance from `/sapi/v1/asset/get-funding-asset` — decimal strings. */
export type BinanceFundingAsset = {
  asset: string;
  free: string;
  locked: string;
  freeze: string;
  withdrawing: string;
};

/**
 * `POST /sapi/v1/asset/get-funding-asset` (Funding wallet). Filtered to BTC.
 * Returns one entry per held asset (a full array, NOT paginated); the BTC amount
 * is `free + locked + freeze + withdrawing`. "Enable Reading" permission only.
 */
export const fetchFundingAsset = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceFundingAsset[]> =>
  (await signedRequest(
    apiKey,
    secret,
    'POST',
    '/sapi/v1/asset/get-funding-asset',
    { asset: BINANCE_ASSET },
    options,
  )) as BinanceFundingAsset[];

/**
 * Simple Earn positions are PAGINATED (`current` from 1, `size` per page, the
 * response an object of `{ rows, total }`). Binance caps `size` at 100; `current`
 * starts at 1. Reading page 1 alone UNDER-COUNTS a user whose positions span more
 * than one page — locked especially, since each locked subscription is its own
 * position row.
 */
const POSITION_PAGE_SIZE = 100;

/** Safety stop: a misreported `total` must not spin an unbounded page loop. */
const MAX_POSITION_PAGES = 50;

/**
 * Walk every page of a Simple Earn position endpoint, filtered to BTC, and
 * accumulate the rows. Termination depends on `total`, NOT on a page being
 * "full": it stops once the gathered rows cover the reported `total`, or when a
 * page comes back empty (the backstop for an over-reported `total`); the
 * `MAX_POSITION_PAGES` cap is the final stop. This does not assume Binance
 * honors `size=100` — a short but non-empty page while rows still remain keeps
 * paging rather than under-counting. A failure on ANY page rejects the whole
 * walk, so the caller (via `skipOnError`) drops the WHOLE wallet rather than
 * importing a partial, silently-under-counted total.
 */
const fetchAllPositions = async <Row>(
  apiKey: string,
  secret: string,
  path: string,
  options: FetchAccountOptions,
): Promise<{ rows: Row[]; total: number }> => {
  const rows: Row[] = [];
  let total = 0;

  for (let current = 1; current <= MAX_POSITION_PAGES; current += 1) {
    const page = (await signedRequest(
      apiKey,
      secret,
      'GET',
      path,
      {
        asset: BINANCE_ASSET,
        current: String(current),
        size: String(POSITION_PAGE_SIZE),
      },
      options,
    )) as { rows?: Row[]; total?: number };

    const pageRows = page.rows ?? [];
    rows.push(...pageRows);

    if (typeof page.total === 'number') {
      total = page.total;
    }

    if (rows.length >= total || pageRows.length === 0) {
      break;
    }
  }

  return { rows, total };
};

/** One Simple Earn Flexible position — its BTC amount is `totalAmount` (decimal string). */
export type BinanceFlexiblePosition = {
  rows: { asset: string; totalAmount: string }[];
  total: number;
};

/** `GET /sapi/v1/simple-earn/flexible/position` (Simple Earn Flexible), all pages. */
export const fetchFlexiblePosition = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceFlexiblePosition> =>
  fetchAllPositions<BinanceFlexiblePosition['rows'][number]>(
    apiKey,
    secret,
    '/sapi/v1/simple-earn/flexible/position',
    options,
  );

/** One Simple Earn Locked position — its BTC amount is `amount` (decimal string). */
export type BinanceLockedPosition = {
  rows: { asset: string; amount: string }[];
  total: number;
};

/** `GET /sapi/v1/simple-earn/locked/position` (Simple Earn Locked), all pages. */
export const fetchLockedPosition = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceLockedPosition> =>
  fetchAllPositions<BinanceLockedPosition['rows'][number]>(
    apiKey,
    secret,
    '/sapi/v1/simple-earn/locked/position',
    options,
  );

const weightFromHeader = (headers: Headers, name: string): number | undefined => {
  const raw = foldMap(maybe(headers.get(name)), Number);

  return raw !== undefined && Number.isFinite(raw) ? raw : undefined;
};

/**
 * The requesting minute's spent SAPI weight, per Binance's own headers, when it
 * reports them: `X-SAPI-USED-UID-WEIGHT-1M` (per user) and
 * `X-SAPI-USED-IP-WEIGHT-1M` (per IP). The signal a resumable history walk budgets
 * its next call against. A missing or non-numeric header reads as `undefined`.
 */
export const usedWeightsFromHeaders = (
  headers: Headers,
): { usedUidWeight1m: number | undefined; usedIpWeight1m: number | undefined } => ({
  usedUidWeight1m: weightFromHeader(headers, 'X-SAPI-USED-UID-WEIGHT-1M'),
  usedIpWeight1m: weightFromHeader(headers, 'X-SAPI-USED-IP-WEIGHT-1M'),
});
