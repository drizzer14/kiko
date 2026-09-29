import {
  accounts,
  database,
  holdings,
  type Repository,
  reminders,
  transactions,
  write,
} from '@kiko/db';
import { match } from 'ts-pattern';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { NotificationResponse } from '@kiko/reminders/native';
import { and, asc, eq, inArray, isNull, type SQL, sql } from 'drizzle-orm';

type BackoffPause = { reminderId: string; pausedAt: number };

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

export const remindersRepo = {
  hasAnyQuery: () => database.select({ id: reminders.id }).from(reminders).limit(1),
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
