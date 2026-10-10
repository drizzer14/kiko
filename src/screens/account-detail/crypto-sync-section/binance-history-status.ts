import { DAY_MS } from '@kiko/dates';
import type { HoldingRow } from '@kiko/db';
import { BINANCE_HISTORY_CURSOR_FIELD, binanceWalkCursorOf } from '@kiko/holdings/holding-metadata';

/**
 * The Binance history-walk watermark among an account's holdings. Only the
 * Spot holding ever carries `binanceHistoryCursor` (deposits/withdrawals
 * attach there — see `binance.transactions.ts`), so a plain scan for
 * whichever holding has it avoids hard-coding the Spot match key here too.
 */
export const historyCursorOf = (holdings: Pick<HoldingRow, 'metadata'>[]): number | null => {
  for (const holding of holdings) {
    const cursor = binanceWalkCursorOf(BINANCE_HISTORY_CURSOR_FIELD, holding.metadata);

    if (cursor !== null) {
      return cursor;
    }
  }

  return null;
};

/**
 * True when the Binance history walk is meaningfully behind the account's own
 * balance sync — never caught up at all (`null` cursor), or behind by more
 * than a day. `lastBalanceSyncAt === null` (the account has never synced)
 * is never "behind": there's nothing yet to compare the history against, so
 * the caption would be noise before the very first sync.
 */
export const isBinanceHistoryBehind = (
  historyCursor: number | null,
  lastBalanceSyncAt: number | null,
): boolean =>
  lastBalanceSyncAt !== null &&
  (historyCursor === null || lastBalanceSyncAt - historyCursor > DAY_MS);
