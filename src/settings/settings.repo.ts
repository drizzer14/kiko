import type { Repository } from '@kiko/db/repository';
import { eq } from 'drizzle-orm';

import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { settings } from '../db/schema';
import type { AppLanguage } from '../i18n';
import type { TrendFilter } from '../statistics/trend-filter';

/** Settings is a single row, keyed at id = 1. */
const SETTINGS_ID = 1;

export const settingsRepo = {
  getQuery: () => database.select().from(settings).where(eq(settings.id, SETTINGS_ID)),
  ensure: () =>
    write((tx) => tx.insert(settings).values({ id: SETTINGS_ID }).onConflictDoNothing()),
  setBaseCurrency: (currency: Currency) =>
    write((tx) =>
      tx.update(settings).set({ baseCurrency: currency }).where(eq(settings.id, SETTINGS_ID)),
    ),
  // The Monobank sync cursor setters (`setLastSyncAt`, `setLastSyncDisplayAt`,
  // `setLastFullSyncAt`, `setFailedSyncMonobankIds`) were REMOVED here: the
  // cursor is now per-connection in `sync_state` (see `syncStateRepo`), so the
  // sync no longer writes these `settings` columns. The columns themselves are
  // retained-but-dead (migrations here are additive-only — see their comments in
  // `db/schema.ts`), backfilled once into `sync_state` by migration 0028.
  setLockEnabled: (enabled: boolean) =>
    write((tx) =>
      tx.update(settings).set({ lockEnabled: enabled }).where(eq(settings.id, SETTINGS_ID)),
    ),
  /**
   * Set the catch-all default category (a `categories.key` slug): the category a
   * null/empty transaction category folds into, and the one a deleted category's
   * transactions reassign to. Chosen from the Categories screen.
   */
  setDefaultCategoryKey: (key: string) =>
    write((tx) =>
      tx.update(settings).set({ defaultCategoryKey: key }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setLanguage: (language: AppLanguage) =>
    write((tx) => tx.update(settings).set({ language }).where(eq(settings.id, SETTINGS_ID))),
  /**
   * Persist (or clear) the user's saved spending-trend filter (see
   * `TrendFilter`): the whole config as JSON, or `null` to fall back to
   * `DEFAULT_TREND_FILTER` (top 3 by contribution). Written by the trend
   * filter sheet's Save.
   */
  setTrendFilter: (filter: TrendFilter | null) =>
    write((tx) =>
      tx.update(settings).set({ trendFilter: filter }).where(eq(settings.id, SETTINGS_ID)),
    ),
} satisfies Repository;
