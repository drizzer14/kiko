import { eq } from 'drizzle-orm';
import type { Currency } from '@kiko/currency/currency';
import type { ReminderKind } from '@kiko/reminders/schedule';
import type { AppLanguage } from '@kiko/i18n/device-language';
import type { TrendFilter } from '@kiko/statistics/trend-filter';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';
import { type Repository, type SettingsRow, settings, database, write } from '@kiko/db';

/** Settings is a single row, keyed at id = 1. */
export const SETTINGS_ID = 1;

/**
 * Records the `kind` reminder offer on this account as dismissed, keeping
 * every other dismissal, inside the caller's own `write()`. Read-modify-write,
 * the `saveStatementMapping` shape, since the column holds the whole map as
 * one JSON blob.
 */
export const recordReminderOfferDismissal = async (
  databaseTransaction: typeof database,
  accountId: string,
  kind: ReminderKind,
): Promise<void> => {
  const rows = await databaseTransaction
    .select({ reminderOfferDismissals: settings.reminderOfferDismissals })
    .from(settings)
    .where(eq(settings.id, SETTINGS_ID));
  const existing = rows[0]?.reminderOfferDismissals ?? {};
  const dismissedKinds = existing[accountId] ?? [];

  if (dismissedKinds.includes(kind)) {
    return;
  }

  await databaseTransaction
    .update(settings)
    .set({ reminderOfferDismissals: { ...existing, [accountId]: [...dismissedKinds, kind] } })
    .where(eq(settings.id, SETTINGS_ID));
};

export const settingsRepo = {
  getQuery: () => database.select().from(settings).where(eq(settings.id, SETTINGS_ID)),
  ensure: () =>
    write((databaseTransaction) =>
      databaseTransaction.insert(settings).values({ id: SETTINGS_ID }).onConflictDoNothing(),
    ),
  setBaseCurrency: (currency: Currency) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(settings)
        .set({ baseCurrency: currency })
        .where(eq(settings.id, SETTINGS_ID)),
    ),
  // There are no Monobank sync cursor setters (`lastSyncAt`, `lastSyncDisplayAt`,
  // `lastFullSyncAt`, `failedSyncMonobankIds`) here: the cursor is
  // per-connection in `sync_state` (see `syncStateRepo`), so the sync does not
  // write these `settings` columns. The columns themselves are
  // retained-but-dead (migrations here are additive-only — see their comments in
  // `db/schema.ts`), backfilled once into `sync_state` by migration 0028.
  setLockEnabled: (enabled: boolean) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(settings)
        .set({ lockEnabled: enabled })
        .where(eq(settings.id, SETTINGS_ID)),
    ),
  /**
   * Set the catch-all default category (a `categories.key` slug): the category a
   * null/empty transaction category folds into, and the one a deleted category's
   * transactions reassign to. Chosen from the Categories screen.
   */
  setDefaultCategoryKey: (key: string) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(settings)
        .set({ defaultCategoryKey: key })
        .where(eq(settings.id, SETTINGS_ID)),
    ),
  setLanguage: (language: AppLanguage) =>
    write((databaseTransaction) =>
      databaseTransaction.update(settings).set({ language }).where(eq(settings.id, SETTINGS_ID)),
    ),
  /**
   * Persist (or clear) the user's saved spending-trend filter (see
   * `TrendFilter`): the whole config as JSON, or `null` to fall back to
   * `DEFAULT_TREND_FILTER` (top 3 by contribution). Written by the trend
   * filter sheet's Save.
   */
  setTrendFilter: (filter: TrendFilter | null) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(settings)
        .set({ trendFilter: filter })
        .where(eq(settings.id, SETTINGS_ID)),
    ),
  /**
   * Saves (or overwrites) one column-mapping under `key`
   * (`mappingKeyFor(bankId, fingerprint)`,
   * `statement-import/column-mapping/saved-mapping.ts`), keeping every
   * OTHER saved key untouched. Read-modify-write inside one `write()`, the
   * same shape `upsertCategoryOverride` uses for its own select-then-update
   * (`categories/category-overrides-repo/category-overrides.repo.ts`) — the
   * column stores the whole map as one JSON blob, so a plain `.set()` would
   * otherwise clobber every other bank/file's saved mapping.
   */
  saveStatementMapping: (key: string, mapping: SavedColumnMapping) =>
    write(async (databaseTransaction) => {
      const rows = await databaseTransaction
        .select({ statementMappings: settings.statementMappings })
        .from(settings)
        .where(eq(settings.id, SETTINGS_ID));
      const existing = rows[0]?.statementMappings ?? {};

      await databaseTransaction
        .update(settings)
        .set({ statementMappings: { ...existing, [key]: mapping } })
        .where(eq(settings.id, SETTINGS_ID));
    }),
  dismissReminderOffer: (accountId: string, kind: ReminderKind) =>
    write((databaseTransaction) =>
      recordReminderOfferDismissal(databaseTransaction, accountId, kind),
    ),
  notificationsDeliverableSinceQuery: () =>
    database
      .select({ notificationsDeliverableSince: settings.notificationsDeliverableSince })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID)),
  setNotificationsDeliverableSince: (deliverableSince: number | null) =>
    write((databaseTransaction) =>
      databaseTransaction
        .update(settings)
        .set({ notificationsDeliverableSince: deliverableSince })
        .where(eq(settings.id, SETTINGS_ID)),
    ),
} satisfies Repository;

/**
 * A reminder offer the user dismissed, or whose reminder the user deleted,
 * never comes back for that account.
 */
export const isReminderOfferDismissed = (
  settingsRow: Pick<SettingsRow, 'reminderOfferDismissals'>,
  accountId: string,
  kind: ReminderKind,
): boolean => settingsRow.reminderOfferDismissals?.[accountId]?.includes(kind) ?? false;
