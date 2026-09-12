import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, type ScrollViewInstance } from 'react-native';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SelectableRow from '../../../design-system/components/selectable-row';
import Text from '../../../design-system/components/text';
import FieldTrigger from '../field-trigger';

import type { CategoryFieldProps } from './category-field.props';
import { styles } from './category-field.styles';

// The glyph shown in the field before any category is picked — a neutral tag
// placeholder, tinted secondary to read as "empty" like the DateField's own
// unselected state.
const PLACEHOLDER_ICON = 'tag';

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
  options,
  selectedKey,
  onSelect,
  required,
  testID,
}: CategoryFieldProps): ReactElement => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  // Each option row's vertical offset inside the ScrollView content, keyed by
  // option.key and filled from each row's onLayout. Rows can differ in height
  // (a wrapped title runs taller), so a measured offset map lands the selected
  // row accurately where a uniform row-height estimate would drift.
  const rowOffsets = useRef<Record<string, number>>({});
  // One-shot guard: the auto-scroll fires exactly once per open. It is set the
  // moment we jump to the selection and re-armed when the sheet closes, so a
  // manual scroll is never yanked back by a late measurement pass, and a
  // reopen still lands on the selection.
  const hasScrolledToSelected = useRef(false);

  const selected = options.find((option) => option.key === selectedKey) ?? null;

  const handleSelect = (key: string): void => {
    onSelect(key);
    setOpen(false);
  };

  // Re-arm the one-shot as the sheet closes so the next open scrolls afresh.
  // The Modal keeps this subtree mounted, so the ref must be reset explicitly.
  useEffect(() => {
    if (!open) {
      hasScrolledToSelected.current = false;
    }
  }, [open]);

  // Jump the list so the selected row is already on screen instead of starting
  // at the top. Driven off the ScrollView's real measurement signals
  // (onContentSizeChange, and the selected row's own onLayout) rather than a
  // fixed single-frame defer: the heavier BottomSheet finalizes layout an
  // unknown number of frames late, so the scroll must wait for the content to
  // actually be measured. Guarded: not open, no selection, an unknown/top (0)
  // offset, or an already-consumed one-shot all leave the list where it is.
  const scrollToSelected = (): void => {
    if (!open || selectedKey === null || hasScrolledToSelected.current) {
      return;
    }

    const offset = rowOffsets.current[selectedKey];

    if (offset === undefined || offset === 0) {
      return;
    }

    hasScrolledToSelected.current = true;
    scrollRef.current?.scrollTo({ y: offset, animated: false });
  };

  return (
    <Box gap={1}>
      <FieldTrigger
        label={label}
        required={required}
        testID={testID}
        onPress={() => setOpen(true)}
        icon={selected?.icon ?? PLACEHOLDER_ICON}
        iconColor={selected?.color}
        value={selected?.title ?? t('forms.fields.selectCategory')}
        valueTone={selected ? 'textPrimary' : 'textSecondary'}
      />

      {/* `scrollable={false}`: this sheet owns its OWN inner ScrollView (via
          `scrollRef`, to jump straight to the already-selected row on open) —
          BottomSheet's shared ScrollView (F5 fix) would otherwise nest a
          second same-axis ScrollView around it, and would also sweep the
          heading below into the scrollable region along with `scrollRef`'s
          own offsets. */}
      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        scrollable={false}
        testID="category-picker-sheet"
      >
        <Text variant="heading">{label}</Text>

        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          // Primary trigger: fire the auto-scroll once the content size is
          // finalized (after every row has laid out), regardless of how many
          // frames the heavier sheet took to settle.
          onContentSizeChange={scrollToSelected}
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
                onLayout={(event) => {
                  rowOffsets.current[option.key] = event.nativeEvent.layout.y;
                  // Secondary trigger: if the SELECTED row's offset lands after
                  // the content-size pass, jump the moment it is recorded. The
                  // one-shot guard keeps the two triggers to a single scroll.
                  if (option.key === selectedKey) {
                    scrollToSelected();
                  }
                }}
              />
            );
          })}
        </ScrollView>
      </BottomSheet>
    </Box>
  );
};

export default CategoryField;
