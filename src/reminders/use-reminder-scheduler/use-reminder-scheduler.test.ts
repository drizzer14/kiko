import { i18n } from '@kiko/i18n/init';
import { remindersNative } from '@kiko/reminders/native';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { navigationRef } from '@kiko/navigation/navigation-ref';

import { replanReminders, useReminderScheduler } from './use-reminder-scheduler';

const mockSyncReminders = jest.fn();
const mockRouteLatestResponse = jest.fn();
const mockDrainReminderResponses = jest.fn();

jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: (...args: unknown[]) => mockDrainReminderResponses(...args),
}));
// The routing itself is proven on the real routers in its own suite; here the
// scheduler's hand-off of each sync's drained responses is under test.
jest.mock('@kiko/reminders/routing/route-response', () => ({
  routeLatestResponse: (...args: unknown[]) => mockRouteLatestResponse(...args),
}));

const responseListeners: (() => void)[] = [];

const respond = async (): Promise<void> => {
  await act(async () => {
    for (const listener of responseListeners) {
      listener();
    }
  });
};

const TAP = {
  reminderId: 'reminder-1',
  requestIdentifier: 'kiko.reminder.reminder-1.202610012000',
  action: 'open',
  respondedAt: 1000,
};

type Deferred = { resolve: () => void; reject: (reason: unknown) => void };

const appStateListeners: ((state: AppStateStatus) => void)[] = [];
const pendingRuns: Deferred[] = [];

// Each run stays open until the test settles it, so a test controls overlap.
const holdEachRun = (): void => {
  mockSyncReminders.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        pendingRuns.push({ resolve, reject });
      }),
  );
};

const settleNextRun = async (outcome: 'resolve' | 'reject' = 'resolve'): Promise<void> => {
  await act(async () => {
    const run = pendingRuns.shift();

    if (outcome === 'resolve') {
      run?.resolve();
    } else {
      run?.reject(new Error('native replaceRequests failed'));
    }
  });
};

const transition = async (state: AppStateStatus): Promise<void> => {
  await act(async () => {
    for (const listener of appStateListeners) {
      listener(state);
    }
  });
};

beforeEach(() => {
  appStateListeners.length = 0;
  pendingRuns.length = 0;
  responseListeners.length = 0;
  mockSyncReminders.mockReset().mockResolvedValue(undefined);
  mockDrainReminderResponses.mockReset().mockResolvedValue([]);
  mockRouteLatestResponse.mockReset().mockResolvedValue(undefined);
  jest.spyOn(remindersNative, 'onResponse').mockImplementation((listener) => {
    responseListeners.push(listener);

    return { remove: () => responseListeners.splice(responseListeners.indexOf(listener), 1) };
  });
  jest
    .mocked(AppState.addEventListener)
    .mockImplementation((_type, listener: (state: AppStateStatus) => void) => {
      appStateListeners.push(listener);

      return { remove: () => appStateListeners.splice(appStateListeners.indexOf(listener), 1) };
    });
});

// The trigger is shared across the app, so no test may leave a run open for
// the next one.
afterEach(async () => {
  while (pendingRuns.length > 0) {
    await settleNextRun();
  }

  await i18n.changeLanguage('en');
});

describe('useReminderScheduler', () => {
  it('re-plans once on mount, with the translation function of the active language', async () => {
    await renderHook(() => useReminderScheduler());

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);
    expect(mockSyncReminders.mock.calls[0]?.[0]('reminders.notification.pausedTitle')).toBe(
      'Reminders paused',
    );
  });

  it('re-plans when the app becomes active and when it goes to the background', async () => {
    await renderHook(() => useReminderScheduler());

    await transition('active');
    await transition('background');

    expect(mockSyncReminders).toHaveBeenCalledTimes(3);
  });

  it('does not re-plan for the inactive state', async () => {
    await renderHook(() => useReminderScheduler());

    await transition('inactive');

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);
  });

  it('re-plans on a language change, with text in the new language', async () => {
    await renderHook(() => useReminderScheduler());

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);
    expect(mockSyncReminders.mock.calls[1]?.[0]('reminders.notification.pausedTitle')).toBe(
      'Нагадування призупинено',
    );
  });

  it('runs one sync at a time and queues a single follow-up for any triggers during it', async () => {
    holdEachRun();
    await renderHook(() => useReminderScheduler());

    await transition('active');
    await transition('background');
    await transition('active');

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);

    await settleNextRun();

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);

    await settleNextRun();

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);
  });

  it('swallows a failed sync and still re-plans on the next trigger', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    holdEachRun();
    await renderHook(() => useReminderScheduler());
    await settleNextRun('reject');

    expect(warn).toHaveBeenCalledTimes(1);

    await transition('active');

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('queues a re-plan after a reminder write behind the running sync, never beside it', async () => {
    holdEachRun();
    await renderHook(() => useReminderScheduler());

    replanReminders();
    await transition('active');

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);

    await settleNextRun();

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);
  });

  it('re-plans after a reminder write with the active language', async () => {
    await i18n.changeLanguage('uk');

    await act(async () => {
      replanReminders();
    });

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);
    expect(mockSyncReminders.mock.calls[0]?.[0]('reminders.notification.pausedTitle')).toBe(
      'Нагадування призупинено',
    );
  });

  it('stops listening once unmounted', async () => {
    const { unmount } = await renderHook(() => useReminderScheduler());

    await unmount();
    await transition('active');
    await act(async () => {
      await i18n.changeLanguage('uk');
    });
    await respond();

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);
  });

  it('re-plans when a notification is answered while the app runs', async () => {
    await renderHook(() => useReminderScheduler());

    await respond();

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);
  });

  it('routes the responses each re-plan drained, through the app navigator', async () => {
    mockDrainReminderResponses.mockResolvedValueOnce([]).mockResolvedValueOnce([TAP]);
    await renderHook(() => useReminderScheduler());

    await respond();

    expect(mockRouteLatestResponse.mock.calls).toEqual([
      [[], navigationRef],
      [[TAP], navigationRef],
    ]);
  });

  it('routes the responses a re-plan after a reminder write drained', async () => {
    mockDrainReminderResponses.mockResolvedValue([TAP]);

    await act(async () => {
      replanReminders();
    });

    expect(mockRouteLatestResponse).toHaveBeenCalledWith([TAP], navigationRef);
  });

  it('logs a failed route and still re-plans on the next trigger', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRouteLatestResponse.mockRejectedValueOnce(new Error('database is locked'));

    await renderHook(() => useReminderScheduler());

    expect(warn).toHaveBeenCalledTimes(1);

    await transition('active');

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('still routes the drained responses when the plan then fails, and logs the failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDrainReminderResponses.mockResolvedValue([TAP]);
    mockSyncReminders.mockRejectedValue(new Error('native replaceRequests failed'));

    await renderHook(() => useReminderScheduler());

    expect(mockRouteLatestResponse).toHaveBeenCalledWith([TAP], navigationRef);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it('plans and routes nothing from a failed drain, and logs the failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockDrainReminderResponses.mockRejectedValue(new Error('database is locked'));

    await renderHook(() => useReminderScheduler());

    expect(mockSyncReminders).not.toHaveBeenCalled();
    expect(mockRouteLatestResponse).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });
});
