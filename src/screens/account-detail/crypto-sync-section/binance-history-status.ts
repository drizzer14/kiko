import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import type { ParsedExchangeState, WalkId } from '@kiko/crypto-sync/exchange/walk-state';

/**
 * The walks whose forward cursor the caption compares: capital, Pay, Transfer, Earn, Convert,
 * P2P, fiat orders, fiat payments. A P2P page that cannot be read holds its cursor on every run,
 * so the caption is how that stays visible.
 */
const CAPTION_WALKS: readonly WalkId[] = [
  'capital',
  'pay',
  'transfer',
  'earn',
  'convert',
  'p2p',
  'fiatOrders',
  'fiatPayments',
];

/**
 * The caption walks' forward watermarks in the account's walk state. A walk that has not written
 * its cursor yet reads as null, and so does every walk of a state that is not readable.
 */
export const walkCursorsOf = (state: ParsedExchangeState): (number | null)[] =>
  match(state)
    .returnType<(number | null)[]>()
    .with({ kind: 'parsed' }, ({ walks }) => CAPTION_WALKS.map((walkId) => walks[walkId].cursor))
    .with({ kind: 'malformed' }, () => CAPTION_WALKS.map(() => null))
    .exhaustive();

const isRange = (ground: { kind?: 'point' }): boolean => ground.kind !== 'point';

/**
 * Whether the Transfer walk owes a range, in every type or in one: ground its forward cursor has
 * passed and a later run still has to read (a type whose narrowing the run could not afford, an
 * edge band). An owed point is not a range: a record the walk keeps owed is read again on every
 * sync. A list that is not well formed owes nothing here; the walk repairs it on its next run.
 */
export const transferOwesRange = (state: ParsedExchangeState): boolean =>
  match(state)
    .returnType<boolean>()
    .with({ kind: 'parsed' }, ({ walks }) => walks.transfer.pending?.some(isRange) ?? false)
    .with({ kind: 'malformed' }, () => false)
    .exhaustive();

/**
 * True when a Binance history walk is meaningfully behind the account's own balance sync: any
 * walk that never caught up (a `null` cursor), or lags by more than a day, or the Transfer walk
 * owes a range (`owesRange`, see `transferOwesRange`: its cursor has passed ground it has yet to
 * read). An owed point does not count: the caption is about the walks being behind, and a record
 * the walk keeps owed is read again on every sync. `lastBalanceSyncAt === null` (the account has
 * never synced) is never "behind": there's nothing yet to compare the history against, so the
 * caption would be noise before the very first sync.
 */
export const isBinanceHistoryBehind = (input: {
  cursors: readonly (number | null)[];
  lastBalanceSyncAt: number | null;
  owesRange?: boolean;
}): boolean => {
  const { cursors, lastBalanceSyncAt, owesRange = false } = input;

  return (
    lastBalanceSyncAt !== null &&
    (owesRange || cursors.some((cursor) => cursor === null || lastBalanceSyncAt - cursor > DAY_MS))
  );
};
