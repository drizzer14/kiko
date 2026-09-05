import { eq } from 'drizzle-orm';

import type { Currency } from '../currency/currency';
import { database, write } from '../db/client';
import { settings } from '../db/schema';

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
} satisfies Repository;
