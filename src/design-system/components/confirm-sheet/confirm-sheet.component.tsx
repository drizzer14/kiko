import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';

import Text from '../text';
import Button from '../button';
import BottomSheet from '../bottom-sheet';

import type { ConfirmSheetProps } from './confirm-sheet.props';

/**
 * The one themed confirm sheet: a `BottomSheet` with a heading, an optional
 * body message, a primary/`destructive` confirm Button, and a red-label
 * `ghost` Cancel. It generalises the transaction form's category-override
 * confirm (minus that sheet's "just for this one" middle action) so every
 * destructive confirm in the app — the grid-card long-press delete, the
 * transaction-form delete — reads identically instead of dropping to an
 * unthemeable native `ActionSheetIOS`/`Alert` dialog.
 *
 * A scrim/back dismiss behaves like Cancel (`onDismiss={onCancel}`). The
 * double-submit guard is the caller's concern (wrap `onConfirm` in
 * `useSubmitOnce`), so this stays a pure presentational sheet holding no
 * in-flight state of its own.
 */
const ConfirmSheet: FC<ConfirmSheetProps> = ({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
  confirmTestID,
}) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onCancel}
      gap={3}
      header={<Text variant="heading">{title}</Text>}
      testID="confirm-sheet"
    >
      {message !== undefined && (
        <Text variant="body" tone="textSecondary">
          {message}
        </Text>
      )}

      <Button
        variant={destructive ? 'destructive' : 'primary'}
        onPress={onConfirm}
        testID={confirmTestID}
      >
        {confirmLabel}
      </Button>

      <Button variant="ghost" textColor={theme.colors.negative} onPress={onCancel}>
        {t('common.cancel')}
      </Button>
    </BottomSheet>
  );
};

export default ConfirmSheet;
