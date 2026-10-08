import { remindersNative } from '@kiko/reminders/native';
import { useNotificationPermission } from '@kiko/reminders/permission';

// Semgrep fixture (NEGATIVE): a status read goes to the native module
// directly, and the system prompt goes through the shared permission hook.

export const readNotificationStatus = () => remindersNative.authorizationStatus();

export const useNotificationRequest = () => {
  const { request } = useNotificationPermission();

  return request;
};
