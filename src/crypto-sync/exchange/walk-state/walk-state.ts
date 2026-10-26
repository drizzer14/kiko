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

/** Why a record was refused for good, as the first part of a `notImported` entry. */
export const NOT_IMPORTED_KINDS = [
  'p2p-sale',
  'p2p-advertiser',
  'p2p-amount',
  'p2p-unrecognized',
  'convert-unrecognized',
  'fiat-unrecognized',
] as const;

export type NotImportedKind = (typeof NOT_IMPORTED_KINDS)[number];

/** The entry that names one refused record: its kind, its id and its time, joined by colons. */
export const notImportedEntry = (kind: NotImportedKind, recordId: string, timeMs: number): string =>
  `${kind}:${recordId}:${timeMs}`;

/** The kind an entry starts with, or `undefined` for text no build of this kind reads. */
export const notImportedKindOf = (entry: string): NotImportedKind | undefined =>
  NOT_IMPORTED_KINDS.find((kind) => entry.startsWith(`${kind}:`));

const isKnownNotImportedEntry = (entry: unknown): entry is string =>
  typeof entry === 'string' && notImportedKindOf(entry) !== undefined;

/** Every field is optional: a walk entry holds only the fields its walk has written. */
export type WalkMarks = {
  cursor?: number | null;
  rescan?: number;
  pending?: BinancePendingRange[];
  pointCursor?: number;
  rangeCursor?: number;
  spanHints?: BinanceSpanHints;
  /**
   * The walk's last run read behind its cursor (the fiat orders walk alternates behind and
   * forward runs), so its next run reads forward. A disconnect drops it with the other run marks.
   */
  behindRun?: boolean;
  /**
   * The walk's next behind run reads the window re-scan rather than the owed windows (it alternates
   * them, and the forward run between two behind runs keeps this). A disconnect drops it too.
   */
  rescanTurn?: boolean;
  /**
   * The owed ranges the walk's window re-scan failed on and now reads around (the fiat orders walk
   * isolates a stuck stretch instead of owing, or failing on, the whole window). Each is still in
   * the list of owed ground, which clears it once a read of it passes. A disconnect drops it too.
   */
  rescanStuck?: BinancePendingRange[];
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

/**
 * `rowlessOrderIds` are the orders of the symbol that came to no row and that the cursor has
 * passed: a later fill of one is written with the fills that came before it.
 */
export type TradeSymbol = {
  fromId: number | null;
  heldOrderId?: number;
  rowlessOrderIds?: number[];
};

export type ExchangeTrades = {
  symbols: Record<string, TradeSymbol>;
  /** The last symbol whose round-robin read returned; empty starts at the first symbol. */
  rotation: string;
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
  /** Each record a rule refused for good, once; only a disconnect clears it. */
  notImported?: string[];
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
  behindRun?: true;
  rescanTurn?: true;
  rescanStuck?: BinancePendingRange[];
  multiCoinSince?: number;
  multiCoinSeen?: true;
};

/**
 * `malformed`: the top level is no state this build reads, so no history walk runs and nothing
 * writes the column. `parsed`: every entry read on its own; `unreadable` names each entry that
 * was stored but read as its empty value (`walks.<id>`, `trades`, `<kind>.balance`, ...).
 * `notImported` holds the entries of a kind this build reads, once each, in the stored order.
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
      notImported: string[];
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

const listOrUndefined = (value: unknown): unknown[] | undefined =>
  Array.isArray(value) ? value : undefined;

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
  const stuck = binanceWalkPendingValueOf(entry.rescanStuck) ?? [];

  return {
    cursor,
    rescan: finiteNumberOrNull(entry.rescan),
    pending: binanceWalkPendingValueOf(entry.pending),
    pointCursor: binanceWalkRoundRobinValueOf(entry.pointCursor),
    rangeCursor: binanceWalkRoundRobinValueOf(entry.rangeCursor),
    spanHints: binanceWalkSpanHintsValueOf(entry.spanHints),
    ...(entry.behindRun === true ? { behindRun: true as const } : {}),
    ...(entry.rescanTurn === true ? { rescanTurn: true as const } : {}),
    ...(stuck.length > 0 ? { rescanStuck: stuck } : {}),
    ...foldMap(maybe(multiCoinSinceOf(entry, cursor)), (multiCoinSince) => ({ multiCoinSince })),
    ...(entry.multiCoinSeen === true ? { multiCoinSeen: true as const } : {}),
  };
};

const emptyMarks = (): ParsedWalkMarks => marksOf({});

/** A `null` heldOrderId is a cleared one: the same symbol as one that never held an order. */
const heldOrderFieldOf = (stored: unknown): Pick<TradeSymbol, 'heldOrderId'> | undefined => {
  if (stored === undefined || stored === null) {
    return {};
  }

  return isNumber(stored) ? { heldOrderId: stored } : undefined;
};

/**
 * No ids, or a list of none, is a symbol without any (a state stored before the field existed
 * reads so); an id stored twice reads once. A value that is no list of numbers is unreadable.
 */
const rowlessOrderIdsFieldOf = (
  stored: unknown,
): Pick<TradeSymbol, 'rowlessOrderIds'> | undefined => {
  if (stored === undefined || stored === null) {
    return {};
  }

  if (!Array.isArray(stored) || !stored.every(isNumber)) {
    return undefined;
  }

  return stored.length === 0 ? {} : { rowlessOrderIds: [...new Set(stored)] };
};

const tradeSymbolOf = (stored: unknown): TradeSymbol | undefined => {
  if (!isRecord(stored)) {
    return undefined;
  }

  const { fromId, heldOrderId, rowlessOrderIds } = stored;
  const held = heldOrderFieldOf(heldOrderId);
  const rowless = rowlessOrderIdsFieldOf(rowlessOrderIds);

  if ((fromId !== null && !isNumber(fromId)) || held === undefined || rowless === undefined) {
    return undefined;
  }

  return { fromId, ...held, ...rowless };
};

const emptyText = (): string => '';

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
  const rotation = entryOf('trades.rotation', container.value.rotation, textOrUndefined, emptyText);
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

/**
 * Every entry parses alone: one that is no text of a known kind is dropped and named
 * `notImported.<index>`, and an entry stored twice reads once, so a read never double-counts.
 */
const notImportedOf = (stored: unknown): ReadEntry<string[]> => {
  const container = entryOf('notImported', stored, listOrUndefined, emptyList);

  return {
    value: [...new Set(container.value.filter(isKnownNotImportedEntry))],
    unreadable: [
      ...container.unreadable,
      ...container.value.flatMap((entry, index) =>
        isKnownNotImportedEntry(entry) ? [] : [`notImported.${index}`],
      ),
    ],
  };
};

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
  const notImported = notImportedOf(stored.notImported);

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
    notImported: notImported.value,
    unreadable: [
      ...walks.flatMap(({ unreadable }) => unreadable),
      ...trades.unreadable,
      ...untrackedCoins.unreadable,
      ...oversizedCoins.unreadable,
      ...oversizedByWallet.unreadable,
      ...balanceSyncedAt.unreadable,
      ...notImported.unreadable,
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
