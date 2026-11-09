import { match } from 'ts-pattern';

import {
  NOT_IMPORTED_KINDS,
  type NotImportedKind,
  notImportedKindOf,
  type ParsedExchangeState,
  type ParsedKeyExpiry,
  type ParsedWalletNotes,
} from '../walk-state';

type CoinKind = 'untrackedCoins' | 'oversizedCoins';

type ParsedCoinLists = Extract<ParsedExchangeState, { kind: 'parsed' }>[CoinKind];

const sortedUnionOf = (lists: ParsedCoinLists): string[] =>
  [...new Set([...lists.balance, ...lists.history])].sort();

const unionOfKind = (state: ParsedExchangeState, kind: CoinKind): string[] =>
  match(state)
    .returnType<string[]>()
    .with({ kind: 'parsed' }, (parsed) => sortedUnionOf(parsed[kind]))
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/**
 * The tickers the account detail lists as not tracked: the sorted union of the balance and
 * history lists, without a ticker the exchange tracks now. A list is stored when it is read, and
 * the coin list grows after that, so a stored ticker can have become one the sync imports.
 * `isTracked` is the rule the exchange's own balance read uses, so a code the app knows but the
 * exchange does not quote stays on the list.
 */
export const untrackedCoinsOf = (
  state: ParsedExchangeState,
  isTracked: (ticker: string) => boolean,
): string[] => unionOfKind(state, 'untrackedCoins').filter((ticker) => !isTracked(ticker));

/**
 * The tickers a balance read found and the exchange does not track: the balance list alone, in
 * stored order, without a ticker the exchange tracks now. The history list is left out because a
 * coin there has no balance claim behind it, and no balance read clears that list.
 */
export const untrackedBalanceCoinsOf = (
  state: ParsedExchangeState,
  isTracked: (ticker: string) => boolean,
): string[] =>
  match(state)
    .returnType<string[]>()
    .with({ kind: 'parsed' }, ({ untrackedCoins }) =>
      untrackedCoins.balance.filter((ticker) => !isTracked(ticker)),
    )
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/** The tickers the account detail lists as too large to store: the sorted union of both lists. */
export const oversizedCoinsOf = (state: ParsedExchangeState): string[] =>
  unionOfKind(state, 'oversizedCoins');

/** The end of the key the last good key read stored, or `undefined`: none stored, or state lost. */
export const keyExpiryOf = (state: ParsedExchangeState): ParsedKeyExpiry | undefined =>
  match(state)
    .returnType<ParsedKeyExpiry | undefined>()
    .with({ kind: 'parsed' }, ({ keyExpiry }) => keyExpiry)
    .with({ kind: 'malformed' }, () => undefined)
    .exhaustive();

/**
 * The value the last good key read stored for the key's owner, or `undefined`: none stored, or
 * state lost. No stored value means a connect passes, since nothing shows another owner.
 */
export const keyOwnerOf = (state: ParsedExchangeState): string | undefined =>
  match(state)
    .returnType<string | undefined>()
    .with({ kind: 'parsed' }, ({ keyOwner }) => keyOwner)
    .with({ kind: 'malformed' }, () => undefined)
    .exhaustive();

/**
 * A coin a wallet's read set aside. It keeps its wallet because the same coin can be set aside in
 * one wallet and held in another, and a line that named only the coin would speak for both.
 */
type WalletCoin = { wallet: string; coin: string };

/**
 * What the last balance reads left to show, over every wallet: the coins set aside for a loan, the
 * coins set aside for an open order and the coins the exchange sent in a shape that could not be
 * read (each by coin, then by wallet key, once per wallet), the wallets the exchange refused the
 * key for, and the wallets whose read failed for another reason (both sorted by wallet key). A
 * wallet that failed keeps the notes it had, so these stand until a read of that wallet replaces
 * them.
 */
type BalanceNotes = {
  borrowed: WalletCoin[];
  openOrder: WalletCoin[];
  refusedCoins: WalletCoin[];
  refusedWallets: string[];
  notReadWallets: string[];
};

const NO_NOTES: BalanceNotes = {
  borrowed: [],
  openOrder: [],
  refusedCoins: [],
  refusedWallets: [],
  notReadWallets: [],
};

const byCoinThenWallet = (left: WalletCoin, right: WalletCoin): number =>
  left.coin.localeCompare(right.coin) || left.wallet.localeCompare(right.wallet);

const walletCoinsOf = (
  wallets: [string, ParsedWalletNotes][],
  kind: 'borrowed' | 'openOrder' | 'refusedCoins',
): WalletCoin[] =>
  wallets
    .flatMap(([wallet, notes]) => [...new Set(notes[kind])].map((coin) => ({ wallet, coin })))
    .sort(byCoinThenWallet);

const notesOfParsed = (balanceNotes: Record<string, ParsedWalletNotes>): BalanceNotes => {
  const wallets = Object.entries(balanceNotes).sort(([left], [right]) => left.localeCompare(right));

  return {
    borrowed: walletCoinsOf(wallets, 'borrowed'),
    openOrder: walletCoinsOf(wallets, 'openOrder'),
    refusedCoins: walletCoinsOf(wallets, 'refusedCoins'),
    refusedWallets: wallets.filter(([, notes]) => notes.refused).map(([wallet]) => wallet),
    notReadWallets: wallets.filter(([, notes]) => notes.notRead).map(([wallet]) => wallet),
  };
};

export const balanceNotesOf = (state: ParsedExchangeState): BalanceNotes =>
  match(state)
    .returnType<BalanceNotes>()
    .with({ kind: 'parsed' }, ({ balanceNotes }) => notesOfParsed(balanceNotes))
    .with({ kind: 'malformed' }, () => NO_NOTES)
    .exhaustive();

export type NotImportedCount = { kind: NotImportedKind; count: number };

/**
 * How many refused records the account detail lists per kind, in the order of
 * `NOT_IMPORTED_KINDS`; a kind with none is left out. The parse keeps each entry once, so a
 * count never doubles a record.
 */
export const notImportedCountsOf = (state: ParsedExchangeState): NotImportedCount[] =>
  match(state)
    .returnType<NotImportedCount[]>()
    .with({ kind: 'parsed' }, ({ notImported }) =>
      NOT_IMPORTED_KINDS.map((kind) => ({
        kind,
        count: notImported.filter((entry) => notImportedKindOf(entry) === kind).length,
      })).filter(({ count }) => count > 0),
    )
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/**
 * The kinds of log row a read met and left out, sorted, by name: a kind met once stays on the list,
 * so the account detail names it. None when the state holds none or cannot be read.
 */
export const logKindsOf = (state: ParsedExchangeState): string[] =>
  match(state)
    .returnType<string[]>()
    .with({ kind: 'parsed' }, ({ logKinds }) => [...logKinds].sort())
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/** How many Funding ledger rows the last reconcile held back; none when the state holds none. */
export const fundingHeldOf = (state: ParsedExchangeState): number =>
  match(state)
    .returnType<number>()
    .with({ kind: 'parsed' }, ({ fundingHeld }) => fundingHeld)
    .with({ kind: 'malformed' }, () => 0)
    .exhaustive();

/** Whether a read met a Funding ledger row with no id, which it cannot store. */
export const fundingLeftOutOf = (state: ParsedExchangeState): boolean =>
  match(state)
    .returnType<boolean>()
    .with({ kind: 'parsed' }, ({ fundingLeftOut }) => fundingLeftOut)
    .with({ kind: 'malformed' }, () => false)
    .exhaustive();

type DenseSpans = Extract<ParsedExchangeState, { kind: 'parsed' }>['denseSpans'];

/**
 * The start of the span each series could not read past, for a series whose mark stands. None for
 * a state that holds none or cannot be read.
 */
export const denseSpansOf = (state: ParsedExchangeState): DenseSpans =>
  match(state)
    .returnType<DenseSpans>()
    .with({ kind: 'parsed' }, ({ denseSpans }) => denseSpans)
    .with({ kind: 'malformed' }, () => ({}))
    .exhaustive();

/** When the last good balance read ran, or `undefined`: none stamped, or the state is lost. */
export const balanceSyncedAtOf = (state: ParsedExchangeState): number | undefined =>
  match(state)
    .returnType<number | undefined>()
    .with({ kind: 'parsed' }, ({ balanceSyncedAt }) => balanceSyncedAt)
    .with({ kind: 'malformed' }, () => undefined)
    .exhaustive();
