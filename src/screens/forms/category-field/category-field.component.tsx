import { type ReactElement, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { CategoryFieldProps } from './category-field.props';
import { styles } from './category-field.styles';

// The glyph shown in the field before any category is picked — a neutral tag
// placeholder, tinted secondary to read as "empty" like the DateField's own
// unselected state.
const PLACEHOLDER_ICON = 'tag';

// A labeled single-select category picker: the field shows the current
// selection (its SF Symbol + title, or a placeholder when none) and opens a
// bottom sheet listing every category as a vertical row. One choice; the
// selected row is tinted accent and carries a trailing checkmark, then the
// sheet closes on pick. Mirrors the DateField's field-plus-sheet chrome so the
// two form pickers read as one family. Unlike the sign ChipRow it is ALWAYS
// editable — a synced transaction's category IS editable (the override
// propagates to every same-name row), so there is no `disabled`.
const CategoryField = ({
  label,
  options,
  selectedKey,
  onSelect,
}: CategoryFieldProps): ReactElement => {
  const { theme } = useUnistyles();
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
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
      >
        <Box direction="row" gap={2} style={styles.field}>
          <SymbolIcon
            name={selected?.icon ?? PLACEHOLDER_ICON}
            size={18}
            tone="textSecondary"
            color={selected?.color}
          />

          <Text variant="body" tone={selected ? 'textPrimary' : 'textSecondary'}>
            {selected?.title ?? t('forms.fields.selectCategory')}
          </Text>
        </Box>
      </Pressable>

      {/* `scrollable={false}`: this sheet owns its OWN inner ScrollView (via
          `scrollRef`, to jump straight to the already-selected row on open) —
          BottomSheet's shared ScrollView (F5 fix) would otherwise nest a
          second same-axis ScrollView around it, and would also sweep the
          heading below into the scrollable region along with `scrollRef`'s
          own offsets. */}
      <BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={2} scrollable={false}>
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
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={option.title}
                onPress={() => handleSelect(option.key)}
                onLayout={(event: LayoutChangeEvent) => {
                  rowOffsets.current[option.key] = event.nativeEvent.layout.y;
                  // Secondary trigger: if the SELECTED row's offset lands after
                  // the content-size pass, jump the moment it is recorded. The
                  // one-shot guard keeps the two triggers to a single scroll.
                  if (option.key === selectedKey) {
                    scrollToSelected();
                  }
                }}
                style={[
                  styles.option,
                  { backgroundColor: isSelected ? theme.colors.accent : 'transparent' },
                ]}
              >
                {isSelected ? (
                  // The selected row sits on the accent fill, so its glyph reads
                  // white (tone) to match the checkmark below — SymbolIcon's
                  // `color` overrides `tone`, so it must be omitted here.
                  <SymbolIcon name={option.icon} size={18} tone="textPrimary" />
                ) : (
                  <SymbolIcon name={option.icon} size={18} color={option.color} />
                )}

                <Text variant="body">{option.title}</Text>

                {isSelected && (
                  <Box style={styles.checkmark}>
                    <SymbolIcon name="checkmark" size={16} tone="textPrimary" />
                  </Box>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </Box>
  );
};

export default CategoryField;
