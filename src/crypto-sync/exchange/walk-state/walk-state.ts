import {
  type BinancePendingRange,
  type BinanceSpanHints,
  binanceWalkPendingValueOf,
  binanceWalkRoundRobinValueOf,
  binanceWalkSpanHintsValueOf,
  finiteNumberOrNull,
} from '@kiko/holdings/holding-metadata';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';

export const WALK_IDS = [
  'capital',
  'pay',
  'transfer',
  'earn',
  'convert',
  'p2p',
  'fiatOrders',
  'fiatPayments',
] as const;

export type WalkId = (typeof WALK_IDS)[number];

/** Every field is optional: a walk entry holds only the fields its walk has written. */
export type WalkMarks = {
  cursor?: number | null;
  rescan?: number;
  pending?: BinancePendingRange[];
  pointCursor?: number;
  rangeCursor?: number;
  spanHints?: BinanceSpanHints;
};

export type CoinLists = {
  /** Replaced by each good balance read. */
  balance?: string[];
  /** Grows with each history read, and is cleared on disconnect. */
  history?: string[];
};

type TradeSymbol = { fromId: number | null; heldOrderId?: number };

export type ExchangeTrades = {
  symbols: Record<string, TradeSymbol>;
  rotation: number;
  balanceSnapshot: Record<string, string>;
};

/** The JSON stored in `sync_state.exchange_state`. */
export type ExchangeState = {
  version: 1;
  walks: Partial<Record<WalkId, WalkMarks>>;
  trades?: ExchangeTrades;
  untrackedCoins?: CoinLists;
  oversizedCoins?: CoinLists;
};

/**
 * The marks of one walk as a run reads them. A field a walk repairs when it is unreadable keeps
 * the tri-state of the rule that reads it: `undefined` is a value that is stored but unreadable
 * (the walk logs a fixed code and writes the repair of that one field), where an absent field
 * reads as its empty value.
 */
export type ParsedWalkMarks = {
  cursor: number | null;
  rescan: number | null;
  pending: BinancePendingRange[] | undefined;
  pointCursor: number | null | undefined;
  rangeCursor: number | null | undefined;
  spanHints: BinanceSpanHints | undefined;
};

/**
 * `malformed`: the top level is no state this build reads, so no history walk runs and nothing
 * writes the column. `parsed`: every entry read on its own; `unreadable` names each entry that
 * was stored but read as its empty value (`walks.<id>`, `trades`, `<kind>.balance`, ...).
 */
export type ParsedExchangeState =
  | { kind: 'malformed' }
  | {
      kind: 'parsed';
      walks: Record<WalkId, ParsedWalkMarks>;
      trades: ExchangeTrades;
      untrackedCoins: Required<CoinLists>;
      oversizedCoins: Required<CoinLists>;
      unreadable: string[];
    };

type Metadata = Record<string, unknown>;

type ReadEntry<Value> = { value: Value; unreadable: string[] };

const isNumber = (value: unknown): value is number => finiteNumberOrNull(value) !== null;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isTextRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

const recordOrUndefined = (value: unknown): Metadata | undefined =>
  isRecord(value) ? value : undefined;

const stringListOrUndefined = (value: unknown): string[] | undefined =>
  isStringList(value) ? value : undefined;

/** Each field follows the rule that reads it from a holding's metadata today. */
const marksOf = (entry: Metadata): ParsedWalkMarks => ({
  cursor: finiteNumberOrNull(entry.cursor),
  rescan: finiteNumberOrNull(entry.rescan),
  pending: binanceWalkPendingValueOf(entry.pending),
  pointCursor: binanceWalkRoundRobinValueOf(entry.pointCursor),
  rangeCursor: binanceWalkRoundRobinValueOf(entry.rangeCursor),
  spanHints: binanceWalkSpanHintsValueOf(entry.spanHints),
});

const emptyMarks = (): ParsedWalkMarks => marksOf({});

const tradeSymbolOf = (stored: unknown): TradeSymbol | undefined => {
  if (!isRecord(stored)) {
    return undefined;
  }

  const { fromId, heldOrderId } = stored;

  if (fromId !== null && !isNumber(fromId)) {
    return undefined;
  }

  if (heldOrderId === undefined) {
    return { fromId };
  }

  return isNumber(heldOrderId) ? { fromId, heldOrderId } : undefined;
};

const tradeSymbolsOf = (stored: unknown): Record<string, TradeSymbol> | undefined => {
  if (!isRecord(stored)) {
    return undefined;
  }

  const symbols = Object.entries(stored).map(([symbol, entry]) => [symbol, tradeSymbolOf(entry)]);

  return symbols.every((symbol): symbol is [string, TradeSymbol] => symbol[1] !== undefined)
    ? Object.fromEntries(symbols)
    : undefined;
};

const tradesOf = (stored: unknown): ExchangeTrades | undefined => {
  if (!isRecord(stored)) {
    return undefined;
  }

  const { rotation, balanceSnapshot } = stored;
  const symbols = tradeSymbolsOf(stored.symbols);

  return symbols !== undefined && isNumber(rotation) && isTextRecord(balanceSnapshot)
    ? { symbols, rotation, balanceSnapshot }
    : undefined;
};

const emptyTrades = (): ExchangeTrades => ({ symbols: {}, rotation: 0, balanceSnapshot: {} });

const emptyList = (): string[] => [];

const emptyRecord = (): Metadata => ({});

/** A stored value `parse` cannot read reads as `empty()` and is named, unless it is absent. */
const entryOf = <Value>(
  name: string,
  stored: unknown,
  parse: (stored: unknown) => Value | undefined,
  empty: () => Value,
): ReadEntry<Value> => {
  const parsed = parse(stored);

  return {
    value: parsed ?? empty(),
    unreadable: stored !== undefined && parsed === undefined ? [name] : [],
  };
};

/** The two lists of a kind parse alone, so a malformed one never empties the other. */
const coinListsOf = (kind: string, stored: unknown): ReadEntry<Required<CoinLists>> => {
  const container = entryOf(kind, stored, recordOrUndefined, emptyRecord);
  const { balance: storedBalance, history: storedHistory } = container.value;
  const balance = entryOf(`${kind}.balance`, storedBalance, stringListOrUndefined, emptyList);
  const history = entryOf(`${kind}.history`, storedHistory, stringListOrUndefined, emptyList);

  return {
    value: { balance: balance.value, history: history.value },
    unreadable: [...container.unreadable, ...balance.unreadable, ...history.unreadable],
  };
};

type TopLevel = Metadata & { walks: Metadata };

const isTopLevel = (stored: unknown): stored is TopLevel =>
  isRecord(stored) && stored.version === 1 && isRecord(stored.walks);

const parsedOf = (stored: TopLevel): ParsedExchangeState => {
  const walks = WALK_IDS.map((walkId) => ({
    walkId,
    ...entryOf(
      `walks.${walkId}`,
      stored.walks[walkId],
      (entry) => foldMap(maybe(recordOrUndefined(entry)), marksOf),
      emptyMarks,
    ),
  }));
  const trades = entryOf('trades', stored.trades, tradesOf, emptyTrades);
  const untrackedCoins = coinListsOf('untrackedCoins', stored.untrackedCoins);
  const oversizedCoins = coinListsOf('oversizedCoins', stored.oversizedCoins);

  return {
    kind: 'parsed',
    walks: Object.fromEntries(walks.map(({ walkId, value }) => [walkId, value])) as Record<
      WalkId,
      ParsedWalkMarks
    >,
    trades: trades.value,
    untrackedCoins: untrackedCoins.value,
    oversizedCoins: oversizedCoins.value,
    unreadable: [
      ...walks.flatMap(({ unreadable }) => unreadable),
      ...trades.unreadable,
      ...untrackedCoins.unreadable,
      ...oversizedCoins.unreadable,
    ],
  };
};

const parsedFromText = (text: string): ParsedExchangeState => {
  const stored: unknown = bifoldr(eitherSync<Error, unknown>(() => JSON.parse(text)));

  return isTopLevel(stored) ? parsedOf(stored) : { kind: 'malformed' };
};

/**
 * Reads the text of `sync_state.exchange_state` in two levels: the top level (an object with
 * `version: 1` and an object `walks`) is malformed or not, and then every entry parses on its own
 * and reads as its empty value when it is unreadable, so a malformed entry never empties another.
 * No text (no row, or a column never written) is a state with nothing in it.
 */
export const parseExchangeState = (text: string | null): ParsedExchangeState =>
  foldMap(maybe(text), parsedFromText) ?? parsedFromText('{"version":1,"walks":{}}');
