import {
  type NativeReminderRequest,
  type NotificationResponse,
  remindersNative,
} from '@kiko/reminders/native';
import {
  isSnoozePending,
  type PlannedRequest,
  planAllReminders,
  pausedNoticeIdentifier,
  type ReminderPlanInput,
} from '@kiko/reminders/planner';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { settingsRepo } from '@kiko/settings';
import { remindersRepo } from '@kiko/reminders/repo';
import { reminderContent } from '@kiko/reminders/content';
import { isSyncedAccount } from '@kiko/holdings/deletable';

type PlanInputRow = Awaited<ReturnType<typeof remindersRepo.planInputsQuery>>[number];

// Import reminders include synced accounts, whose statements the user can
// still import; entering transactions by hand on a synced account is not
// something to remind about.
const isSchedulable = (row: PlanInputRow): boolean =>
  row.pausedAt === null &&
  row.archivedAt === null &&
  match(row.kind)
    .with('statement_import', () => row.lastImportAt !== null)
    .with('add_transactions', () => !isSyncedAccount(row))
    .otherwise(() => false);

const lastDataAtOf = (row: PlanInputRow): number | null =>
  match(row.kind)
    .with('statement_import', () => row.lastImportAt)
    .with('add_transactions', () => row.lastManualAt)
    .exhaustive();

// Smart skip for a snooze: data added after "Tomorrow" leaves its text stale
// and the reminder no longer due, so iOS drops it (it is not in the kept list)
// and the plan stops keeping its slot free.
const hasDataSinceSnooze = (row: PlanInputRow): boolean => {
  const lastDataAt = lastDataAtOf(row);

  return row.lastSnoozedAt !== null && lastDataAt !== null && lastDataAt >= row.lastSnoozedAt;
};

const toPlanInput = (
  row: PlanInputRow,
  deliverableSince: number,
  now: number,
): ReminderPlanInput => ({
  reminderId: row.id,
  accountId: row.accountId,
  kind: row.kind,
  schedule: row.schedule,
  activeSince: row.activeSince,
  deliverableSince,
  lastEngagedAt: row.lastEngagedAt,
  lastDataAt: lastDataAtOf(row),
  lastSnoozedAt: hasDataSinceSnooze(row) ? null : row.lastSnoozedAt,
  now,
});

// iOS drops the snooze of a reminder that is not scheduled or has data since
// the snooze (neither is in the kept list), so its stored time would otherwise
// skip an occurrence with nothing firing in its place.
const isSnoozeStale = (row: PlanInputRow, now: number): boolean =>
  row.lastSnoozedAt !== null &&
  (!isSchedulable(row) ||
    hasDataSinceSnooze(row) ||
    !isSnoozePending({ schedule: row.schedule, lastSnoozedAt: row.lastSnoozedAt, now }));

// The paused notice only says the reminder has stopped; a tap on it is not a
// sign the reminder helps, so it neither resumes the reminder nor restarts the
// ignored count. Only resuming in the app does.
const isEngagement = (response: NotificationResponse): boolean =>
  response.requestIdentifier !== pausedNoticeIdentifier(response.reminderId);

// iOS shows nothing while notifications are off, so no reminder was ignored
// then: the count starts at the first sync that sees them allowed, and never
// earlier than now while they are off, so nothing is back-off paused. The start
// is stored so later syncs keep it, and written only when the permission
// changes.
const syncDeliverableSince = async (now: number): Promise<number> => {
  const isAuthorized = (await remindersNative.authorizationStatus()) === 'authorized';
  const [stored] = await settingsRepo.notificationsDeliverableSinceQuery();
  const storedSince = stored?.notificationsDeliverableSince ?? null;
  const deliverableSince = isAuthorized ? (storedSince ?? now) : null;

  if (deliverableSince !== storedSince) {
    await settingsRepo.setNotificationsDeliverableSince(deliverableSince);
  }

  return deliverableSince ?? now;
};

const toNativeRequest = (request: PlannedRequest, t: TFunction): NativeReminderRequest => ({
  identifier: request.identifier,
  reminderId: request.reminderId,
  accountId: request.accountId,
  kind: request.kind,
  fireAt: request.fireAt,
  ...reminderContent(request, t),
});

/**
 * Replaces the pending notifications with a fresh plan and returns the
 * responses drained from the native queue. With no reminders it runs one
 * `LIMIT 1` read and no plan-input query, since it runs on every app open.
 */
export const syncReminders = async (
  t: TFunction,
  now: number = Date.now(),
): Promise<NotificationResponse[]> => {
  const responses = await remindersNative.drainResponses();

  // The drain has already emptied the native queue, so the engagements are
  // stored before any later step can fail.
  await remindersRepo.recordEngagements(responses.filter(isEngagement));

  if ((await remindersRepo.hasAnyQuery()).length === 0) {
    await remindersNative.replaceRequests([], []);

    return responses;
  }

  const deliverableSince = await syncDeliverableSince(now);
  const rows = await remindersRepo.planInputsQuery();
  const schedulableRows = rows.filter(isSchedulable);
  const plan = planAllReminders(
    schedulableRows.map((row) => toPlanInput(row, deliverableSince, now)),
  );

  await remindersRepo.markBackoffPaused(plan.backoffPauses);
  await remindersRepo.clearSnoozes(
    rows.filter((row) => isSnoozeStale(row, now)).map((row) => row.id),
  );
  await remindersNative.replaceRequests(
    plan.requests.map((request) => toNativeRequest(request, t)),
    schedulableRows.filter((row) => !hasDataSinceSnooze(row)).map((row) => row.id),
  );

  return responses;
};
