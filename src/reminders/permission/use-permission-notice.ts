import { match } from 'ts-pattern';
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type NotificationPreAlert, useNotificationPreAlert } from './use-notification-pre-alert';

type PermissionNotice = { message: string; actionLabel: string; onAction: () => void };

type PermissionNoticeState = {
  // Spread onto `NoticeBanner`.
  notice: PermissionNotice | undefined;
  // Spread onto `NotificationPreAlertSheet`.
  sheet: NotificationPreAlert['sheet'];
};

/**
 * The notice every reminders list shows while iOS cannot deliver its saved
 * reminders: denied points to iOS Settings, never asked goes through the
 * pre-alert. With no saved reminder there is nothing to deliver, so no notice.
 */
export const usePermissionNotice = (hasReminders: boolean): PermissionNoticeState => {
  const { t } = useTranslation();
  const preAlert = useNotificationPreAlert();

  const notice = match(hasReminders ? preAlert.status : undefined)
    .returnType<PermissionNotice | undefined>()
    .with('denied', () => ({
      message: t('reminders.permission.deniedMessage'),
      actionLabel: t('reminders.permission.openSettings'),
      onAction: () => Linking.openSettings(),
    }))
    .with('notDetermined', () => ({
      message: t('reminders.permission.notDeterminedMessage'),
      actionLabel: t('reminders.permission.turnOn'),
      onAction: preAlert.open,
    }))
    .with('authorized', undefined, () => undefined)
    .exhaustive();

  return { notice, sheet: preAlert.sheet };
};
