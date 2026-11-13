import { waitFor } from '@testing-library/react-native';

/**
 * The doubles the bank and the crypto sync-section suites share. The spies live here, not in the
 * suite, so the `jest.mock` factories below hold no suite variable: the suite imports the spies
 * and wires each module with `jest.mock('@kiko/db/use-live-query', () =>
 * require('@kiko/test-support/sync-section-test-support').liveQueryModule())`; the `require` runs
 * inside the factory, so no import order can leave the helper undefined.
 */
export const mockUseLiveQuery = jest.fn();

export const mockSyncReminders = jest.fn().mockResolvedValue(undefined);

export const liveQueryModule = () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
});

export const syncRemindersModule = () => ({
  syncReminders: (...args: unknown[]) => mockSyncReminders(...args),
  drainReminderResponses: async () => [],
});

/**
 * A connect, a sync or a Disconnect re-plans the reminders once, and only after the call that
 * changed the account's source: the account sends a different reminder set from then on.
 */
export const expectRemindersReplannedAfter = async (earlierCall: jest.Mock): Promise<void> => {
  await waitFor(() => expect(mockSyncReminders).toHaveBeenCalledTimes(1));
  expect(earlierCall.mock.invocationCallOrder[0]).toBeLessThan(
    mockSyncReminders.mock.invocationCallOrder[0] ?? 0,
  );
};
