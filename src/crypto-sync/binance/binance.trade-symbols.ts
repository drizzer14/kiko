import { rethrow } from 'fnts';
import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import type {
  CoinLists,
  ExchangeStatePatch,
  ExchangeTrades,
} from '@kiko/crypto-sync/exchange/walk-state';
import { IdCursorPageError } from '@kiko/crypto-sync/exchange/paging';

import {
  type BinanceExchangeSymbol,
  BinanceHistoryParseError,
  type ExchangeSymbolsPage,
} from './binance.history-client';
import { binanceTickerOf } from './binance.tracked-coin';
import { BinanceInvalidSymbolError } from './binance.client';
import { type BinanceHistoryRun, COSTS } from './binance.history-budget';

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

type TradeCandidate = { symbol: string; baseAsset: string; quoteAsset: string };

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
 * while it is listed), and with at least one touched coin, the other touched or a main quote. A
 * pair of two main quotes with neither touched is not one, so the many pairs of the main quotes
 * with each other do not fill the lane for a user who holds none of them.
 */
export const tradeCandidatesOf = (input: {
  listing: BinanceExchangeSymbol[];
  touched: ReadonlySet<string>;
  trades: ExchangeTrades;
}): TradeCandidate[] => {
  const { listing, touched, trades } = input;
  const statuses: readonly string[] = TRADING_SYMBOL_STATUSES;
  const quotes: readonly string[] = TRADE_MAIN_QUOTES;
  const known = (coin: string): boolean => touched.has(coin) || quotes.includes(coin);
  const candidates = new Map<string, TradeCandidate>();

  for (const { symbol, status, baseAsset, quoteAsset } of listing) {
    const readable = statuses.includes(status) || hasStoredCursor(trades, symbol);

    const anyTouched = touched.has(baseAsset) || touched.has(quoteAsset);

    if (readable && anyTouched && known(baseAsset) && known(quoteAsset)) {
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

type BalanceTexts = Readonly<Record<string, string>>;

/** How a coin reads when the balance read did not list it, so a coin at zero is never "new". */
const NO_BALANCE_TEXT = '0/0';

/**
 * The calls a priority read leaves in the lane for the round-robin. Priority reads can fill a
 * lane whole every run (a symbol held or changed stays so until it is read), so without one call
 * kept back the round-robin would never start and the symbols after the priority list would never
 * be read.
 */
const RESERVED_CALLS = 1;

type TradeReadClass = 'priority' | 'roundRobin';

/** The order the read classes run in. */
const READ_ORDER: readonly TradeReadClass[] = ['priority', 'roundRobin'];

/**
 * What a class of read leaves of the lane (`keep`), and whether a symbol it reads moves the
 * rotation: a priority symbol is not read in rotation order, so only a round-robin one does.
 */
const READ_CLASSES: Record<TradeReadClass, { keep: number; movesRotation: boolean }> = {
  priority: { keep: RESERVED_CALLS, movesRotation: false },
  roundRobin: { keep: 0, movesRotation: true },
};

/**
 * How a symbol read finished. `failed` is a read that threw an error of that one symbol (see
 * `isSymbolFailure`): its answer is unknown, so its coins stay unfinished.
 */
type TradeReadEnd = 'short-page' | 'budget' | 'stopped' | 'failed';

/**
 * The errors that name one symbol and no other: a page the id cursor cannot trust, a body that
 * does not parse, and a symbol Binance does not know. Every other error (a rate limit, a refused
 * key, a network failure) may hold for every symbol, so it stops the run and shows.
 */
const isSymbolFailure = (error: unknown): boolean =>
  error instanceof IdCursorPageError ||
  error instanceof BinanceHistoryParseError ||
  error instanceof BinanceInvalidSymbolError;

/** The order the priority reads run in: a held symbol first, a changed one last. */
const PRIORITY_CLASSES = ['held', 'never-read', 'changed'] as const;

const balanceTextOf = (balanceTexts: BalanceTexts, coin: string): string =>
  balanceTexts[coin] ?? NO_BALANCE_TEXT;

const coinsOf = ({ baseAsset, quoteAsset }: TradeCandidate): string[] => [baseAsset, quoteAsset];

const priorityClassOf = (
  candidate: TradeCandidate,
  trades: ExchangeTrades,
  balanceTexts: BalanceTexts,
): (typeof PRIORITY_CLASSES)[number] | 'rest' =>
  match({
    held: typeof trades.symbols[candidate.symbol]?.heldOrderId === 'number',
    neverRead: !hasStoredCursor(trades, candidate.symbol),
    changed: coinsOf(candidate).some(
      (coin) => trades.balanceSnapshot[coin] !== balanceTextOf(balanceTexts, coin),
    ),
  })
    .with({ held: true }, () => 'held' as const)
    .with({ neverRead: true }, () => 'never-read' as const)
    .with({ changed: true }, () => 'changed' as const)
    .otherwise(() => 'rest' as const);

/**
 * The order a run reads the symbols in. `priority` holds the symbols owed a read now: a held
 * order to re-read, a symbol never read, one whose coin balance moved since its last complete
 * read, each class ascending. `roundRobin` holds every candidate, from the first symbol after
 * the stored rotation and wrapped, because a priority symbol the lane had no room for is still
 * reached by it; the run skips what it has already read. The candidates come ascending by name, as
 * `tradeCandidatesOf` lists them.
 */
export const planTradeSymbolReads = (input: {
  candidates: TradeCandidate[];
  trades: ExchangeTrades;
  balanceTexts: BalanceTexts;
}): { priority: string[]; roundRobin: string[] } => {
  const { candidates, trades, balanceTexts } = input;
  const classes = candidates.map((candidate) => ({
    symbol: candidate.symbol,
    priorityClass: priorityClassOf(candidate, trades, balanceTexts),
  }));
  const symbols = candidates.map(({ symbol }) => symbol);

  return {
    priority: PRIORITY_CLASSES.flatMap((wanted) =>
      classes.filter(({ priorityClass }) => priorityClass === wanted).map(({ symbol }) => symbol),
    ),
    roundRobin: [
      ...symbols.filter((symbol) => symbol > trades.rotation),
      ...symbols.filter((symbol) => symbol <= trades.rotation),
    ],
  };
};

/**
 * Read the planned symbols, the priority first (while the lane affords the read and one more
 * call) and then the round-robin (while it affords the read), each symbol at most once. `ended`
 * answers how each symbol that was read finished. `rotation` is the last round-robin symbol whose
 * read returned an answer, a `failed` one included, so a symbol that fails every run cannot hold
 * the rotation back; a read that stops the run is not one, so the next run asks that symbol again
 * before any after it.
 *
 * A read that throws an error of its one symbol (`isSymbolFailure`) ends only that symbol as
 * `failed` and the run goes on; the error is kept in `symbolFailures` for the caller to log. Any
 * other error ends the run and comes back as `failure`, with the progress made so far, so the
 * caller can write it before it passes the error on.
 */
export const runTradeSymbolReads = async (input: {
  plan: { priority: string[]; roundRobin: string[] };
  canAfford: (keep: number) => boolean;
  readSymbol: (symbol: string, keep: number) => Promise<{ ended: TradeReadEnd }>;
}): Promise<{
  rotation: string | undefined;
  ended: Record<string, TradeReadEnd>;
  symbolFailures: { symbol: string; error: unknown }[];
  failure: { error: unknown } | undefined;
}> => {
  const { plan, canAfford, readSymbol } = input;
  const ended: Record<string, TradeReadEnd> = {};
  const symbolFailures: { symbol: string; error: unknown }[] = [];
  const started = new Set<string>();
  let rotation: string | undefined;

  const reads = READ_ORDER.flatMap((readClass) =>
    plan[readClass].map((symbol) => ({ symbol, ...READ_CLASSES[readClass] })),
  );

  for (const { symbol, keep, movesRotation } of reads) {
    if (started.has(symbol) || !canAfford(keep)) {
      continue;
    }

    started.add(symbol);

    try {
      ended[symbol] = (await readSymbol(symbol, keep)).ended;
    } catch (error) {
      if (!isSymbolFailure(error)) {
        return { rotation, ended, symbolFailures, failure: { error } };
      }

      ended[symbol] = 'failed';
      symbolFailures.push({ symbol, error });
    }

    if (movesRotation) {
      rotation = symbol;
    }
  }

  return { rotation, ended, symbolFailures, failure: undefined };
};

/**
 * The writes a run's reads owe the stored `trades`: the rotation when a round-robin read
 * returned, and the balance snapshot. A coin takes its current text in the snapshot only when
 * every candidate symbol with that coin ended at a short page in this run; every other entry
 * keeps its stored text, so a balance change stays "changed" while a symbol of its coin is unread.
 * No snapshot is written when no entry would differ from the stored one.
 */
export const tradesPatchesOf = (input: {
  candidates: TradeCandidate[];
  trades: ExchangeTrades;
  balanceTexts: BalanceTexts;
  result: { rotation: string | undefined; ended: Readonly<Record<string, TradeReadEnd>> };
}): ExchangeStatePatch[] => {
  const { candidates, trades, balanceTexts, result } = input;
  const rotationPatches =
    foldMap(maybe(result.rotation), (value): ExchangeStatePatch[] => [
      { kind: 'tradesRotation', value },
    ]) ?? [];
  const unfinished = new Set(
    candidates.filter(({ symbol }) => result.ended[symbol] !== 'short-page').flatMap(coinsOf),
  );
  const finished = [...new Set(candidates.flatMap(coinsOf))]
    .filter((coin) => !unfinished.has(coin))
    .map((coin): [string, string] => [coin, balanceTextOf(balanceTexts, coin)]);

  if (finished.every(([coin, text]) => trades.balanceSnapshot[coin] === text)) {
    return rotationPatches;
  }

  return [
    ...rotationPatches,
    {
      kind: 'tradesBalanceSnapshot',
      value: { ...trades.balanceSnapshot, ...Object.fromEntries(finished) },
    },
  ];
};
