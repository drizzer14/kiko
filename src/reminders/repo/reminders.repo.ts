import {
  id,
  accounts,
  database,
  holdings,
  type Repository,
  reminders,
  transactions,
  write,
} from '@kiko/db';
import {
  and,
  asc,
  countDistinct,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  type SQL,
  sql,
} from 'drizzle-orm';
import { match } from 'ts-pattern';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { NotificationResponse } from '@kiko/reminders/native';
import type { ReminderKind, ReminderSchedule } from '@kiko/reminders/schedule';

type BackoffPause = { reminderId: string; pausedAt: number };

type NewReminder = { accountId: string; kind: ReminderKind; schedule: ReminderSchedule };

const unlessBackoffPaused = (column: SQLiteColumn): SQL =>
  sql`case when ${reminders.pauseReason} = 'backoff' then null else ${column} end`;

// SQLite's multi-argument max() is NULL as soon as one argument is NULL, so
// the column and the value each stand in for the other when missing.
const latest = (column: SQLiteColumn, value: number | null): SQL =>
  sql`coalesce(max(${column}, ${value}), ${column}, ${value})`;

// Only reminder accounts, and only the two sources a reminder waits for, so
// the scan stays within the accounts that have a reminder at all.
const lastDataByAccount = () =>
  database
    .select({
      accountId: holdings.accountId,
      lastImportAt:
        sql<number>`max(case when ${transactions.source} = 'import' then ${transactions.createdAt} end)`.as(
          'last_import_at',
        ),
      lastManualAt:
        sql<number>`max(case when ${transactions.source} = 'manual' then ${transactions.createdAt} end)`.as(
          'last_manual_at',
        ),
    })
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(
      and(
        inArray(transactions.source, ['import', 'manual']),
        inArray(holdings.accountId, database.select({ id: reminders.accountId }).from(reminders)),
      ),
    )
    .groupBy(holdings.accountId)
    .as('last_data');

// Any holding of the account counts. The account is a value for one account's
// page, or the reminder's own column for the correlated check across the list.
const importsOf = (accountId: string | SQLiteColumn) =>
  database
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
    .where(and(eq(holdings.accountId, accountId), eq(transactions.source, 'import')));

export const remindersRepo = {
  hasAnyQuery: () => database.select({ id: reminders.id }).from(reminders).limit(1),
  listByAccountQuery: (accountId: string) =>
    database
      .select()
      .from(reminders)
      .where(eq(reminders.accountId, accountId))
      .orderBy(asc(reminders.kind)),
  // `exists`, not a join, so an account with many imports still reads each
  // reminder once.
  listWithAccountQuery: () =>
    database
      .select({
        reminder: reminders,
        account: {
          name: accounts.name,
          institution: accounts.institution,
          archivedAt: accounts.archivedAt,
        },
        hasImport: exists(importsOf(reminders.accountId)).mapWith(Boolean),
      })
      .from(reminders)
      .innerJoin(accounts, eq(accounts.id, reminders.accountId))
      .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt), asc(accounts.id)),
  byIdQuery: (reminderId: string) =>
    database.select().from(reminders).where(eq(reminders.id, reminderId)).limit(1),
  // One row is enough to know.
  hasImportQuery: (accountId: string) => importsOf(accountId).limit(1),
  // Distinct creation times, because both legs of a transfer are written with
  // the same one: a transfer is one entry by the user.
  manualEntryDaysQuery: (accountId: string, since: number) =>
    database
      .select({ entries: countDistinct(transactions.createdAt) })
      .from(transactions)
      .innerJoin(holdings, eq(holdings.id, transactions.holdingId))
      .where(
        and(
          eq(holdings.accountId, accountId),
          eq(transactions.source, 'manual'),
          gte(transactions.createdAt, since),
        ),
      ),
  create: (input: NewReminder): Promise<string> =>
    write(async (databaseTransaction) => {
      const reminderId = id();

      await databaseTransaction
        .insert(reminders)
        .values({ ...input, id: reminderId, activeSince: Date.now() });

      return reminderId;
    }),
  // A changed schedule is a fresh start: the ignored count restarts, and a
  // back-off pause ends. A pause the user made stays until they resume it.
  // A pending snooze is kept, because iOS keeps the scheduled snooze through
  // the edit.
  update: async (reminderId: string, schedule: ReminderSchedule): Promise<void> => {
    const now = Date.now();

    await write((databaseTransaction) =>
      databaseTransaction
        .update(reminders)
        .set({
          schedule,
          activeSince: now,
          updatedAt: now,
          pausedAt: unlessBackoffPaused(reminders.pausedAt),
          pauseReason: unlessBackoffPaused(reminders.pauseReason),
        })
        .where(eq(reminders.id, reminderId)),
    );
  },
  // A resume restarts the ignored count, so the reminders sent before the
  // pause never count towards a new back-off. Pausing a paused reminder, or
  // resuming an active one, changes nothing.
  setPaused: async (reminderId: string, paused: boolean): Promise<void> => {
    const now = Date.now();

    await write(async (databaseTransaction) => {
      if (paused) {
        await databaseTransaction
          .update(reminders)
          .set({ pausedAt: now, pauseReason: 'user', updatedAt: now })
          .where(and(eq(reminders.id, reminderId), isNull(reminders.pausedAt)));

        return;
      }

      await databaseTransaction
        .update(reminders)
        .set({ pausedAt: null, pauseReason: null, activeSince: now, updatedAt: now })
        .where(and(eq(reminders.id, reminderId), isNotNull(reminders.pausedAt)));
    });
  },
  remove: async (reminderId: string): Promise<void> => {
    await write((databaseTransaction) =>
      databaseTransaction.delete(reminders).where(eq(reminders.id, reminderId)),
    );
  },
  planInputsQuery: () => {
    const lastData = lastDataByAccount();

    return database
      .select({
        id: reminders.id,
        accountId: reminders.accountId,
        kind: reminders.kind,
        schedule: reminders.schedule,
        pausedAt: reminders.pausedAt,
        activeSince: reminders.activeSince,
        lastEngagedAt: reminders.lastEngagedAt,
        lastSnoozedAt: reminders.lastSnoozedAt,
        archivedAt: accounts.archivedAt,
        institution: accounts.institution,
        lastImportAt: lastData.lastImportAt,
        lastManualAt: lastData.lastManualAt,
      })
      .from(reminders)
      .innerJoin(accounts, eq(accounts.id, reminders.accountId))
      .leftJoin(lastData, eq(lastData.accountId, reminders.accountId))
      .orderBy(asc(reminders.id));
  },
  // Both a tap and a "Tomorrow" count as engagement; only the snooze is
  // pending afterwards.
  recordEngagements: async (
    responses: readonly Omit<NotificationResponse, 'requestIdentifier'>[],
  ): Promise<void> => {
    if (responses.length === 0) {
      return;
    }

    await write(async (databaseTransaction) => {
      for (const { reminderId, action, respondedAt } of responses) {
        const snoozedAt = match(action)
          .with('snooze', () => respondedAt)
          .with('open', () => null)
          .exhaustive();

        await databaseTransaction
          .update(reminders)
          .set({
            lastEngagedAt: latest(reminders.lastEngagedAt, respondedAt),
            lastSnoozedAt: latest(reminders.lastSnoozedAt, snoozedAt),
          })
          .where(eq(reminders.id, reminderId));
      }
    });
  },
  markBackoffPaused: async (pauses: readonly BackoffPause[]): Promise<void> => {
    if (pauses.length === 0) {
      return;
    }

    await write(async (databaseTransaction) => {
      for (const { reminderId, pausedAt } of pauses) {
        await databaseTransaction
          .update(reminders)
          .set({ pausedAt, pauseReason: 'backoff' })
          .where(and(eq(reminders.id, reminderId), isNull(reminders.pausedAt)));
      }
    });
  },
  clearSnoozes: async (reminderIds: readonly string[]): Promise<void> => {
    if (reminderIds.length === 0) {
      return;
    }

    await write((databaseTransaction) =>
      databaseTransaction
        .update(reminders)
        .set({ lastSnoozedAt: null })
        .where(inArray(reminders.id, [...reminderIds])),
    );
  },
} satisfies Repository;
