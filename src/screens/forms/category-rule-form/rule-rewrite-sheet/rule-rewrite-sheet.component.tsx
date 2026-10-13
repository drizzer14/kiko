import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import Button from '@kiko/design-system/components/button';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';

import type { RuleRewriteSheetProps } from './rule-rewrite-sheet.props';

// The question a saved rule asks before it touches existing transactions, as a themed sheet. "Apply
// to existing" is the primary choice, "New transactions only" the secondary one, and Cancel a red
// ghost that returns to the editor with nothing saved. While a write runs, its button shows a
// spinner and the other two are inert, so the sheet stays until the write is done.
const RuleRewriteSheet = ({
  visible,
  count,
  onApply,
  isApplying,
  onKeepNew,
  isKeepingNew,
  onDismiss,
  onClosed,
}: RuleRewriteSheetProps): ReactElement => {
  const { theme } = useUnistyles();
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onClosed={onClosed}
      gap={3}
      header={<Text variant="heading">{t('ruleRewrite.title')}</Text>}
      testID="rule-rewrite-sheet"
    >
      <Text variant="body" tone="textSecondary">
        {t('ruleRewrite.message', { count })}
      </Text>

      <Button onPress={onApply} loading={isApplying} disabled={isKeepingNew}>
        {t('ruleRewrite.applyToExisting')}
      </Button>

      <Button variant="secondary" onPress={onKeepNew} loading={isKeepingNew} disabled={isApplying}>
        {t('ruleRewrite.newOnly')}
      </Button>

      <Button
        variant="ghost"
        textColor={theme.colors.negative}
        onPress={onDismiss}
        disabled={isApplying || isKeepingNew}
      >
        {t('common.cancel')}
      </Button>
    </BottomSheet>
  );
};

export default RuleRewriteSheet;
