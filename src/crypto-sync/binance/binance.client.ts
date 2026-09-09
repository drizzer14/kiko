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

/**
 * One signed Binance request. HMAC-SHA256 over `timestamp=…&recvWindow=…` under
 * the API secret, appended as `signature`, with the key in the `X-MBX-APIKEY`
 * header. Every read endpoint (Spot account, Funding wallet, Simple Earn
 * positions) shares this exact signed query — only the method and path differ —
 * so a key with only "Enable Reading" is enough. Throws on a non-ok response
 * (via `readBody`), which is what lets a caller SKIP a single failing wallet.
 */
const signedRequest = async (
  apiKey: string,
  secret: string,
  method: 'GET' | 'POST',
  path: string,
  { fetchImpl = fetch, now = Date.now }: FetchAccountOptions = {},
): Promise<unknown> => {
  const query = `timestamp=${now()}&recvWindow=${RECV_WINDOW_MS}`;
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
  (await signedRequest(apiKey, secret, 'GET', '/api/v3/account', options)) as BinanceAccount;

/** One Funding-wallet balance from `/sapi/v1/asset/get-funding-asset` — decimal strings. */
export type BinanceFundingAsset = {
  asset: string;
  free: string;
  locked: string;
  freeze: string;
  withdrawing: string;
};

/**
 * `POST /sapi/v1/asset/get-funding-asset` (Funding wallet). Returns one entry per
 * held asset; the BTC amount is `free + locked + freeze + withdrawing`. Requires
 * the API key's "Enable Reading" permission only.
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
    options,
  )) as BinanceFundingAsset[];

/** One Simple Earn Flexible position — its BTC amount is `totalAmount` (decimal string). */
export type BinanceFlexiblePosition = { rows: { asset: string; totalAmount: string }[] };

/** `GET /sapi/v1/simple-earn/flexible/position` (Simple Earn Flexible). */
export const fetchFlexiblePosition = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceFlexiblePosition> =>
  (await signedRequest(
    apiKey,
    secret,
    'GET',
    '/sapi/v1/simple-earn/flexible/position',
    options,
  )) as BinanceFlexiblePosition;

/** One Simple Earn Locked position — its BTC amount is `amount` (decimal string). */
export type BinanceLockedPosition = { rows: { asset: string; amount: string }[] };

/** `GET /sapi/v1/simple-earn/locked/position` (Simple Earn Locked). */
export const fetchLockedPosition = async (
  apiKey: string,
  secret: string,
  options: FetchAccountOptions = {},
): Promise<BinanceLockedPosition> =>
  (await signedRequest(
    apiKey,
    secret,
    'GET',
    '/sapi/v1/simple-earn/locked/position',
    options,
  )) as BinanceLockedPosition;
