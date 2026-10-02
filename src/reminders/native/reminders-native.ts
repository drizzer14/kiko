import { match } from 'ts-pattern';
import { bifoldr, eitherSync } from 'fnts/either';

import type { Spec } from './NativeKikoReminders';

export const REMINDER_IDENTIFIER_PREFIX = 'kiko.reminder.';
export const SNOOZE_IDENTIFIER_PREFIX = 'kiko.snooze.';

// `registerCategories` gives these the "Tomorrow" action and the hidden-preview
// body; they must equal the identifiers `KikoRemindersCenter.swift` registers.
export const REMINDER_CATEGORY_IDENTIFIER = 'kiko.reminder';
export const NOTICE_CATEGORY_IDENTIFIER = 'kiko.reminder.notice';

export type NotificationAuthorization = 'notDetermined' | 'denied' | 'authorized';

// A floating wall-clock time with no time zone, so a reminder keeps firing at
// the chosen local time after the user changes zone. `month` is 1-12.
export type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export type NativeReminderRequest = {
  identifier: string;
  reminderId: string;
  accountId: string;
  kind: 'statement_import' | 'add_transactions';
  title: string;
  body: string;
  interruptionLevel: 'active' | 'passive';
  fireAt: LocalDateTime;
  categoryIdentifier?: string;
  threadIdentifier: string;
};

const notificationActions = ['open', 'snooze'] as const;
type NotificationAction = (typeof notificationActions)[number];

// `respondedAt` is milliseconds since the epoch, stamped natively when the user
// tapped the notification or its action. `requestIdentifier` tells which of the
// reminder's requests was tapped, such as its paused notice.
export type NotificationResponse = {
  reminderId: string;
  requestIdentifier: string;
  action: NotificationAction;
  respondedAt: number;
};

// Required on first use, not at import: `getEnforcing` throws on a binary built
// without the module, and importing this wrapper must never crash the app.
const loadNativeModule = (): Spec => require('./NativeKikoReminders').default;

// An unknown, future status counts as denied, so the app never assumes it may
// notify.
const toAuthorization = (nativeStatus: string): NotificationAuthorization =>
  match(nativeStatus)
    .returnType<NotificationAuthorization>()
    .with('notDetermined', () => 'notDetermined')
    .with('authorized', 'provisional', 'ephemeral', () => 'authorized')
    .otherwise(() => 'denied');

const isNotificationAction = (value: unknown): value is NotificationAction =>
  (notificationActions as readonly unknown[]).includes(value);

const isNotificationResponse = (entry: unknown): entry is NotificationResponse => {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }

  const candidate = entry as Record<string, unknown>;

  return (
    typeof candidate.reminderId === 'string' &&
    typeof candidate.requestIdentifier === 'string' &&
    isNotificationAction(candidate.action) &&
    typeof candidate.respondedAt === 'number'
  );
};

const parseResponses = (responsesJson: string): NotificationResponse[] => {
  const parsed = bifoldr(eitherSync<unknown, unknown>(() => JSON.parse(responsesJson)));

  return Array.isArray(parsed) ? parsed.filter(isNotificationResponse) : [];
};

export const remindersNative = {
  authorizationStatus: async (): Promise<NotificationAuthorization> =>
    toAuthorization(await loadNativeModule().authorizationStatus()),

  requestAuthorization: async (): Promise<boolean> => loadNativeModule().requestAuthorization(),

  replaceRequests: async (
    requests: readonly NativeReminderRequest[],
    keepSnoozeReminderIds: readonly string[],
  ): Promise<void> =>
    loadNativeModule().replaceRequests(JSON.stringify(requests), keepSnoozeReminderIds),

  registerCategories: (snoozeTitle: string, hiddenPreviewsBodyPlaceholder: string): void => {
    loadNativeModule().registerCategories(snoozeTitle, hiddenPreviewsBodyPlaceholder);
  },

  drainResponses: async (): Promise<NotificationResponse[]> =>
    parseResponses(await loadNativeModule().drainResponses()),

  // The event only wakes JS; the responses themselves are read through
  // `drainResponses`, the one queue that also holds taps made while JS was not
  // running.
  onResponse: (listener: () => void): { remove: () => void } =>
    loadNativeModule().onResponse(() => listener()),

  // The iOS 24-Hour Time setting, read synchronously so a time can be
  // formatted in render; it lives here because this is the app's one
  // TurboModule. Throws where the module is missing.
  uses24HourClock: (): boolean => loadNativeModule().uses24HourClock(),
};
