import {
  NOTICE_CATEGORY_IDENTIFIER,
  REMINDER_CATEGORY_IDENTIFIER,
  type NativeReminderRequest,
} from '@kiko/reminders/native';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import maybe, { foldMap } from 'fnts/maybe';
import type { PlannedRequest } from '@kiko/reminders/planner';

type ReminderContent = Required<
  Pick<
    NativeReminderRequest,
    'title' | 'body' | 'interruptionLevel' | 'threadIdentifier' | 'categoryIdentifier'
  >
>;

type ReminderText = Pick<ReminderContent, 'title' | 'body'>;

const reminderText = (request: PlannedRequest, t: TFunction): ReminderText =>
  match(request.kind)
    .returnType<ReminderText>()
    .with('statement_import', () => ({
      title: t('reminders.notification.statementImportTitle'),
      body:
        foldMap(maybe(request.daysSinceData), (count) =>
          t('reminders.notification.statementImportBody', { count }),
        ) ?? t('reminders.notification.statementImportBodyNoData'),
    }))
    .with('add_transactions', () => ({
      title: t('reminders.notification.addTransactionsTitle'),
      body:
        foldMap(maybe(request.daysSinceData), (count) =>
          t('reminders.notification.addTransactionsBody', { count }),
        ) ?? t('reminders.notification.addTransactionsBodyNoData'),
    }))
    .exhaustive();

// Resolved on every sync with the active language, never stored, so a
// language change re-words the pending notifications on the next re-plan.
// The paused notice is passive: it is the last word, not a prompt to act, so
// its category has no "Tomorrow" action either.
export const reminderContent = (request: PlannedRequest, t: TFunction): ReminderContent =>
  match(request.variant)
    .returnType<ReminderContent>()
    .with('reminder', () => ({
      ...reminderText(request, t),
      interruptionLevel: 'active',
      threadIdentifier: request.kind,
      categoryIdentifier: REMINDER_CATEGORY_IDENTIFIER,
    }))
    .with('pausedNotice', () => ({
      title: t('reminders.notification.pausedTitle'),
      body: t('reminders.notification.pausedBody'),
      interruptionLevel: 'passive',
      threadIdentifier: request.kind,
      categoryIdentifier: NOTICE_CATEGORY_IDENTIFIER,
    }))
    .exhaustive();
