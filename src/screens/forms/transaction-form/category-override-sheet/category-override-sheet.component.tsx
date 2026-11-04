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
// a red label. A name that ends in a store number also offers a secondary
// "starts with" button, which swaps the sheet's content for the preview of
// that rule: a primary "Move" and a ghost "Back". Dismissing the sheet
// (scrim/back) behaves like Cancel — it returns to the list. While a write
// runs, its button shows a spinner and the sheet stays open until the
// write is done.
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
  prefix,
  onOfferPrefix,
  isOfferingPrefix,
  prefixConfirm,
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

          <Text variant="heading">
            {prefixConfirm === null
              ? t('forms.transaction.applyCategoryToAll')
              : t('categoryRulePreview.confirmTitle')}
          </Text>
        </Box>
      }
      testID="category-override-sheet"
    >
      {prefixConfirm === null ? (
        <>
          <Text variant="body" tone="textSecondary">
            {message}
          </Text>

          <Button
            onPress={onApply}
            loading={isApplying}
            disabled={isApplyingOne || isOfferingPrefix}
          >
            {t('forms.transaction.apply')}
          </Button>

          {prefix !== null && (
            <Button
              variant="secondary"
              onPress={onOfferPrefix}
              loading={isOfferingPrefix}
              disabled={isApplying || isApplyingOne}
            >
              {t('forms.transaction.applyToAllStartingWith', { prefix })}
            </Button>
          )}

          {canApplyToOne && (
            <Button
              variant="secondary"
              onPress={onApplyOne}
              loading={isApplyingOne}
              disabled={isApplying || isOfferingPrefix}
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
        </>
      ) : (
        <>
          <Text variant="body" tone="textSecondary">
            {prefixConfirm.message}
          </Text>

          <Button onPress={prefixConfirm.onConfirm} loading={prefixConfirm.isApplying}>
            {t('categoryRulePreview.confirm')}
          </Button>

          <Button
            variant="ghost"
            onPress={prefixConfirm.onBack}
            disabled={prefixConfirm.isApplying}
          >
            {t('categoryRulePreview.back')}
          </Button>
        </>
      )}
    </BottomSheet>
  );
};

export default CategoryOverrideSheet;
