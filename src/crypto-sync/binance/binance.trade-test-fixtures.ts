import type { HoldingRow } from '@kiko/db';

import { NO_WEIGHTS } from './binance.trade-symbols';
import type { BinanceTradeHistoryDeps } from './binance.trade-history';
import type { BinanceExchangeSymbol, BinanceMyTrade } from './binance.history-client';

/** When the fixture fills were made: the fill with id `n` is `n` milliseconds after this. */
export const FIRST_FILL_AT = 1_700_000_000_000;

/** A buy fill of 0.01 BTC for 600 USDT with no commission; a test overrides what it varies. */
export const fillOf = (
  id: number,
  orderId: number,
  over: Partial<BinanceMyTrade> = {},
): BinanceMyTrade => ({
  id,
  orderId,
  qty: '0.01',
  quoteQty: '600',
  commission: '0',
  commissionAsset: 'BTC',
  isBuyer: true,
  time: FIRST_FILL_AT + id,
  ...over,
});

/** The fills of one order with the ids `first` to `last`, each as `fillOf` makes it. */
export const fillsBetween = (
  orderId: number,
  first: number,
  last: number,
  over: Partial<BinanceMyTrade> = {},
): BinanceMyTrade[] =>
  Array.from({ length: last - first + 1 }, (_unused, offset) =>
    fillOf(first + offset, orderId, over),
  );

export const listed = (
  symbol: string,
  baseAsset: string,
  quoteAsset: string,
  status = 'TRADING',
): BinanceExchangeSymbol => ({ symbol, status, baseAsset, quoteAsset });

/** A stored Spot holding of one coin, with the id `holding-<coin>` the rows name it by. */
export const holdingWith = (key: string): HoldingRow =>
  ({ id: `holding-${key}`, metadata: { binanceAsset: key } }) as unknown as HoldingRow;

/** The fills of each symbol in id order, and the most fills one answer holds. */
export type FillServer = { fills: Record<string, BinanceMyTrade[]>; pageLimit: number };

/**
 * The two fill reads over `server`, read at each call, so a test can add fills and change the
 * page limit between runs and while a run is reading.
 */
export const fillReadsOf = (
  server: FillServer,
): Pick<BinanceTradeHistoryDeps, 'fetchMyTrades' | 'fetchOrderFills'> => {
  const fillsOf = (symbol: string): BinanceMyTrade[] => server.fills[symbol] ?? [];

  return {
    fetchMyTrades: async (_apiKey, _secret, symbol, fromId) => ({
      rows: fillsOf(symbol)
        .filter((fill) => Number(fill.id) >= fromId)
        .slice(0, server.pageLimit),
      ...NO_WEIGHTS,
    }),
    fetchOrderFills: async (_apiKey, _secret, symbol, orderId, fromId) => ({
      rows: fillsOf(symbol)
        .filter((fill) => fill.orderId === orderId && Number(fill.id) >= fromId)
        .slice(0, server.pageLimit),
      ...NO_WEIGHTS,
    }),
  };
};
