import {
  type LocalDateTime,
  type NativeReminderRequest,
  type NotificationAuthorization,
  type NotificationResponse,
  REMINDER_IDENTIFIER_PREFIX,
  remindersNative,
  SNOOZE_IDENTIFIER_PREFIX,
} from '.';
import type { Spec } from './NativeKikoReminders';

// Read through the registry, not a value import: only the wrapper may load
// the native module.
const nativeModule = jest.mocked(
  (jest.requireMock('./NativeKikoReminders') as { default: Spec }).default,
);

const fireAt: LocalDateTime = { year: 2026, month: 10, day: 25, hour: 3, minute: 30 };

const request: NativeReminderRequest = {
  identifier: REMINDER_IDENTIFIER_PREFIX.concat('reminder-1.0'),
  reminderId: 'reminder-1',
  accountId: 'account-1',
  kind: 'statement_import',
  title: 'Statement import',
  body: 'Time to import a new statement.',
  interruptionLevel: 'active',
  fireAt,
  categoryIdentifier: 'kiko.reminder',
  threadIdentifier: 'reminder-1',
};

describe('remindersNative.authorizationStatus', () => {
  it.each<[string, NotificationAuthorization]>([
    ['notDetermined', 'notDetermined'],
    ['denied', 'denied'],
    ['authorized', 'authorized'],
    ['provisional', 'authorized'],
    ['ephemeral', 'authorized'],
    ['somethingNew', 'denied'],
  ])('maps the native status %s to %s', async (nativeStatus, expected) => {
    nativeModule.authorizationStatus.mockResolvedValueOnce(nativeStatus);

    expect(await remindersNative.authorizationStatus()).toBe(expected);
  });
});

describe('remindersNative.requestAuthorization', () => {
  it('returns whether the user granted authorization', async () => {
    nativeModule.requestAuthorization.mockResolvedValueOnce(false);

    expect(await remindersNative.requestAuthorization()).toBe(false);
  });
});

describe('remindersNative.replaceRequests', () => {
  it('passes the requests as one JSON string and the kept snooze ids as a list', async () => {
    const passive: NativeReminderRequest = {
      ...request,
      identifier: REMINDER_IDENTIFIER_PREFIX.concat('reminder-1.1'),
      interruptionLevel: 'passive',
      categoryIdentifier: undefined,
    };

    const keptSnoozeReminderIds = ['reminder-2'];

    await remindersNative.replaceRequests([request, passive], keptSnoozeReminderIds);

    expect(nativeModule.replaceRequests).toHaveBeenCalledWith(
      JSON.stringify([request, passive]),
      keptSnoozeReminderIds,
    );
  });
});

describe('remindersNative.registerCategories', () => {
  it('forwards the snooze title and the hidden-previews placeholder', () => {
    remindersNative.registerCategories('Tomorrow', 'Reminder');

    expect(nativeModule.registerCategories).toHaveBeenCalledWith('Tomorrow', 'Reminder');
  });
});

describe('remindersNative.uses24HourClock', () => {
  it.each([true, false])('reads %p from the device setting, synchronously', (uses24Hour) => {
    nativeModule.uses24HourClock.mockReturnValueOnce(uses24Hour);

    expect(remindersNative.uses24HourClock()).toBe(uses24Hour);
  });
});

describe('remindersNative.drainResponses', () => {
  it('parses every valid queued response', async () => {
    const queued: NotificationResponse[] = [
      {
        reminderId: 'reminder-1',
        requestIdentifier: 'kiko.reminder.reminder-1.paused',
        action: 'open',
        respondedAt: 1_790_000_000_000,
      },
      {
        reminderId: 'reminder-2',
        requestIdentifier: 'kiko.snooze.reminder-2',
        action: 'snooze',
        respondedAt: 1_790_000_060_000,
      },
    ];
    nativeModule.drainResponses.mockResolvedValueOnce(JSON.stringify(queued));

    expect(await remindersNative.drainResponses()).toEqual(queued);
  });

  it('drops an entry with a missing reminderId or request identifier, or an unknown action', async () => {
    const requestIdentifier = 'kiko.reminder.reminder-1.202610252000';
    const valid: NotificationResponse = {
      reminderId: 'reminder-1',
      requestIdentifier,
      action: 'open',
      respondedAt: 1_790_000_000_000,
    };
    nativeModule.drainResponses.mockResolvedValueOnce(
      JSON.stringify([
        { requestIdentifier, action: 'open', respondedAt: 1_790_000_000_000 },
        { reminderId: 'reminder-2', action: 'open', respondedAt: 1_790_000_000_000 },
        {
          reminderId: 'reminder-3',
          requestIdentifier,
          action: 'dismiss',
          respondedAt: 1_790_000_000_000,
        },
        { reminderId: 'reminder-4', requestIdentifier, action: 'snooze', respondedAt: 'yesterday' },
        null,
        valid,
      ]),
    );

    expect(await remindersNative.drainResponses()).toEqual([valid]);
  });

  it('returns an empty list for text that is not JSON', async () => {
    nativeModule.drainResponses.mockResolvedValueOnce('not json');

    expect(await remindersNative.drainResponses()).toEqual([]);
  });

  it('returns an empty list for JSON that is not an array', async () => {
    nativeModule.drainResponses.mockResolvedValueOnce('{"reminderId":"reminder-1"}');

    expect(await remindersNative.drainResponses()).toEqual([]);
  });
});

describe('remindersNative.onResponse', () => {
  it('calls the listener on each native response event', () => {
    const listener = jest.fn();

    remindersNative.onResponse(listener);

    const [handler] = nativeModule.onResponse.mock.calls[0];
    handler('reminder-1');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removes the native subscription', () => {
    const remove = jest.fn();
    nativeModule.onResponse.mockReturnValueOnce({ remove });

    remindersNative.onResponse(jest.fn()).remove();

    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe('identifier prefixes', () => {
  it('keeps reminder and snooze requests in separate namespaces', () => {
    expect(REMINDER_IDENTIFIER_PREFIX).toBe('kiko.reminder.');
    expect(SNOOZE_IDENTIFIER_PREFIX).toBe('kiko.snooze.');
  });
});
