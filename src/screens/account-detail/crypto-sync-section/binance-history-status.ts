import { match } from 'ts-pattern';
import { DAY_MS } from '@kiko/dates';
import type {
  BinancePendingRange,
  ParsedExchangeState,
  WalkId,
} from '@kiko/crypto-sync/exchange/walk-state';
import type { BalanceProviderId } from '@kiko/crypto-sync/provider';
import { isBybitRescannedRange, isTrackedBybitAsset } from '@kiko/crypto-sync/bybit';
import { isTrackedBinanceAsset, RESYNC_OVERLAP_MS } from '@kiko/crypto-sync/binance';

// Each table below is typed by the provider id, so a new id does not compile until its decision
// is made.

/**
 * Whether a provider imports a history behind its balance, which the account detail then states:
 * the coin lines, the paused and the behind captions. A wallet's balance IS the whole synced
 * picture, so it has none.
 */
const EXCHANGE_HISTORY: Record<BalanceProviderId, boolean> = {
  btc_wallet: false,
  binance: true,
  bybit: true,
};

export const hasExchangeHistory = (provider: BalanceProviderId): boolean =>
  EXCHANGE_HISTORY[provider];

/**
 * Whether the account detail states the end of the provider's key and the kinds it reads. Only a
 * key that ends on a date has the first (Bybit's, after about 90 days), and the kinds line names
 * what that provider reads and leaves out; Binance's footer says its own on the holding.
 */
const KEY_LINES: Record<BalanceProviderId, boolean> = {
  btc_wallet: false,
  binance: false,
  bybit: true,
};

export const hasKeyLines = (provider: BalanceProviderId): boolean => KEY_LINES[provider];

// A wallet lists no coin at all, so nothing it holds reads as not tracked.
const TRACKED_ASSET: Record<BalanceProviderId, (asset: string) => boolean> = {
  btc_wallet: () => true,
  binance: isTrackedBinanceAsset,
  bybit: isTrackedBybitAsset,
};

/**
 * The rule the exchange's own balance read uses to tell a coin it tracks from one it lists as not
 * tracked, so the account detail shows each exchange by its own list.
 */
export const isTrackedAssetOf = (provider: BalanceProviderId): ((asset: string) => boolean) =>
  TRACKED_ASSET[provider];

/**
 * The walks whose forward cursor the caption compares. Binance: capital, Pay, Transfer, Earn,
 * Convert, P2P, fiat orders, fiat payments. A P2P page that cannot be read holds its cursor on
 * every run, which this caption shows once the cursor lags a day; the failure itself has its own,
 * immediate caption (`p2pReadFailed`). Bybit: capital, transfer, log, convert and the Funding
 * ledger. An empty list never shows the caption: a wallet has no history.
 */
const CAPTION_WALKS: Record<BalanceProviderId, readonly WalkId[]> = {
  btc_wallet: [],
  binance: ['capital', 'pay', 'transfer', 'earn', 'convert', 'p2p', 'fiatOrders', 'fiatPayments'],
  bybit: ['capital', 'transfer', 'log', 'convert', 'fundingLedger'],
};

const captionWalksOf = (provider: BalanceProviderId): readonly WalkId[] => CAPTION_WALKS[provider];

/**
 * The caption walks' forward watermarks in the account's walk state. A walk that has not written
 * its cursor yet reads as null, and so does every walk of a state that is not readable.
 */
export const walkCursorsOf = (
  state: ParsedExchangeState,
  provider: BalanceProviderId,
): (number | null)[] =>
  match(state)
    .returnType<(number | null)[]>()
    .with({ kind: 'parsed' }, ({ walks }) =>
      captionWalksOf(provider).map((walkId) => walks[walkId].cursor),
    )
    .with({ kind: 'malformed' }, () => captionWalksOf(provider).map(() => null))
    .exhaustive();

const isRange = (ground: { kind?: 'point' }): boolean => ground.kind !== 'point';

/**
 * Whether a point has stayed owed for longer than the lag the caption allows a walk (a day): its
 * `since` is the time of the run that first owed it, which every later run keeps. A point with no
 * `since` (stored by a build before it) and one stamped after the balance sync are not old.
 */
const isOldPoint = (
  ground: { kind?: 'point'; since?: number },
  lastBalanceSyncAt: number,
): boolean =>
  ground.kind === 'point' &&
  ground.since !== undefined &&
  lastBalanceSyncAt - ground.since > DAY_MS;

/**
 * The walks that store their own overlap day and read it on the next sync: the fiat orders walk
 * alternates a forward turn and a behind turn, so the day its forward turn plans stays in the list
 * until the next sync. Every other walk reads that day in the run that plans it, so a day of
 * theirs still in the list is ground a run could not read.
 */
const OVERLAP_KEEPING_WALKS: readonly WalkId[] = ['fiatOrders'];

/**
 * Whether `ground` is the overlap day a forward turn planned: a range owed in every series, as wide
 * as the overlap, ending at or before the cursor. The forward turn stores the day with a cursor
 * that has moved on, so its end is the cursor of the run before and cannot be compared to the
 * stored cursor for equality. A day the walk failed to read is owed in the series it failed in, so
 * it never reads as this one.
 */
const isPlannedOverlapDay = (ground: BinancePendingRange, cursor: number | null): boolean =>
  ground.series === undefined &&
  ground.end - ground.start === RESYNC_OVERLAP_MS &&
  cursor !== null &&
  ground.end <= cursor;

/**
 * Whether a range is ground the caption is about. Not the overlap day a walk keeps planned across
 * syncs, which the next sync reads by design, and not, for Bybit, a range in every series inside
 * its re-scan window: the forward pass read that whole, so "not imported yet" is false for it.
 */
const isOwedRange = (
  provider: BalanceProviderId,
  walkId: WalkId,
  ground: BinancePendingRange,
  cursor: number | null,
  lastBalanceSyncAt: number | null,
): boolean =>
  isRange(ground) &&
  !(OVERLAP_KEEPING_WALKS.includes(walkId) && isPlannedOverlapDay(ground, cursor)) &&
  !(provider === 'bybit' && isBybitRescannedRange(walkId, ground, cursor, lastBalanceSyncAt));

/**
 * Whether any history walk owes ground the caption is about: a range, in every series or in one
 * (ground its forward cursor has passed and a later run still has to read: a page or a series the
 * run could not afford or read, a drift, an edge band), or a point that has stayed owed for more
 * than a day (`isOldPoint`). A range that is the overlap day a walk keeps planned across syncs
 * (`isPlannedOverlapDay`) is not owed: the next sync reads it by design, and neither is a Bybit
 * range in every series inside its re-scan window (`isBybitRescannedRange`). A fresh point is not
 * owed ground the walk is behind on: the record it keeps owed is read again on every sync. A list
 * that is not well formed owes nothing here; the walk repairs it on its next run. The ranges the
 * fiat re-scan reads around (`rescanStuck`) are kept in the same list, so they are read through
 * it. A page that is stuck or a `drift` never rejects a run, so this is how the ground it leaves
 * owed stays visible. An account that has never synced (`lastBalanceSyncAt` is `null`) has no
 * time to measure a point against.
 */
export const historyOwesRange = (
  state: ParsedExchangeState,
  lastBalanceSyncAt: number | null,
  provider: BalanceProviderId,
): boolean =>
  match(state)
    .returnType<boolean>()
    .with({ kind: 'parsed' }, ({ walks }) =>
      captionWalksOf(provider).some(
        (walkId) =>
          walks[walkId].pending?.some(
            (ground) =>
              isOwedRange(provider, walkId, ground, walks[walkId].cursor, lastBalanceSyncAt) ||
              (lastBalanceSyncAt !== null && isOldPoint(ground, lastBalanceSyncAt)),
          ) ?? false,
      ),
    )
    .with({ kind: 'malformed' }, () => false)
    .exhaustive();

/**
 * Whether the last trade read left a candidate symbol waiting for its first read
 * (`trades.unreadSymbols`). The list only holds symbols that can still be read, so a symbol whose
 * read fails on every run never keeps the caption up. A state that is not readable owes nothing
 * here, as in `historyOwesRange`.
 */
export const historyOwesTrades = (state: ParsedExchangeState): boolean =>
  match(state)
    .returnType<boolean>()
    .with({ kind: 'parsed' }, ({ trades }) => (trades.unreadSymbols ?? []).length > 0)
    .with({ kind: 'malformed' }, () => false)
    .exhaustive();

/**
 * Whether the P2P walk's last run rejected (`readFailedAt`, cleared by the next run that reads and
 * resolves). A state that is not readable has no mark, as in `historyOwesRange`.
 */
export const p2pReadFailed = (state: ParsedExchangeState): boolean =>
  match(state)
    .returnType<boolean>()
    .with({ kind: 'parsed' }, ({ walks }) => walks.p2p.readFailedAt !== undefined)
    .with({ kind: 'malformed' }, () => false)
    .exhaustive();

/**
 * True when a Binance history walk is meaningfully behind the account's own balance sync: any
 * walk that never caught up (a `null` cursor), or lags by more than a day, or any walk owes
 * ground (`owesRange`, see `historyOwesRange`: a range its cursor has passed, or a point owed for
 * more than a day). A fresh owed point does not count: a record the walk keeps owed is read again
 * on every sync. A candidate trade symbol still waiting for its first read (`tradesUnread`, see
 * `historyOwesTrades`) counts too. `lastBalanceSyncAt === null` (the account has never synced) is
 * never "behind": there's nothing yet to compare the history against, so the caption would be
 * noise before the very first sync.
 */
export const isBinanceHistoryBehind = (input: {
  cursors: readonly (number | null)[];
  lastBalanceSyncAt: number | null;
  owesRange?: boolean;
  tradesUnread?: boolean;
}): boolean => {
  const { cursors, lastBalanceSyncAt, owesRange = false, tradesUnread = false } = input;

  return (
    lastBalanceSyncAt !== null &&
    (owesRange ||
      tradesUnread ||
      cursors.some((cursor) => cursor === null || lastBalanceSyncAt - cursor > DAY_MS))
  );
};
