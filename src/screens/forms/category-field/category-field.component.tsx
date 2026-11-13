import { ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { type ReactElement, useState } from 'react';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';
import SelectableRow from '@kiko/design-system/components/selectable-row';
import { useScrollToSelected } from '@kiko/design-system/use-scroll-to-selected';

import { styles } from './category-field.styles';
import type { CategoryFieldProps } from './category-field.props';

// The glyph shown in the field before any category is picked — the generic
// category placeholder, tinted secondary to read as "empty" like the
// DateField's own unselected state.
const PLACEHOLDER_ICON = genericEntitySymbol.category;

// A labeled single-select category picker: the field shows the current
// selection (its SF Symbol + title, or a placeholder when none) and opens a
// bottom sheet listing every category as a shared `SelectableRow`. One choice;
// the selected row fills with the accent surface and carries the shared LEADING
// checkmark (uniform with the manual picker), then the sheet closes on pick.
// Mirrors the DateField's field-plus-sheet chrome so the
// two form pickers read as one family. Unlike the sign ChipRow it is ALWAYS
// editable — a synced transaction's category IS editable (the override
// propagates to every same-name row), so there is no `disabled`.
const CategoryField = ({
  label,
  sheetTitle,
  options,
  selectedKey,
  onSelect,
  required,
  error,
  testID,
}: CategoryFieldProps): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { scrollRef, onContentSizeChange, onRowLayout } = useScrollToSelected(open, selectedKey);

  const selected = options.find((option) => option.key === selectedKey) ?? null;

  const handleSelect = (key: string): void => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        error={error}
        testID={testID}
        onPress={() => setOpen(true)}
        icon={selected?.icon ?? PLACEHOLDER_ICON}
        iconColor={selected?.color}
        value={selected?.title ?? t('forms.fields.selectCategory')}
        valueTone={selected ? 'textPrimary' : 'textSecondary'}
      />

      {/* `scrollable={false}`: this list lays its rows out flush, in its own inner ScrollView
          with no row gap, and keeps the sheet's bottom padding under that frame. BottomSheet's
          shared ScrollView gaps its rows and pads inside its content, so moving the list onto it
          would change the layout. */}
      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        scrollable={false}
        header={<Text variant="heading">{sheetTitle}</Text>}
        testID="category-picker-sheet"
      >
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          onContentSizeChange={onContentSizeChange}
        >
          {options.map((option) => {
            const isSelected = option.key === selectedKey;

            return (
              <SelectableRow
                key={option.key}
                testID={`category-option-${option.key}`}
                accessibilityRole="button"
                accessibilityLabel={option.title}
                selected={isSelected}
                onPress={() => handleSelect(option.key)}
                label={option.title}
                icon={option.icon}
                iconColor={option.color}
                onLayout={(event) => onRowLayout(option.key, event)}
              />
            );
          })}
        </ScrollView>
      </BottomSheet>
    </Box>
  );
};

export default CategoryField;
