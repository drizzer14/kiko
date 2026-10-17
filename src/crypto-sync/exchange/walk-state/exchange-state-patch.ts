import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { isRecord } from '@kiko/type-guards';

import {
  type CoinLists,
  type ExchangeTrades,
  type StoredExchangeState,
  type TradeSymbol,
  type WalkId,
  type WalkMarks,
  coinListsOf,
  storedExchangeStateOf,
  WALK_IDS,
} from './walk-state';

type WalkFieldPatch = {
  [Field in keyof WalkMarks]-?: {
    kind: 'walk';
    walkId: WalkId;
    field: Field;
    value: Required<WalkMarks>[Field];
  };
}[keyof WalkMarks];

/**
 * What a walk or a balance read changes in `sync_state.exchange_state`: one field of one walk, one
 * trade symbol, the trades' rotation or balance snapshot, or one coin list. A patch names fields,
 * never whole entries, so a field it does not name is never written from a parse.
 */
export type ExchangeStatePatch =
  | WalkFieldPatch
  | { kind: 'tradeSymbol'; symbol: string; entry: TradeSymbol }
  | { kind: 'tradesRotation'; value: number }
  | { kind: 'tradesBalanceSnapshot'; value: ExchangeTrades['balanceSnapshot'] }
  | {
      kind: 'coinList';
      coins: 'untrackedCoins' | 'oversizedCoins';
      list: keyof CoinLists;
      tickers: string[];
    };

type Metadata = Record<string, unknown>;

const recordOrEmpty = (stored: unknown): Metadata => (isRecord(stored) ? stored : {});

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

const emptyTrades = (): ExchangeTrades => ({ symbols: {}, rotation: 0, balanceSnapshot: {} });

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
    .with({ kind: 'coinList' }, (coinListPatch) => withCoinList(stored, coinListPatch))
    .exhaustive();

/**
 * The column text after `patch`, or `undefined` when the top level is malformed: the patch then
 * writes nothing, because the stored text is never overwritten by a walk (only a disconnect
 * replaces it). It patches the RAW stored JSON, never the parse, which drops what this build does
 * not read (`notImported`, an unknown walk id) and repairs what is malformed: every field the
 * patch does not name stays as stored.
 */
export const exchangeStatePatched = (
  text: string | null,
  patch: ExchangeStatePatch,
): string | undefined =>
  foldMap(maybe(storedExchangeStateOf(text)), (stored) =>
    JSON.stringify(patchedState(stored, patch)),
  );

/**
 * A walk entry after a disconnect, by the rule `withWalkOwnedMetadataResetToFloor` applies to the
 * old metadata keys: a stored `cursor` or `rescan` becomes the floor (never a forward watermark a
 * reconnected DIFFERENT account would inherit), and a stored `pending` becomes `[]` (ranges of the
 * old account's history). Everything else the entry held (point and range cursors, span hints) is
 * dropped: no mark there means "start at the oldest ground, with no span to resume".
 */
const marksAfterDisconnect = (entry: Metadata, floorMs: number): Metadata =>
  Object.fromEntries(
    Object.entries({ cursor: floorMs, rescan: floorMs, pending: [] }).filter(
      ([field]) => field in entry,
    ),
  );

const walksAfterDisconnect = (walks: Metadata, floorMs: number): Metadata =>
  Object.fromEntries(
    WALK_IDS.flatMap((walkId) => {
      const entry = walks[walkId];

      return isRecord(entry) ? [[walkId, marksAfterDisconnect(entry, floorMs)]] : [];
    }),
  );

/**
 * The whole column text after a disconnect: walks only, so the trades, both coin lists of each
 * kind, `notImported` and anything an unknown build wrote are gone. A malformed value is replaced
 * by an empty state.
 */
export const exchangeStateReset = (text: string, floorMs: number): string =>
  JSON.stringify({
    version: 1,
    walks:
      foldMap(maybe(storedExchangeStateOf(text)), ({ walks }) =>
        walksAfterDisconnect(walks, floorMs),
      ) ?? {},
  });
