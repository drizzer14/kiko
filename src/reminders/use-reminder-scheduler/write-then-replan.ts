import type { TFunction } from 'i18next';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';

import { replanReminders } from './use-reminder-scheduler';

// A failed write changed nothing, so there is nothing new to re-plan.
export const writeThenReplan = async (write: () => Promise<void>, t: TFunction): Promise<void> => {
  try {
    await write();
  } catch {
    alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

    return;
  }

  replanReminders();
};
