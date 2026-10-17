// src/data-transfer/snapshot/legacy-walk-keys.ts

/**
 * The walk keys the Binance walks kept on the Spot BTC holding's metadata before walk state moved
 * into `sync_state.exchange_state`, one row per key: the walk it belongs to, the field of that
 * walk's entry it becomes, and the old key. The same 24 rows as the map of migration 0061
 * (`drizzle/migrations/0061_exchange_state.sql`); a shipped migration is never imported into the
 * app, so `restore-walk-state.two-path.test.ts` pins this table against that file.
 */
export const LEGACY_WALK_KEYS = [
  ['capital', 'cursor', 'binanceHistoryCursor'],
  ['capital', 'rescan', 'binanceHistoryRescanCursor'],
  ['capital', 'pending', 'binanceHistoryPendingOverlap'],
  ['capital', 'pointCursor', 'binanceHistoryPointCursor'],
  ['capital', 'rangeCursor', 'binanceHistoryRangeCursor'],
  ['capital', 'spanHints', 'binanceHistorySpanHints'],
  ['pay', 'cursor', 'binancePayHistoryCursor'],
  ['pay', 'rescan', 'binancePayRescanCursor'],
  ['pay', 'pending', 'binancePayPendingOverlap'],
  ['pay', 'pointCursor', 'binancePayPointCursor'],
  ['pay', 'rangeCursor', 'binancePayRangeCursor'],
  ['pay', 'spanHints', 'binancePaySpanHints'],
  ['transfer', 'cursor', 'binanceTransferHistoryCursor'],
  ['transfer', 'rescan', 'binanceTransferRescanCursor'],
  ['transfer', 'pending', 'binanceTransferPendingOverlap'],
  ['transfer', 'pointCursor', 'binanceTransferPointCursor'],
  ['transfer', 'rangeCursor', 'binanceTransferRangeCursor'],
  ['transfer', 'spanHints', 'binanceTransferSpanHints'],
  ['earn', 'cursor', 'binanceEarnHistoryCursor'],
  ['earn', 'rescan', 'binanceEarnRescanCursor'],
  ['earn', 'pending', 'binanceEarnPendingOverlap'],
  ['earn', 'pointCursor', 'binanceEarnPointCursor'],
  ['earn', 'rangeCursor', 'binanceEarnRangeCursor'],
  ['earn', 'spanHints', 'binanceEarnSpanHints'],
] as const;
