import { remindersRepo } from '@kiko/reminders/repo';
import { remindersNative } from '@kiko/reminders/native';

import { replanReminders, warnOnFailure } from './use-reminder-scheduler';

/**
 * Re-plans after a backup restore. Counted from the backup, every reminder
 * since then would read as ignored and back-off pause on this first re-plan,
 * so the ignored counts restart first, and the restored snoozes are
 * forgotten. Every pending request goes too, snoozes included: a snooze
 * pending here belongs to the data the restore replaced, and the restored rows
 * know nothing of it, so it would fire beside the regular reminder. A failed
 * step still re-plans. Never rejects.
 */
export const replanRestoredReminders = async (): Promise<void> => {
  await warnOnFailure(() => remindersRepo.restartAfterRestore());
  await warnOnFailure(() => remindersNative.replaceRequests([], []));

  replanReminders();
};
