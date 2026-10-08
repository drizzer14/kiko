import { useRef, useState } from 'react';
import type { NotificationAuthorization } from '@kiko/reminders/native';
import { replanReminders } from '@kiko/reminders/use-reminder-scheduler';

import { useNotificationPermission } from './use-notification-permission';

export type NotificationPreAlert = {
  status: NotificationAuthorization | undefined;
  // Shows the pre-alert; iOS is asked once it has closed.
  open: () => void;
  // Spread onto `NotificationPreAlertSheet`.
  sheet: { visible: boolean; onContinue: () => void; onClosed: () => void };
};

/**
 * The permission flow shared by every screen that can ask for notifications:
 * the pre-alert first, then the iOS prompt once the sheet has finished
 * closing, then a re-plan so the answer takes effect. `onAnswered` runs after
 * the re-plan, whatever the answer. A repeated close signal asks only once.
 */
export const useNotificationPreAlert = (onAnswered?: () => void): NotificationPreAlert => {
  const permission = useNotificationPermission();
  const [visible, setVisible] = useState(false);
  const awaitingClose = useRef(false);

  const open = (): void => {
    awaitingClose.current = true;
    setVisible(true);
  };

  const onContinue = (): void => {
    setVisible(false);
  };

  const onClosed = async (): Promise<void> => {
    if (!awaitingClose.current) {
      return;
    }

    awaitingClose.current = false;
    await permission.request();
    replanReminders();
    onAnswered?.();
  };

  return { status: permission.status, open, sheet: { visible, onContinue, onClosed } };
};
