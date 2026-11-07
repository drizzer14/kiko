import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';

import {
  type CoinLists,
  type DenseSeries,
  type ExchangeTrades,
  type Metadata,
  type StoredExchangeState,
  type TradeSymbol,
  type WalkId,
  type WalkMarks,
  coinListsOf,
  logKindsEntryOf,
  oversizedByWalletOf,
  recordOrEmpty,
  storedExchangeStateOf,
  WALK_IDS,
} from './walk-state';

/** One mark of a walk and its new value, for a writer that is bound to the walk. */
export type WalkMarkPatch = {
  [Field in keyof WalkMarks]-?: { field: Field; value: Required<WalkMarks>[Field] };
}[keyof WalkMarks];

type WalkFieldPatch = WalkMarkPatch & { kind: 'walk'; walkId: WalkId };

/**
 * What one wallet's balance read leaves to show: the coins it set aside for a loan, the coins it
 * set aside for an open order, and the coins the exchange sent in a shape that could not be read
 * (a wallet with no such coin names none).
 */
type WalletNotes = { borrowed: string[]; openOrder?: string[]; refusedCoins?: string[] };

/**
 * What a walk or a balance read changes in `sync_state.exchange_state`: one field of one walk, one
 * trade symbol, the trades' rotation, balance snapshot or unread symbols, one coin list, the notes
 * of the wallets a balance read reached, or the balance sync stamp, or entries to add to the
 * not-imported list, or kinds to add to the log kinds, or one series' dense span. A patch names
 * fields, never whole entries, so a field it does not name is never written from a parse.
 *
 * The oversized balance list has its own patch and no `coinList` form, so no write can set
 * `balance` apart from the wallet arrays it is derived from.
 */
export type ExchangeStatePatch =
  | WalkFieldPatch
  | { kind: 'tradeSymbol'; symbol: string; entry: TradeSymbol }
  | { kind: 'tradesRotation'; value: string }
  | { kind: 'tradesBalanceSnapshot'; value: ExchangeTrades['balanceSnapshot'] }
  | { kind: 'tradesUnreadSymbols'; value: string[] }
  | {
      kind: 'coinList';
      coins: 'untrackedCoins';
      list: keyof CoinLists;
      tickers: string[];
    }
  | { kind: 'coinList'; coins: 'oversizedCoins'; list: 'history'; tickers: string[] }
  | {
      kind: 'oversizedBalance';
      /** The refused coins of each wallet whose read succeeded; a wallet that failed is absent. */
      wallets: Record<string, string[]>;
      /** Whether every wallet read, so no ticker stored before wallets were named can remain. */
      complete: boolean;
    }
  | {
      kind: 'balanceNotes';
      /** The notes of each wallet whose read succeeded; a wallet that failed is absent. */
      wallets: Record<string, WalletNotes>;
      /** The wallets whose read the exchange refused for the key's permissions. */
      refused: string[];
      /** The wallets whose read failed for any other reason. */
      notRead: string[];
    }
  | { kind: 'balanceSyncedAt'; value: number }
  | {
      kind: 'keyExpiry';
      /** The end of the key, absent when the key read gave none (or the epoch). */
      expiredAtMs?: number;
      /** The days left the key read reported, absent when it gave none. */
      deadlineDay?: number;
      readAtMs: number;
    }
  | { kind: 'notImported'; entries: string[] }
  | { kind: 'logKinds'; kinds: string[] }
  | {
      kind: 'denseSpans';
      series: DenseSeries;
      /** The start of the span the series could not read past; `null` drops the series' entry. */
      start: number | null;
    };

const withWalkField = (
  stored: StoredExchangeState,
  patch: WalkFieldPatch,
): StoredExchangeState => ({
  ...stored,
  walks: {
    ...stored.walks,
    [patch.walkId]: { ...recordOrEmpty(stored.walks[patch.walkId]), [patch.field]: patch.value },
  },
});

const emptyTrades = (): ExchangeTrades => ({ symbols: {}, rotation: '', balanceSnapshot: {} });

/** A part of the trades that is not stored starts empty; a stored one, malformed or not, stays. */
const withTradesPart = (
  stored: StoredExchangeState,
  part: Partial<Record<keyof ExchangeTrades, unknown>>,
): StoredExchangeState => ({
  ...stored,
  trades: { ...emptyTrades(), ...recordOrEmpty(stored.trades), ...part },
});

const withTradeSymbol = (
  stored: StoredExchangeState,
  symbol: string,
  entry: TradeSymbol,
): StoredExchangeState =>
  withTradesPart(stored, {
    symbols: { ...recordOrEmpty(recordOrEmpty(stored.trades).symbols), [symbol]: entry },
  });

/**
 * A balance list is replaced; a history list only grows. Tickers compare exactly, as a holding's
 * `binanceAsset` does: an exchange sends one spelling of a ticker, so no case folding is needed.
 */
const withCoinList = (
  stored: StoredExchangeState,
  { coins, list, tickers }: Extract<ExchangeStatePatch, { kind: 'coinList' }>,
): StoredExchangeState => {
  const lists = recordOrEmpty(stored[coins]);
  const written =
    list === 'balance'
      ? tickers
      : [...new Set([...coinListsOf(coins, lists).value.history, ...tickers])];

  return { ...stored, [coins]: { ...lists, [list]: written } };
};

const sortedUnique = (tickers: readonly string[]): string[] => [...new Set(tickers)].sort();

/**
 * One write of the oversized balance list and the wallet arrays it is derived from, so the two
 * never disagree: the arrays of the wallets that read are replaced, those of the others stay,
 * and `balance` is rebuilt from every array plus the legacy tickers (those in `balance` that no
 * stored wallet array names) that a read in which a wallet failed keeps and a complete one drops.
 * A complete read also drops every stored array it did not write, so an array under a key this
 * build never names (a hand-edited or newer file) cannot outlive it.
 * A `balanceByWallet` that is unreadable names no ticker, so the whole stored `balance` is legacy.
 */
const withOversizedBalance = (
  stored: StoredExchangeState,
  { wallets, complete }: Extract<ExchangeStatePatch, { kind: 'oversizedBalance' }>,
): StoredExchangeState => {
  const lists = recordOrEmpty(stored.oversizedCoins);
  const named = oversizedByWalletOf(lists.balanceByWallet).value;
  const attributed = new Set(Object.values(named).flat());
  const legacy = complete
    ? []
    : coinListsOf('oversizedCoins', lists).value.balance.filter(
        (ticker) => !attributed.has(ticker),
      );
  const balanceByWallet = {
    ...(complete ? {} : named),
    ...Object.fromEntries(
      Object.entries(wallets).map(([wallet, tickers]) => [wallet, sortedUnique(tickers)]),
    ),
  };

  return {
    ...stored,
    oversizedCoins: {
      ...lists,
      balance: sortedUnique([...Object.values(balanceByWallet).flat(), ...legacy]),
      balanceByWallet,
    },
  };
};

/** A list is written only when it holds a coin, so a wallet with nothing to note stays empty. */
const coinListOf = (field: string, coins: readonly string[]): Metadata =>
  coins.length > 0 ? { [field]: sortedUnique(coins) } : {};

const notesOfWallet = ({ borrowed, openOrder = [], refusedCoins = [] }: WalletNotes): Metadata => ({
  ...coinListOf('borrowed', borrowed),
  ...coinListOf('openOrder', openOrder),
  ...coinListOf('refusedCoins', refusedCoins),
});

type FailureMark = 'refused' | 'notRead';

const OTHER_MARK: Record<FailureMark, FailureMark> = { refused: 'notRead', notRead: 'refused' };

/**
 * The stored entry of a wallet that failed, with the mark of this failure and without the mark of
 * the other cause, so the account shows the cause of the last failure only.
 */
const markedAs = (entry: unknown, mark: FailureMark): Metadata => ({
  ...Object.fromEntries(
    Object.entries(recordOrEmpty(entry)).filter(([key]) => key !== OTHER_MARK[mark]),
  ),
  [mark]: true,
});

/**
 * The notes of the wallets that read replace those wallets' stored entries whole, the failure
 * marks with them, and the entry of any other wallet stays as stored. A wallet whose read failed
 * keeps its other notes and gains the mark of its cause (`refused` for the key's permissions,
 * `notRead` for any other), which only a later read of that wallet clears. The notes sit under
 * their own top-level key, which a build that does not read them leaves untouched (the parse names
 * only the keys it reads, and a patch spreads the stored raw state).
 */
const withBalanceNotes = (
  stored: StoredExchangeState,
  { wallets, refused, notRead }: Extract<ExchangeStatePatch, { kind: 'balanceNotes' }>,
): StoredExchangeState => {
  const replaced = {
    ...recordOrEmpty(stored.balanceNotes),
    ...Object.fromEntries(
      Object.entries(wallets).map(([wallet, notes]) => [wallet, notesOfWallet(notes)]),
    ),
  };

  return {
    ...stored,
    balanceNotes: {
      ...replaced,
      ...Object.fromEntries([
        ...refused.map((wallet) => [wallet, markedAs(replaced[wallet], 'refused')]),
        ...notRead.map((wallet) => [wallet, markedAs(replaced[wallet], 'notRead')]),
      ]),
    },
  };
};

/**
 * A good read of the key replaces the stored entry whole: a renewed key moves the date, and a read
 * with no date drops the old one, so a stale date cannot keep a line standing. A failed read
 * writes no patch, so it keeps the stored entry. Like the notes, the entry sits under its own
 * top-level key, which a build that does not read it leaves untouched.
 */
const withKeyExpiry = (
  stored: StoredExchangeState,
  { expiredAtMs, deadlineDay, readAtMs }: Extract<ExchangeStatePatch, { kind: 'keyExpiry' }>,
): StoredExchangeState => ({
  ...stored,
  keyExpiry: {
    ...foldMap(maybe(expiredAtMs), (value) => ({ expiredAtMs: value })),
    ...foldMap(maybe(deadlineDay), (value) => ({ deadlineDay: value })),
    readAtMs,
  },
});

const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * A stored text entry stays, an unknown kind too (a newer build wrote it); an entry that is no
 * text is dropped, and a value that is no list starts from nothing.
 */
const withNotImported = (
  stored: StoredExchangeState,
  { entries }: Extract<ExchangeStatePatch, { kind: 'notImported' }>,
): StoredExchangeState => ({
  ...stored,
  notImported: [
    ...new Set([
      ...(Array.isArray(stored.notImported) ? stored.notImported : []).filter(isText),
      ...entries,
    ]),
  ],
});

/** A list that only grows, by kind name: a read adds a kind it met and never removes one. */
const withLogKinds = (
  stored: StoredExchangeState,
  { kinds }: Extract<ExchangeStatePatch, { kind: 'logKinds' }>,
): StoredExchangeState => ({
  ...stored,
  logKinds: sortedUnique([...logKindsEntryOf(stored.logKinds).value, ...kinds]),
});

/**
 * One entry per series. The last entry that goes leaves the key undefined, which JSON drops, so
 * the text is the one before the first entry.
 */
const withDenseSpan = (
  stored: StoredExchangeState,
  { series, start }: Extract<ExchangeStatePatch, { kind: 'denseSpans' }>,
): StoredExchangeState => {
  const others = Object.entries(recordOrEmpty(stored.denseSpans)).filter(([key]) => key !== series);
  const entries: [string, unknown][] = start === null ? others : [...others, [series, start]];

  return { ...stored, denseSpans: entries.length > 0 ? Object.fromEntries(entries) : undefined };
};

const patchedState = (
  stored: StoredExchangeState,
  patch: ExchangeStatePatch,
): StoredExchangeState =>
  match(patch)
    .with({ kind: 'walk' }, (walkPatch) => withWalkField(stored, walkPatch))
    .with({ kind: 'tradeSymbol' }, ({ symbol, entry }) => withTradeSymbol(stored, symbol, entry))
    .with({ kind: 'tradesRotation' }, ({ value }) => withTradesPart(stored, { rotation: value }))
    .with({ kind: 'tradesBalanceSnapshot' }, ({ value }) =>
      withTradesPart(stored, { balanceSnapshot: value }),
    )
    .with({ kind: 'tradesUnreadSymbols' }, ({ value }) =>
      withTradesPart(stored, { unreadSymbols: value }),
    )
    .with({ kind: 'coinList' }, (coinListPatch) => withCoinList(stored, coinListPatch))
    .with({ kind: 'oversizedBalance' }, (oversizedPatch) =>
      withOversizedBalance(stored, oversizedPatch),
    )
    .with({ kind: 'balanceNotes' }, (notesPatch) => withBalanceNotes(stored, notesPatch))
    .with({ kind: 'balanceSyncedAt' }, ({ value }) => ({ ...stored, balanceSyncedAt: value }))
    .with({ kind: 'keyExpiry' }, (keyExpiryPatch) => withKeyExpiry(stored, keyExpiryPatch))
    .with({ kind: 'notImported' }, (notImportedPatch) => withNotImported(stored, notImportedPatch))
    .with({ kind: 'logKinds' }, (logKindsPatch) => withLogKinds(stored, logKindsPatch))
    .with({ kind: 'denseSpans' }, (denseSpansPatch) => withDenseSpan(stored, denseSpansPatch))
    .exhaustive();

/**
 * The column text after `patches`, applied in order to the one stored state, or `undefined` when
 * the top level is malformed: the patches then write nothing, because the stored text is never
 * overwritten by a walk (only a disconnect replaces it). It patches the RAW stored JSON, never the
 * parse, which drops what this build does not read (a `notImported` entry of an unknown kind, an
 * unknown walk id) and repairs what is malformed: every field the patches do not name keeps its
 * stored value. Every writer stores canonical JSON, which round-trips byte-identically, so an
 * untouched part keeps its bytes.
 */
export const exchangeStatePatched = (
  text: string | null,
  patches: readonly ExchangeStatePatch[],
): string | undefined =>
  foldMap(maybe(storedExchangeStateOf(text)), (stored) =>
    JSON.stringify(patches.reduce(patchedState, stored)),
  );

/**
 * A walk entry after a disconnect: a stored `cursor` or `rescan` becomes the floor (never a
 * forward watermark a reconnected DIFFERENT account would inherit), and a stored `pending` becomes
 * `[]` (ranges of the old account's history). Everything else the entry held (point and range
 * cursors, span hints, the clock the cursor was read at) is dropped: no mark there means "start at
 * the oldest ground, with no span to resume". The multi-coin range start goes with the cursor it
 * was recorded against, but a walk that was seen stays seen: the reset cursor is the floor, so
 * every coin is read from it and no range is owed. A seen mark that is not `true` reads as none,
 * so it goes too.
 */
const marksAfterDisconnect = (entry: Metadata, floorMs: number): Metadata => ({
  ...Object.fromEntries(
    Object.entries({ cursor: floorMs, rescan: floorMs, pending: [] }).filter(
      ([field]) => field in entry,
    ),
  ),
  ...(entry.multiCoinSeen === true ? { multiCoinSeen: true } : {}),
});

/**
 * The capital walk is the one walk with no mark at a cursor that is missing: it starts at the
 * newest capital row it already imported, which a reconnected DIFFERENT account would inherit as
 * its own history. So a capital entry that is stored but unreadable, and a top level that is
 * malformed, both reset to a floor cursor rather than to nothing. Every other walk starts at its
 * floor without a cursor, so an unreadable entry of theirs is dropped.
 */
const capitalFloorMarks = (floorMs: number): Metadata => ({ cursor: floorMs });

const walksAfterDisconnect = (walks: Metadata, floorMs: number): Metadata =>
  Object.fromEntries(
    WALK_IDS.flatMap((walkId) => {
      const entry = walks[walkId];

      if (isRecord(entry)) {
        return [[walkId, marksAfterDisconnect(entry, floorMs)]];
      }

      return walkId === 'capital' && walkId in walks ? [[walkId, capitalFloorMarks(floorMs)]] : [];
    }),
  );

/**
 * The whole column text after a disconnect: walks only, so the trades, both coin lists of each
 * kind, `notImported` and anything an unknown build wrote are gone. A malformed top level is
 * replaced by a state that holds the capital floor cursor alone.
 */
export const exchangeStateReset = (text: string, floorMs: number): string =>
  JSON.stringify({
    version: 1,
    walks: foldMap(maybe(storedExchangeStateOf(text)), ({ walks }) =>
      walksAfterDisconnect(walks, floorMs),
    ) ?? { capital: capitalFloorMarks(floorMs) },
  });
