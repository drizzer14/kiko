import either, { bifold, isLeft } from 'fnts/either';
import { remindersRepo } from '@kiko/reminders/repo';

import { replanReminders, warnReplanFailure } from './use-reminder-scheduler';

/**
 * Re-plans after a backup restore. Counted from the backup, every reminder
 * since then would read as ignored and back-off pause on this first re-plan,
 * so the ignored counts restart first. A failed restart still re-plans: the
 * pending requests are still the ones from before the restore. Never rejects.
 */
export const replanRestoredReminders = async (): Promise<void> => {
  const restarted = await either<unknown, void>(() => remindersRepo.restartIgnoredCounts());

  if (isLeft(restarted)) {
    warnReplanFailure(bifold(restarted));
  }

  replanReminders();
};
