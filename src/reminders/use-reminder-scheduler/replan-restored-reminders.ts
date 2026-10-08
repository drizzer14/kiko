import { remindersNative } from '@kiko/reminders/native';

import { replanReminders, warnOnFailure } from './use-reminder-scheduler';

/**
 * Re-plans after a backup restore, whose own transaction already restarted
 * every reminder's count and forgot its snooze. Every pending request goes
 * here: a snooze pending on this device belongs to the data the restore
 * replaced, and the restored rows know nothing of it, so it would fire beside
 * the regular reminder. A failed drop still re-plans. Never rejects.
 */
export const replanRestoredReminders = async (): Promise<void> => {
  await warnOnFailure(() => remindersNative.replaceRequests([], []));

  replanReminders();
};
