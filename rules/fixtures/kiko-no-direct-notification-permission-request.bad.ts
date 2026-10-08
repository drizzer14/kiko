import { remindersNative } from '@kiko/reminders/native';

// Semgrep fixture (POSITIVE): kiko-no-direct-notification-permission-request.
// `useNotificationPermission().request` owns the one app-wide status; a direct
// system prompt skips it, so a mounted notice keeps the stale answer — see
// kiko-architecture's "Reminders (local notifications)".

export const askForNotifications = async (): Promise<void> => {
  // EXPECT-FINDING
  await remindersNative.requestAuthorization();
};

// EXPECT-FINDING
export const ask = remindersNative.requestAuthorization;
