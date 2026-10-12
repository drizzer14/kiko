import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import SymbolIcon from '@kiko/design-system/components/symbol';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';

import { styles } from './category-override-sheet.styles';
import type { CategoryOverrideSheetProps } from './category-override-sheet.props';

// The category-override confirmation, as a themed sheet rather than a
// native Alert (which cannot be styled). "Apply" is the accent-filled
// primary all-similar name rule; "Just for this one" (edit mode only) is
// the secondary single-row override; "Cancel" is a transparent ghost with
// a red label. Dismissing the sheet (scrim/back) behaves like Cancel — it
// returns to the list. While either write runs, its button shows a
// spinner and the sheet stays open until the write is done.
const CategoryOverrideSheet = ({
  visible,
  onDismiss,
  categoryIcon,
  message,
  canApplyToOne,
  onApply,
  isApplying,
  onApplyOne,
  isApplyingOne,
  isWriting,
}: CategoryOverrideSheetProps): ReactElement => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      gap={3}
      header={
        <Box direction="row" gap={2} style={styles.confirmHeader}>
          {categoryIcon !== null && <SymbolIcon name={categoryIcon} size={22} tone="textPrimary" />}

          <Text variant="heading">{t('forms.transaction.applyCategoryToAll')}</Text>
        </Box>
      }
      testID="category-override-sheet"
    >
      <Text variant="body" tone="textSecondary">
        {message}
      </Text>

      <Button onPress={onApply} loading={isApplying} disabled={isApplyingOne}>
        {t('forms.transaction.apply')}
      </Button>

      {canApplyToOne && (
        <Button
          variant="secondary"
          onPress={onApplyOne}
          loading={isApplyingOne}
          disabled={isApplying}
        >
          {t('forms.transaction.applyToThisOne')}
        </Button>
      )}

      <Button
        variant="ghost"
        textColor={theme.colors.negative}
        onPress={onDismiss}
        disabled={isWriting}
      >
        {t('common.cancel')}
      </Button>
    </BottomSheet>
  );
};

export default CategoryOverrideSheet;
