import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Text from '@kiko/design-system/components/text';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import SelectableRow from '@kiko/design-system/components/selectable-row';

import type { CategoryOptionsSheetProps } from './category-options-sheet.props';

// The categories a review line can be filed under, one tap each. The category field of the forms
// is a screen-folder feature this folder may not import, so this is the same shared sheet and rows
// with no selected row, since a line starts with no category.
const CategoryOptionsSheet: FC<CategoryOptionsSheetProps> = ({
  visible,
  options,
  onSelect,
  onDismiss,
  onClosed,
}) => {
  const { t } = useTranslation();

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      onClosed={onClosed}
      gap={2}
      header={<Text variant="heading">{t('categoryReview.optionsTitle')}</Text>}
      testID="category-options-sheet"
    >
      {options.map((option) => (
        <SelectableRow
          key={option.key}
          testID={`category-option-${option.key}`}
          accessibilityRole="button"
          accessibilityLabel={option.title}
          selected={false}
          onPress={() => onSelect(option.key)}
          label={option.title}
          icon={option.icon}
          iconColor={option.color}
        />
      ))}
    </BottomSheet>
  );
};

export default CategoryOptionsSheet;
