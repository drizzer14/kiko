import { formatDateTime } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { syncedAtOf } from '../../holdings/holding-metadata';

export const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : formatDateTime(lastSyncAt);

/**
 * The newest balance-sync stamp across an account's holdings. A balance sync
 * records `syncedAt` on the holding it wrote (never on `settings.lastSyncAt`,
 * which is Monobank's statement cursor), so the account's "last sync" is the
 * max over its holdings.
 */
export const latestSyncedAt = (holdings: Pick<HoldingRow, 'metadata'>[]): number | null => {
  const stamps = holdings
    .map((holding) => syncedAtOf(holding.metadata))
    .filter((stamp): stamp is number => stamp !== null);

  return stamps.length > 0 ? Math.max(...stamps) : null;
};
