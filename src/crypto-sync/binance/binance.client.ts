import { BINANCE_API_ENDPOINT } from '@env';
import { guard } from 'fnts';
import either, { bifold, isRight } from 'fnts/either';

import { signQuery } from './binance.hmac';

/** One spot balance from `/api/v3/account` — decimal strings, per Binance. */
export type BinanceBalance = { asset: string; free: string; locked: string };

/** The `/api/v3/account` payload fields this client reads. */
export type BinanceAccount = { balances: BinanceBalance[] };

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
 * Binance error bodies are `{ code, msg }`. Surface `msg` (the clock-skew or
 * invalid-key text) so the user sees the real cause, not a bare status. A
 * non-JSON body (a gateway HTML page) yields no suffix.
 */
const errorSuffix = async (response: Response): Promise<string> => {
  const body = await either<unknown, unknown>(() => response.json());
  const parsed = isRight(body) ? bifold(body) : undefined;
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
      throw new Error(`Binance request failed: ${response.status}${await errorSuffix(response)}`);
    },
  ],
  (response: Response): Promise<unknown> => response.json(),
);

/** The single asset this milestone reads; every SAPI read filters to it. */
const BINANCE_ASSET = 'BTC';

/**
 * One signed Binance request. HMAC-SHA256 over the full query
 * (`params…&timestamp=…&recvWindow=…`) under the API secret, appended as
 * `signature`, with the key in the `X-MBX-APIKEY` header. Every read endpoint
 * (Spot account, Funding wallet, Simple Earn positions) shares this signing —
 * only the method, path, and extra params differ — so a key with only "Enable
 * Reading" is enough. `params` (an `asset` filter, a position page's
 * `current`/`size`) are signed together with the timestamp. Throws on a non-ok
 * response (via `readBody`), which is what lets a caller SKIP a failing wallet.
 */
const signedRequest = async (
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>,
  { fetchImpl = fetch, now = Date.now }: FetchAccountOptions = {},
): Promise<unknown> => {
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
      headers: { 'X-MBX-APIKEY': apiKey },
    },
  );

  return readBody(response);
};

/**
 * `GET /api/v3/account` (Spot wallet). Read-only. The Spot balance is the one
 * wallet that MUST succeed — its failure fails the whole Binance sync.
 */
export const fetchAccount = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceAccount> =>
  (await signedRequest(apiKey, secret, 'GET', '/api/v3/account', {}, options)) as BinanceAccount;

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

/**
 * Binance caps the deposit/withdraw history page at 1000 rows (the default too).
 * A page of exactly this many rows means "there may be more" — the caller pages
 * on `offset` until a short page. Exported so the offset-paging walk in
 * `binance.transactions.ts` uses the SAME limit the request sends.
 */
export const HISTORY_PAGE_LIMIT = 1000;

/**
 * One offset page of a ≤90-day history window. Both history endpoints share this
 * shape: `startTime`/`endTime` bound the window (the API rejects a span of 90
 * days or more), `offset` pages within it.
 */
export type HistoryWindow = { startTime: number; endTime: number; offset: number };

/** One deposit from `/sapi/v1/capital/deposit/hisrec`. `insertTime` is epoch ms. */
export type BinanceDeposit = {
  id: string;
  amount: string;
  coin: string;
  txId: string;
  insertTime: number;
  status: number;
};

/**
 * `GET /sapi/v1/capital/deposit/hisrec` (deposit history), filtered to BTC, for
 * ONE offset page of ONE window. Signed, read-only. Returns the raw page; the
 * offset-paging and window walk live in `binance.transactions.ts`.
 */
export const fetchDepositHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<BinanceDeposit[]> =>
  (await signedRequest(
    apiKey,
    secret,
    'GET',
    '/sapi/v1/capital/deposit/hisrec',
    {
      coin: BINANCE_ASSET,
      startTime: String(window.startTime),
      endTime: String(window.endTime),
      offset: String(window.offset),
      limit: String(HISTORY_PAGE_LIMIT),
    },
    options,
  )) as BinanceDeposit[];

/**
 * One withdrawal from `/sapi/v1/capital/withdraw/history`. `applyTime` is a UTC
 * datetime STRING ("2019-10-12 11:12:02"), NOT epoch ms — see
 * `parseWithdrawTime` in `binance.transactions.ts`.
 */
export type BinanceWithdrawal = {
  id: string;
  amount: string;
  transactionFee: string;
  coin: string;
  txId: string;
  applyTime: string;
  status: number;
};

/**
 * `GET /sapi/v1/capital/withdraw/history` (withdrawal history), filtered to BTC,
 * for ONE offset page of ONE window. Signed, read-only. Same window/paging
 * contract as `fetchDepositHistory`.
 */
export const fetchWithdrawHistory = async (
  apiKey: string,
  secret: string,
  window: HistoryWindow,
  options: FetchAccountOptions = {},
): Promise<BinanceWithdrawal[]> =>
  (await signedRequest(
    apiKey,
    secret,
    'GET',
    '/sapi/v1/capital/withdraw/history',
    {
      coin: BINANCE_ASSET,
      startTime: String(window.startTime),
      endTime: String(window.endTime),
      offset: String(window.offset),
      limit: String(HISTORY_PAGE_LIMIT),
    },
    options,
  )) as BinanceWithdrawal[];
