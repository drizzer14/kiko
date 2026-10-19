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

/**
 * An exchange account's last balance sync: the later of its holdings' newest `syncedAt` and the
 * stamp in its exchange state. A sync can leave no holding to stamp (nothing tracked above dust),
 * and a failed state write leaves the stamp one sync behind the holdings, so neither is enough.
 */
export const latestBalanceSyncAt = (
  holdings: Pick<HoldingRow, 'metadata'>[],
  stateStamp: number | undefined,
): number | null => {
  const holdingStamp = latestSyncedAt(holdings);
  const stamps = [holdingStamp, stateStamp ?? null].filter(
    (stamp): stamp is number => stamp !== null,
  );

  return stamps.length > 0 ? maxOf(stamps) : null;
};
