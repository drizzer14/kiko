import { i18n } from '@kiko/i18n/init';
import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { replanReminders, useReminderScheduler } from './use-reminder-scheduler';

const mockSyncReminders = jest.fn();

jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
}));

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
  mockSyncReminders.mockResolvedValue([]);
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

    expect(mockSyncReminders).toHaveBeenCalledTimes(1);
  });
});
