import type { TFunction } from 'i18next';

import { formatDateTime } from '../../dates/format';
import type { HoldingRow } from '../../db/schema';
import { syncedAtOf } from '../../holdings/holding-metadata';

/**
 * The account's last-sync label. `t` is threaded in (rather than read off the
 * i18next singleton) so this stays a pure render-time helper that re-resolves
 * against the active language on every call — the same shape
 * `defaultTransactionDescription` and `derivedEntries` use. It previously
 * returned a bare English `'Never'` that was then interpolated into the
 * TRANSLATED `accountDetail.lastSync` key, so a Ukrainian user read
 * "Остання синхронізація: Never".
 */
export const formatLastSyncAt = (lastSyncAt: number | null, t: TFunction): string =>
  lastSyncAt === null ? t('accountDetail.never') : formatDateTime(lastSyncAt);

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
