import { i18n } from '@kiko/i18n/init';
import { act, renderHook } from '@testing-library/react-native';

import { useReminderScheduler } from './use-reminder-scheduler';

// `TurboModuleRegistry.getEnforcing` throws on a binary built without the
// module. The scheduler mounts in `AppRoot`, so its subscribe must not take
// the app down with it.
jest.mock('@kiko/reminders/native/NativeKikoReminders', () => {
  throw new Error('KikoReminders is not in this binary');
});

const mockSyncReminders = jest.fn();

jest.mock('@kiko/reminders/scheduler/sync-reminders', () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
}));
jest.mock('@kiko/reminders/routing/route-response', () => ({
  routeLatestResponse: async () => undefined,
}));

beforeEach(() => {
  mockSyncReminders.mockResolvedValue(undefined);
});

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('useReminderScheduler on a binary without the native module', () => {
  it('mounts, logs the failed subscribe once, and still re-plans on the other triggers', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { unmount } = await renderHook(() => useReminderScheduler());

    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    expect(mockSyncReminders).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain('KikoReminders is not in this binary');

    await unmount();

    warn.mockRestore();
  });
});
