import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import Text from '../text';
import Button from '../button';
import BottomSheet from '../bottom-sheet';

import type { NotificationPreAlertSheetProps } from './notification-pre-alert-sheet.props';

/**
 * Explains the notification permission right before iOS asks for it. HIG
 * (Privacy): a pre-alert offers one button that only moves on to the system
 * prompt, never a Cancel and never an "Allow" that could be mistaken for the
 * real choice, so a scrim dismiss continues too.
 */
const NotificationPreAlertSheet: FC<NotificationPreAlertSheetProps> = ({
  visible,
  onContinue,
  onClosed,
}) => {
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onContinue}
      onClosed={onClosed}
      gap={3}
      header={<Text variant="heading">{t('reminders.permission.preAlertTitle')}</Text>}
      testID="notification-pre-alert-sheet"
      backdropTestID="notification-pre-alert-sheet-backdrop"
    >
      <Text variant="body" tone="textSecondary">
        {t('reminders.permission.preAlertMessage')}
      </Text>

      <Button onPress={onContinue}>{t('reminders.permission.continue')}</Button>
    </BottomSheet>
  );
};

export default NotificationPreAlertSheet;
