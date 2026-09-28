import {
  type NativeReminderRequest,
  type NotificationResponse,
  remindersNative,
} from '@kiko/reminders/native';
import {
  isSnoozePending,
  type PlannedRequest,
  planAllReminders,
  type ReminderPlanInput,
} from '@kiko/reminders/planner';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
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

const toPlanInput = (row: PlanInputRow, now: number): ReminderPlanInput => ({
  reminderId: row.id,
  accountId: row.accountId,
  kind: row.kind,
  schedule: row.schedule,
  activeSince: row.activeSince,
  lastEngagedAt: row.lastEngagedAt,
  lastDataAt: lastDataAtOf(row),
  lastSnoozedAt: row.lastSnoozedAt,
  now,
});

// iOS drops the snooze of a reminder that is not scheduled (it is not in the
// kept list), so its stored time would otherwise skip an occurrence after a
// resume with nothing firing in its place.
const isSnoozeStale = (row: PlanInputRow, now: number): boolean =>
  row.lastSnoozedAt !== null &&
  (!isSchedulable(row) ||
    !isSnoozePending({ schedule: row.schedule, lastSnoozedAt: row.lastSnoozedAt, now }));

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
  await remindersRepo.recordEngagements(responses);

  if ((await remindersRepo.hasAnyQuery()).length === 0) {
    await remindersNative.replaceRequests([], []);

    return responses;
  }

  const rows = await remindersRepo.planInputsQuery();
  const inputs = rows.filter(isSchedulable).map((row) => toPlanInput(row, now));
  const plan = planAllReminders(inputs);

  await remindersRepo.markBackoffPaused(plan.backoffPauses);
  await remindersRepo.clearSnoozes(
    rows.filter((row) => isSnoozeStale(row, now)).map((row) => row.id),
  );
  await remindersNative.replaceRequests(
    plan.requests.map((request) => toNativeRequest(request, t)),
    inputs.map((input) => input.reminderId),
  );

  return responses;
};
