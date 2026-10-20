import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';
import { bifoldr, eitherSync } from 'fnts/either';

import {
  type BinancePendingRange,
  type BinanceSpanHints,
  binanceWalkPendingValueOf,
  binanceWalkRoundRobinValueOf,
  binanceWalkSpanHintsValueOf,
  finiteNumberOrNull,
} from './walk-values';

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
  /** The cursor the walk's first multi-coin run planned from: ground before it holds BTC only. */
  multiCoinSince?: number;
  /** The walk's first multi-coin run committed a window, so it never records a start again. */
  multiCoinSeen?: true;
};

export type CoinLists = {
  /**
   * Replaced by each good balance read. The oversized kind derives it from `balanceByWallet`
   * (see `exchangeStatePatched`), so it always holds the wallet arrays and the legacy tickers.
   */
  balance?: string[];
  /** Grows with each history read, and is cleared on disconnect. */
  history?: string[];
};

/**
 * The oversized coins also name the wallet that refused each one (`spot`, `funding`, `earn`), so
 * a read in which a wallet failed replaces only the arrays of the wallets that read. A `balance`
 * ticker in no wallet array was stored before wallets were named (legacy).
 */
export type OversizedCoinLists = CoinLists & { balanceByWallet?: Record<string, string[]> };

export type TradeSymbol = { fromId: number | null; heldOrderId?: number };

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
  oversizedCoins?: OversizedCoinLists;
  /** When the last good balance read ran (epoch ms), for an account with no holding to stamp. */
  balanceSyncedAt?: number;
};

/**
 * The marks of one walk as a run reads them. A field a walk repairs when it is unreadable keeps
 * the tri-state of the rule that reads it: `undefined` is a value that is stored but unreadable
 * (the walk logs a fixed code and writes the repair of that one field), where an absent field
 * reads as its empty value. A `pending` list that is defined can still fail its walk's series
 * check (`readPendingMark`, `hasKnownSeries`), which repairs it in the walk, not here. The two
 * multi-coin marks are absent keys when the walk has none, and a malformed one is never repaired:
 * it reads as the fail-safe value (`multiCoinSinceOf`; a seen mark that is not `true` is absent).
 */
export type ParsedWalkMarks = {
  cursor: number | null;
  rescan: number | null;
  pending: BinancePendingRange[] | undefined;
  pointCursor: number | null | undefined;
  rangeCursor: number | null | undefined;
  spanHints: BinanceSpanHints | undefined;
  multiCoinSince?: number;
  multiCoinSeen?: true;
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
      balanceSyncedAt: number | undefined;
      unreadable: string[];
    };

export type Metadata = Record<string, unknown>;

type ReadEntry<Value> = { value: Value; unreadable: string[] };

const isNumber = (value: unknown): value is number => finiteNumberOrNull(value) !== null;

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const numberOrUndefined = (value: unknown): number | undefined =>
  isNumber(value) ? value : undefined;

const textOrUndefined = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const recordOrUndefined = (value: unknown): Metadata | undefined =>
  isRecord(value) ? value : undefined;

const stringListOrUndefined = (value: unknown): string[] | undefined =>
  isStringList(value) ? value : undefined;

/**
 * A stored range start that is no finite number reads as the entry's cursor, and as none when that
 * is null: the later start owes a range rather than none, so a malformed one never skips ground.
 */
const multiCoinSinceOf = (entry: Metadata, cursor: number | null): number | undefined => {
  if (!('multiCoinSince' in entry)) {
    return undefined;
  }

  return numberOrUndefined(entry.multiCoinSince) ?? cursor ?? undefined;
};

/** Each field parses with the one rule that decides what is readable and what a walk repairs. */
const marksOf = (entry: Metadata): ParsedWalkMarks => {
  const cursor = finiteNumberOrNull(entry.cursor);

  return {
    cursor,
    rescan: finiteNumberOrNull(entry.rescan),
    pending: binanceWalkPendingValueOf(entry.pending),
    pointCursor: binanceWalkRoundRobinValueOf(entry.pointCursor),
    rangeCursor: binanceWalkRoundRobinValueOf(entry.rangeCursor),
    spanHints: binanceWalkSpanHintsValueOf(entry.spanHints),
    ...foldMap(maybe(multiCoinSinceOf(entry, cursor)), (multiCoinSince) => ({ multiCoinSince })),
    ...(entry.multiCoinSeen === true ? { multiCoinSeen: true as const } : {}),
  };
};

const emptyMarks = (): ParsedWalkMarks => marksOf({});

/** A `null` heldOrderId is a cleared one: the same symbol as one that never held an order. */
const tradeSymbolOf = (stored: unknown): TradeSymbol | undefined => {
  if (!isRecord(stored)) {
    return undefined;
  }

  const { fromId, heldOrderId } = stored;

  if (fromId !== null && !isNumber(fromId)) {
    return undefined;
  }

  if (heldOrderId === undefined || heldOrderId === null) {
    return { fromId };
  }

  return isNumber(heldOrderId) ? { fromId, heldOrderId } : undefined;
};

const zero = (): number => 0;

const nothing = (): undefined => undefined;

const emptyList = (): string[] => [];

const emptyRecord = (): Metadata => ({});

/** A stored value that is no record reads as an empty one, for a writer that replaces it. */
export const recordOrEmpty = (value: unknown): Metadata =>
  recordOrUndefined(value) ?? emptyRecord();

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

/**
 * Every entry of a record parses alone: one `parse` cannot read is dropped and named
 * `<name>.<key>`, so a bad entry never empties the good ones next to it.
 */
const recordOf = <Value>(
  name: string,
  stored: unknown,
  parse: (stored: unknown) => Value | undefined,
): ReadEntry<Record<string, Value>> => {
  const container = entryOf(name, stored, recordOrUndefined, emptyRecord);
  const entries = Object.entries(container.value).map(([key, entry]) => ({
    key,
    parsed: parse(entry),
  }));

  return {
    value: Object.fromEntries(
      entries.flatMap(
        ({ key, parsed }) =>
          foldMap(maybe(parsed), (value): [string, Value][] => [[key, value]]) ?? [],
      ),
    ),
    unreadable: [
      ...container.unreadable,
      ...entries.filter(({ parsed }) => parsed === undefined).map(({ key }) => `${name}.${key}`),
    ],
  };
};

/** Each part of the trades parses alone, so a bad part never empties another. */
const tradesOf = (stored: unknown): ReadEntry<ExchangeTrades> => {
  const container = entryOf('trades', stored, recordOrUndefined, emptyRecord);
  const symbols = recordOf('trades.symbols', container.value.symbols, tradeSymbolOf);
  const rotation = entryOf('trades.rotation', container.value.rotation, numberOrUndefined, zero);
  const balanceSnapshot = recordOf(
    'trades.balanceSnapshot',
    container.value.balanceSnapshot,
    textOrUndefined,
  );

  return {
    value: {
      symbols: symbols.value,
      rotation: rotation.value,
      balanceSnapshot: balanceSnapshot.value,
    },
    unreadable: [
      ...container.unreadable,
      ...symbols.unreadable,
      ...rotation.unreadable,
      ...balanceSnapshot.unreadable,
    ],
  };
};

/** The two lists of a kind parse alone, so a malformed one never empties the other. */
export const coinListsOf = (kind: string, stored: unknown): ReadEntry<Required<CoinLists>> => {
  const container = entryOf(kind, stored, recordOrUndefined, emptyRecord);
  const { balance: storedBalance, history: storedHistory } = container.value;
  const balance = entryOf(`${kind}.balance`, storedBalance, stringListOrUndefined, emptyList);
  const history = entryOf(`${kind}.history`, storedHistory, stringListOrUndefined, emptyList);

  return {
    value: { balance: balance.value, history: history.value },
    unreadable: [...container.unreadable, ...balance.unreadable, ...history.unreadable],
  };
};

/**
 * The wallet arrays of the oversized balance list. Each wallet parses alone, so an array that is
 * unreadable is dropped and named while the others stay; the tickers it held then read as legacy
 * ones, since they sit in `balance` and in no wallet array.
 */
export const oversizedByWalletOf = (stored: unknown): ReadEntry<Record<string, string[]>> =>
  recordOf('oversizedCoins.balanceByWallet', stored, stringListOrUndefined);

/** The stored JSON as a writer sees it: raw values, so a field no build reads stays as stored. */
export type StoredExchangeState = Metadata & { walks: Metadata };

const isTopLevel = (stored: unknown): stored is StoredExchangeState =>
  isRecord(stored) && stored.version === 1 && isRecord(stored.walks);

const parsedOf = (stored: StoredExchangeState): ParsedExchangeState => {
  const walks = WALK_IDS.map((walkId) => ({
    walkId,
    ...entryOf(
      `walks.${walkId}`,
      stored.walks[walkId],
      (entry) => foldMap(maybe(recordOrUndefined(entry)), marksOf),
      emptyMarks,
    ),
  }));
  const trades = tradesOf(stored.trades);
  const untrackedCoins = coinListsOf('untrackedCoins', stored.untrackedCoins);
  const oversizedCoins = coinListsOf('oversizedCoins', stored.oversizedCoins);
  const oversizedByWallet = oversizedByWalletOf(
    recordOrEmpty(stored.oversizedCoins).balanceByWallet,
  );
  const balanceSyncedAt = entryOf<number | undefined>(
    'balanceSyncedAt',
    stored.balanceSyncedAt,
    numberOrUndefined,
    nothing,
  );

  return {
    kind: 'parsed',
    walks: Object.fromEntries(walks.map(({ walkId, value }) => [walkId, value])) as Record<
      WalkId,
      ParsedWalkMarks
    >,
    trades: trades.value,
    untrackedCoins: untrackedCoins.value,
    oversizedCoins: oversizedCoins.value,
    balanceSyncedAt: balanceSyncedAt.value,
    unreadable: [
      ...walks.flatMap(({ unreadable }) => unreadable),
      ...trades.unreadable,
      ...untrackedCoins.unreadable,
      ...oversizedCoins.unreadable,
      ...oversizedByWallet.unreadable,
      ...balanceSyncedAt.unreadable,
    ],
  };
};

const topLevelFromText = (text: string): StoredExchangeState | undefined => {
  const stored: unknown = bifoldr(eitherSync<Error, unknown>(() => JSON.parse(text)));

  return isTopLevel(stored) ? stored : undefined;
};

const emptyStoredState = (): StoredExchangeState => ({ version: 1, walks: {} });

/**
 * The raw top level of `sync_state.exchange_state`, or `undefined` when it is malformed (an object
 * with `version: 1` and an object `walks` is the only top level a build reads). No text (no row,
 * or a column never written) is a state with nothing in it. The one rule for "malformed", for the
 * parse that reads the column and for the writers that patch its raw JSON.
 */
export const storedExchangeStateOf = (text: string | null): StoredExchangeState | undefined =>
  text === null ? emptyStoredState() : topLevelFromText(text);

/**
 * Reads the text of `sync_state.exchange_state` in two levels: the top level is malformed or not,
 * and then every entry parses on its own and reads as its empty value when it is unreadable, so a
 * malformed entry never empties another.
 */
export const parseExchangeState = (text: string | null): ParsedExchangeState =>
  foldMap(maybe(storedExchangeStateOf(text)), parsedOf) ?? { kind: 'malformed' };
