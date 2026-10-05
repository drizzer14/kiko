import { maxOf } from '@kiko/numbers';
import type { TFunction } from 'i18next';
import type { HoldingRow } from '@kiko/db';
import { formatDateTime, type TimeClock } from '@kiko/dates';
import { syncedAtOf } from '@kiko/holdings/holding-metadata';

/**
 * The account's last-sync label. `t` is threaded in (rather than read off the
 * i18next singleton) so this stays a pure render-time helper that re-resolves
 * against the active language on every call — the same shape
 * `defaultTransactionDescription` and `derivedEntries` use. The `Never`
 * fallback is translated here because the result is interpolated into the
 * TRANSLATED `accountDetail.lastSync` key; a bare English `'Never'` would
 * read "Остання синхронізація: Never" to a Ukrainian user.
 */
export const formatLastSyncAt = (
  lastSyncAt: number | null,
  t: TFunction,
  clock: TimeClock,
): string => (lastSyncAt === null ? t('accountDetail.never') : formatDateTime(lastSyncAt, clock));

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

  return stamps.length > 0 ? maxOf(stamps) : null;
};
