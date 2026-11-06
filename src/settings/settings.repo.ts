import { eq } from 'drizzle-orm';
import type { Currency } from '@kiko/currency/currency';
import type { ReminderKind } from '@kiko/reminders/schedule';
import type { AppLanguage } from '@kiko/i18n/device-language';
import type { TrendFilter } from '@kiko/statistics/trend-filter';
import type { RecurringMark, RecurringPeriod } from '@kiko/recurring/detection';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';
import { type Repository, type SettingsRow, settings, database, write } from '@kiko/db';

import {
  type SettledHistory,
  type HistoryBackfillState,
  parseHistoryBackfillState,
  serializeHistoryBackfillState,
} from './history-backfill-state';
import {
  type RecurringMerchantChoice,
  isSameChain,
  recurringChoiceOf,
  recurringMerchantChoicesOf,
} from './recurring-merchant-choices';

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

/**
 * Changes one part of the history backfill state and keeps the rest: the coin cursor and the
 * settled marks share one column. Read-modify-write inside one `write()`, like
 * `saveStatementMapping`.
 */
const changeHistoryBackfillState = (
  change: (state: HistoryBackfillState) => HistoryBackfillState,
) =>
  write(async (databaseTransaction) => {
    const rows = await databaseTransaction
      .select({ historyBackfillState: settings.historyBackfillState })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID));
    const state = parseHistoryBackfillState(rows[0]?.historyBackfillState ?? null);

    await databaseTransaction
      .update(settings)
      .set({ historyBackfillState: serializeHistoryBackfillState(change(state)) })
      .where(eq(settings.id, SETTINGS_ID));
  });

/**
 * Changes the recurring merchant choices and keeps the rest. Read-modify-write inside one
 * `write()`, since the column holds the whole map as one JSON blob; the change returns `null` to
 * write nothing. The map is stored through `Object.fromEntries`, never by assigning a key onto
 * the stored object, because a key is user text (`__proto__`).
 */
const changeRecurringMerchantChoices = (
  change: (
    choices: Map<string, RecurringMerchantChoice>,
  ) => Map<string, RecurringMerchantChoice> | null,
) =>
  write(async (databaseTransaction) => {
    const rows = await databaseTransaction
      .select({ recurringMerchantChoices: settings.recurringMerchantChoices })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID));
    const changed = change(new Map(recurringMerchantChoicesOf(rows[0]?.recurringMerchantChoices)));

    if (changed === null) {
      return;
    }

    await databaseTransaction
      .update(settings)
      .set({ recurringMerchantChoices: Object.fromEntries(changed) })
      .where(eq(settings.id, SETTINGS_ID));
  });

/** Stores the choice under the key, or removes the key when the choice is no entry. */
const withChoice = (
  choices: Map<string, RecurringMerchantChoice>,
  key: string,
  choice: RecurringMerchantChoice | null,
): Map<string, RecurringMerchantChoice> => {
  if (choice === null) {
    choices.delete(key);

    return choices;
  }

  return choices.set(key, choice);
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
   * same shape `applyNameRule` uses for its own select-then-update
   * (`categories/category-rules-repo/category-rules.repo.ts`) — the
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
  /** The stored history backfill state as text; `parseHistoryBackfillState` reads it. */
  historyBackfillStateQuery: () =>
    database
      .select({ historyBackfillState: settings.historyBackfillState })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID)),
  /**
   * Adds settled marks beside the stored ones, replacing only a mark of the same currency, and
   * keeps the coin cursor.
   */
  recordSettledHistory: (additions: SettledHistory) =>
    changeHistoryBackfillState((state) => ({
      ...state,
      settled: { ...state.settled, ...additions },
    })),
  changeHistoryBackfillState,
  /** The one column the choices are read from; `recurringMerchantChoicesOf` parses it. */
  recurringMerchantChoicesQuery: () =>
    database
      .select({ recurringMerchantChoices: settings.recurringMerchantChoices })
      .from(settings)
      .where(eq(settings.id, SETTINGS_ID)),
  recurringMerchantChoicesOf,
  /**
   * Hides a merchant's detected series; hiding a key again keeps one entry, the last name. The
   * marks of `chain` go in the same write and the key's other marks stay beside the hide.
   */
  hideRecurringMerchant: (key: string, name: string, chain: readonly RecurringMark[] = []) =>
    changeRecurringMerchantChoices((choices) => {
      const kept = (choices.get(key)?.marks ?? []).filter(
        (stored) => !chain.some((member) => isSameChain(member, stored)),
      );

      return withChoice(choices, key, recurringChoiceOf(name, { isHidden: true, marks: kept }));
    }),
  /**
   * Marks a chain as recurring, beside the hide and the other marks of the key. A mark of the
   * same currency and amount takes the new period; `name` is the last write's spelling.
   */
  markRecurringCharge: (key: string, name: string, mark: RecurringMark) =>
    changeRecurringMerchantChoices((choices) => {
      const entry = choices.get(key);
      const marks = entry?.marks ?? [];
      const isStored = marks.some((stored) => isSameChain(stored, mark));

      return choices.set(key, {
        ...entry,
        name,
        marks: isStored
          ? marks.map((stored) => (isSameChain(stored, mark) ? mark : stored))
          : [...marks, mark],
      });
    }),
  /**
   * Gives the marks of one chain a new period and moves no stored amount. Writes nothing for an
   * entry that holds none of them, or none at another period.
   */
  setRecurringChainPeriod: (
    key: string,
    chain: readonly RecurringMark[],
    period: RecurringPeriod,
  ) =>
    changeRecurringMerchantChoices((choices) => {
      const entry = choices.get(key);
      const marks = entry?.marks ?? [];
      const isChanged = (stored: RecurringMark) =>
        stored.period !== period && chain.some((member) => isSameChain(member, stored));

      if (entry === undefined || !marks.some(isChanged)) {
        return null;
      }

      return choices.set(key, {
        ...entry,
        marks: marks.map((stored) => (isChanged(stored) ? { ...stored, period } : stored)),
      });
    }),
  /**
   * Clears the marks of one chain and keeps the hide and the other marks, so an entry left with
   * neither is dropped. Writes nothing for an entry that holds none of them.
   */
  removeRecurringMarks: (key: string, chain: readonly RecurringMark[]) =>
    changeRecurringMerchantChoices((choices) => {
      const entry = choices.get(key);
      const marks = entry?.marks ?? [];
      const kept = marks.filter((stored) => !chain.some((member) => isSameChain(member, stored)));

      if (entry === undefined || kept.length === marks.length) {
        return null;
      }

      return withChoice(
        choices,
        key,
        recurringChoiceOf(entry.name, { isHidden: entry.hidden === true, marks: kept }),
      );
    }),
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
