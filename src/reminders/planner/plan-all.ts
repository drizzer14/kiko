import maybe, { foldMap } from 'fnts/maybe';
import { toInstant } from '@kiko/reminders/schedule';

import { type PlannedRequest, planReminder, type ReminderPlanInput } from './plan-reminder';

// iOS keeps at most 64 pending requests per app.
export const PENDING_REQUEST_LIMIT = 64;

type BackoffPause = { reminderId: string; pausedAt: number };

type RemindersPlan = { requests: PlannedRequest[]; backoffPauses: BackoffPause[] };

const byFireThenReminder = (left: PlannedRequest, right: PlannedRequest): number =>
  toInstant(left.fireAt) - toInstant(right.fireAt) ||
  left.reminderId.localeCompare(right.reminderId);

// Earliest first, because the native side adds the requests in this order
// until 64 are pending, counting the snoozes it keeps: the ones left out are
// always the latest.
export const planAllReminders = (
  inputs: readonly ReminderPlanInput[],
  limit: number = PENDING_REQUEST_LIMIT,
): RemindersPlan => {
  const plans = inputs.map((input) => ({ reminderId: input.reminderId, ...planReminder(input) }));

  return {
    requests: plans
      .flatMap(({ requests }) => requests)
      .sort(byFireThenReminder)
      .slice(0, limit),
    backoffPauses: plans.flatMap(
      ({ reminderId, backoffPausedAt }) =>
        foldMap(maybe(backoffPausedAt), (pausedAt) => [{ reminderId, pausedAt }]) ?? [],
    ),
  };
};
