import { eq } from 'drizzle-orm';

import type { Appearance } from '../appearance/appearance';
import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { settings } from '../db/schema';
import type { AppLanguage } from '../i18n';

import type { Repository } from './repository';

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
  setLastSyncAt: (timestamp: number) =>
    write((tx) =>
      tx.update(settings).set({ lastSyncAt: timestamp }).where(eq(settings.id, SETTINGS_ID)),
    ),
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
   * Persist (or clear) the user's saved spending-trend category selection: a
   * JSON array of stable `categories.key` slugs, or `null` to fall back to the
   * live top-3-by-expense preset. Written by Save; cleared to `null` by Reset.
   */
  setTrendCategoryKeys: (keys: string[] | null) =>
    write((tx) =>
      tx.update(settings).set({ trendCategoryKeys: keys }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setAppearance: (appearance: Appearance) =>
    write((tx) => tx.update(settings).set({ appearance }).where(eq(settings.id, SETTINGS_ID))),
} satisfies Repository;
