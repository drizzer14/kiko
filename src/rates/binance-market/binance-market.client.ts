import {
  COSTS,
  type CallCost,
  createBinanceHistoryRun,
  isBinanceCoolingDown,
  retryAfterMsFromHeaders,
  setBinanceCooldownUntil,
  usedApiWeightFromHeaders,
} from '@kiko/crypto-sync/binance';
import { DAY_MS } from '@kiko/dates';
import { match, P } from 'ts-pattern';
import { BINANCE_API_ENDPOINT } from '@env';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import either, { bifoldr } from 'fnts/either';

import { toUtcMidnight } from '../history-entry';

/** One day's candle of a symbol: the UTC day it opened and the price it closed at. */
export type DailyClose = { day: number; close: number };

type BinanceMarketOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  /**
   * Where the Retry-After of a refused run is kept, in the cooldown store the account reads share.
   * A caller never sets it; a test gives each case its own, because the store outlives a run.
   */
  cooldownKey?: string;
};

/**
 * One run's reads of Binance's public market data. A read that fails for any reason is `undefined`
 * (no price), never a throw: the coin stays as unpriced as it was and nothing else in the refresh
 * is touched.
 */
export type BinanceMarketClient = {
  tickerPrice: (symbol: string) => Promise<number | undefined>;
  dailyCloses: (symbol: string, start: number, end: number) => Promise<DailyClose[] | undefined>;
};

const MARKET_COOLDOWN_KEY = 'binance-public-market';

/** Binance serves at most 1000 candles per klines call. */
const MAX_KLINES_PER_CALL = 1000;

const positiveNumberOf = (value: unknown): number | undefined => {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const closeOf = (row: unknown): DailyClose | undefined => {
  const [openTime, , , , close] = Array.isArray(row) ? row : [];
  const price = positiveNumberOf(close);

  return typeof openTime === 'number' && price !== undefined
    ? { day: toUtcMidnight(openTime), close: price }
    : undefined;
};

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const createBinanceMarketClient = (
  options: BinanceMarketOptions = {},
): BinanceMarketClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cooldownKey = options.cooldownKey ?? MARKET_COOLDOWN_KEY;
  const run = createBinanceHistoryRun({ now, sleep: options.sleep ?? defaultSleep });
  // A region block (451, 403) holds for the whole IP and carries no Retry-After, so it ends this
  // run's reads: the next symbol would be refused the same way. A rate limit ends them through the
  // cooldown it stores.
  let refused = false;

  const read = async (path: string, cost: CallCost): Promise<unknown> => {
    if (
      refused ||
      isBinanceCoolingDown(cooldownKey, now()) ||
      !run.budget.canAfford('market', cost)
    ) {
      return undefined;
    }
    await run.gate.wait();

    const response = bifoldr(await either(() => fetchImpl(`${BINANCE_API_ENDPOINT}${path}`)));

    if (response === undefined) {
      return undefined;
    }
    run.budget.record('market', {
      usedUidWeight1m: undefined,
      usedIpWeight1m: undefined,
      usedApiWeight1m: usedApiWeightFromHeaders(response.headers),
    });

    return match(response.status)
      .with(P.union(418, 429), () => {
        setBinanceCooldownUntil(cooldownKey, now() + retryAfterMsFromHeaders(response.headers));

        return undefined;
      })
      .with(P.union(403, 451), () => {
        refused = true;

        return undefined;
      })
      .otherwise(async () =>
        response.ok ? bifoldr(await either(() => response.json())) : undefined,
      );
  };

  return {
    tickerPrice: async (symbol) => {
      const body = await read(`/api/v3/ticker/price?symbol=${symbol}`, COSTS.ticker);

      return isRecord(body) ? positiveNumberOf(body.price) : undefined;
    },
    dailyCloses: async (symbol, start, end) => {
      const from = Math.max(start, end - (MAX_KLINES_PER_CALL - 1) * DAY_MS);
      const limit = Math.round((end - from) / DAY_MS) + 1;
      const body = await read(
        `/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${from}&endTime=${end + DAY_MS - 1}&limit=${limit}`,
        COSTS.klines,
      );

      return Array.isArray(body)
        ? body.flatMap((row) => foldMap(maybe(closeOf(row)), (candle) => [candle]) ?? [])
        : undefined;
    },
  };
};
