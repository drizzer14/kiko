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
 * `GET /api/v3/account`, signed: HMAC-SHA256 over `timestamp=…&recvWindow=…`
 * under the API secret, appended as `signature`, with the key in the
 * `X-MBX-APIKEY` header. Read-only: a key with only "Enable Reading" is enough.
 */
export const fetchAccount = async (
  apiKey: string,
  secret: string,
  { fetchImpl = fetch, now = Date.now }: FetchAccountOptions = {},
): Promise<BinanceAccount> => {
  const query = `timestamp=${now()}&recvWindow=${RECV_WINDOW_MS}`;
  const signature = signQuery(secret, query);
  const response = await fetchImpl(
    `${BINANCE_API_ENDPOINT}/api/v3/account?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } },
  );

  return (await readBody(response)) as BinanceAccount;
};
