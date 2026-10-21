import { match } from 'ts-pattern';

import {
  NOT_IMPORTED_KINDS,
  type NotImportedKind,
  notImportedKindOf,
  type ParsedExchangeState,
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

/** The tickers the account detail lists as too large to store: the sorted union of both lists. */
export const oversizedCoinsOf = (state: ParsedExchangeState): string[] =>
  unionOfKind(state, 'oversizedCoins');

/**
 * How many refused records the account detail lists per kind, in the order of
 * `NOT_IMPORTED_KINDS`; a kind with none is left out. The parse keeps each entry once, so a
 * count never doubles a record.
 */
export const notImportedCountsOf = (
  state: ParsedExchangeState,
): { kind: NotImportedKind; count: number }[] =>
  match(state)
    .returnType<{ kind: NotImportedKind; count: number }[]>()
    .with({ kind: 'parsed' }, ({ notImported }) =>
      NOT_IMPORTED_KINDS.map((kind) => ({
        kind,
        count: notImported.filter((entry) => notImportedKindOf(entry) === kind).length,
      })).filter(({ count }) => count > 0),
    )
    .with({ kind: 'malformed' }, () => [])
    .exhaustive();

/** When the last good balance read ran, or `undefined`: none stamped, or the state is lost. */
export const balanceSyncedAtOf = (state: ParsedExchangeState): number | undefined =>
  match(state)
    .returnType<number | undefined>()
    .with({ kind: 'parsed' }, ({ balanceSyncedAt }) => balanceSyncedAt)
    .with({ kind: 'malformed' }, () => undefined)
    .exhaustive();
