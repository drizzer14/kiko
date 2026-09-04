import { type ReactElement, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, ScrollView } from 'react-native';
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
const PLACEHOLDER_LABEL = 'Select category';

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
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  // Each option row's vertical offset inside the ScrollView content, keyed by
  // option.key and filled from each row's onLayout. Rows can differ in height
  // (a wrapped title runs taller), so a measured offset map lands the selected
  // row accurately where a uniform row-height estimate would drift.
  const rowOffsets = useRef<Record<string, number>>({});

  const selected = options.find((option) => option.key === selectedKey) ?? null;

  const handleSelect = (key: string): void => {
    onSelect(key);
    setOpen(false);
  };

  // When the sheet opens onto an existing selection, jump the list so the
  // selected row is already on screen instead of always starting at the top.
  // Deferred a frame so the rows' onLayout offsets are recorded before the
  // scroll reads them. Guarded: no selection, or an unknown/top (0) offset,
  // leaves the list at the top.
  useEffect(() => {
    if (!open || selectedKey === null) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const offset = rowOffsets.current[selectedKey];

      if (offset === undefined || offset === 0) {
        return;
      }

      scrollRef.current?.scrollTo({ y: offset, animated: false });
    });

    return () => cancelAnimationFrame(frame);
  }, [open, selectedKey]);

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
            {selected?.title ?? PLACEHOLDER_LABEL}
          </Text>
        </Box>
      </Pressable>

      <BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={2} maxHeight="70%">
        <Text variant="heading">{label}</Text>

        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} style={styles.scroll}>
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
