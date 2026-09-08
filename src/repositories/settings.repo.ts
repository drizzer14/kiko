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
  /**
   * Stamp the DISPLAY "last synced" timestamp (epoch ms). Written on every run
   * that reached Monobank with at least one card succeeding, regardless of
   * whether any new rows were imported — decoupled from `lastSyncAt`, the pure
   * statement cursor. So the user sees a fresh time even when a run imported no
   * new transactions, and even when the cursor deliberately stays put to
   * re-cover a failed card's window next run.
   */
  setLastSyncDisplayAt: (timestamp: number) =>
    write((tx) =>
      tx.update(settings).set({ lastSyncDisplayAt: timestamp }).where(eq(settings.id, SETTINGS_ID)),
    ),
  /**
   * Stamp the timestamp (epoch ms) of the last FULL statement fetch — the run
   * that fetched every card regardless of its balance. Written only after a
   * fully clean full-fetch run; drives the balance-diff skip's periodic safety
   * net (see `lastFullSyncAt` in `db/schema.ts` and `runSyncInner` in
   * `monobank/sync.ts`).
   */
  setLastFullSyncAt: (timestamp: number) =>
    write((tx) =>
      tx.update(settings).set({ lastFullSyncAt: timestamp }).where(eq(settings.id, SETTINGS_ID)),
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
  /**
   * Persist the Monobank account ids whose statement fetch FAILED on the last
   * sync run — the set the next run force-fetches regardless of balance so one
   * flaky card cannot strand the whole account in daily full-fetch mode (see
   * `failedSyncMonobankIds` in `db/schema.ts` and the end-of-run sequence in
   * `monobank/sync.ts`). Stores the array, or NULL when it is empty, to keep the
   * "no card is currently force-retried" state clean rather than an empty `[]`.
   */
  setFailedSyncMonobankIds: (ids: string[] | null) =>
    write((tx) =>
      tx.update(settings).set({ failedSyncMonobankIds: ids }).where(eq(settings.id, SETTINGS_ID)),
    ),
  setAppearance: (appearance: Appearance) =>
    write((tx) => tx.update(settings).set({ appearance }).where(eq(settings.id, SETTINGS_ID))),
} satisfies Repository;
