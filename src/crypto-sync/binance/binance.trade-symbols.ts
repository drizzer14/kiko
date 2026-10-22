import { rethrow } from 'fnts';
import type { CoinLists, ExchangeTrades } from '@kiko/crypto-sync/exchange/walk-state';

import { binanceTickerOf } from './binance.tracked-coin';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';
import type { BinanceExchangeSymbol, ExchangeSymbolsPage } from './binance.history-client';

/**
 * The quote coins a symbol may use without either coin of the user being one of them, so a coin
 * held only on an exchange the user bought it with (a stablecoin, a fiat) still finds its pairs.
 */
export const TRADE_MAIN_QUOTES = [
  'USDT',
  'USDC',
  'FDUSD',
  'BTC',
  'ETH',
  'BNB',
  'EUR',
  'TRY',
] as const;

/**
 * The statuses of a symbol that is read without a stored cursor. BREAK is listed because the
 * leveraged tokens Binance delisted sit in it and a user can still hold old fills on them; the
 * other statuses end a symbol, which stays a candidate only through a cursor already stored.
 */
export const TRADING_SYMBOL_STATUSES = ['TRADING', 'BREAK'] as const;

const NO_WEIGHTS = {
  usedUidWeight1m: undefined,
  usedIpWeight1m: undefined,
  usedApiWeight1m: undefined,
};

const hasStoredCursor = (trades: ExchangeTrades, symbol: string): boolean =>
  typeof trades.symbols[symbol]?.fromId === 'number';

/**
 * The coins a user has touched, read from stored data only. The coins of a symbol with a stored
 * cursor come from the listing, because a symbol name does not say where its base ends; a symbol
 * absent from the listing names none.
 */
export const touchedCoinsOf = (input: {
  holdingAssets: string[];
  trades: ExchangeTrades;
  untrackedCoins: Required<CoinLists>;
  oversizedCoins: Required<CoinLists>;
  listing: BinanceExchangeSymbol[];
}): Set<string> => {
  const { holdingAssets, trades, untrackedCoins, oversizedCoins, listing } = input;
  const readCoins = listing
    .filter(({ symbol }) => hasStoredCursor(trades, symbol))
    .flatMap(({ baseAsset, quoteAsset }) => [baseAsset, quoteAsset]);

  return new Set(
    [
      ...holdingAssets,
      ...untrackedCoins.balance,
      ...untrackedCoins.history,
      ...oversizedCoins.balance,
      ...oversizedCoins.history,
      ...readCoins,
    ].map(binanceTickerOf),
  );
};

const bySymbol = (left: { symbol: string }, right: { symbol: string }): number =>
  Number(left.symbol > right.symbol) - Number(left.symbol < right.symbol);

/**
 * The symbols a trade read can walk, each once, ascending by name: a listed symbol that is
 * tradable, or has a cursor stored (so a symbol that ended after it was read keeps being read
 * while it is listed), and whose two coins are each touched or a main quote.
 */
export const tradeCandidatesOf = (input: {
  listing: BinanceExchangeSymbol[];
  touched: ReadonlySet<string>;
  trades: ExchangeTrades;
}): { symbol: string; baseAsset: string; quoteAsset: string }[] => {
  const { listing, touched, trades } = input;
  const statuses: readonly string[] = TRADING_SYMBOL_STATUSES;
  const quotes: readonly string[] = TRADE_MAIN_QUOTES;
  const known = (coin: string): boolean => touched.has(coin) || quotes.includes(coin);
  const candidates = new Map<string, { symbol: string; baseAsset: string; quoteAsset: string }>();

  for (const { symbol, status, baseAsset, quoteAsset } of listing) {
    const readable = statuses.includes(status) || hasStoredCursor(trades, symbol);

    if (readable && known(baseAsset) && known(quoteAsset)) {
      candidates.set(symbol, { symbol, baseAsset, quoteAsset });
    }
  }

  return [...candidates.values()].sort(bySymbol);
};

/**
 * The one public `exchangeInfo` read of a run, or `undefined` when the lane or the weight reading
 * refuses it, with no request sent. A read that fails after it was sent still counts against the
 * lane's cap (without a weight reading), so a failed run cannot ask a second time.
 */
export const readSpotSymbols = async (
  run: BinanceHistoryRun,
  fetchSymbols: () => Promise<ExchangeSymbolsPage>,
): Promise<ExchangeSymbolsPage | undefined> => {
  if (!run.budget.canAfford('tradeSymbols', COSTS.exchangeInfo)) {
    return undefined;
  }

  await run.gate.wait();

  const page = await fetchSymbols().catch(
    rethrow(() => run.budget.record('tradeSymbols', NO_WEIGHTS)),
  );

  run.budget.record('tradeSymbols', { ...NO_WEIGHTS, usedApiWeight1m: page.usedApiWeight1m });

  return page;
};
