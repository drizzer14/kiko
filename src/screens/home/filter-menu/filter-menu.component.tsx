import { type FC, useState } from 'react';
import { Pressable } from 'react-native';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import type { FilterMenuProps } from './filter-menu.props';
import { styles } from './filter-menu.styles';

/** The default option in every filter menu — selecting it clears that dimension. */
export const FILTER_ALL = 'All';

// Whether an option row should render checked: the sentinel is checked when the
// dimension is empty ("all"); any other value is checked when it is in the set.
const isChecked = (value: string, selected: Set<string>): boolean =>
  value === FILTER_ALL ? selected.size === 0 : selected.has(value);

/**
 * A single multi-select filter over one dimension, rendered as a custom
 * dropdown rather than a native menu. Tapping a row toggles it and the sheet
 * stays open, so several values can be checked in one pass; it closes only on an
 * explicit tap-outside. (The native @react-native-menu/menu rebuilds — and so
 * dismisses — its UIMenu whenever the actions array changes on toggle, which no
 * prop reliably prevents, so a pure-JS sheet owns this behaviour instead.)
 */
const FilterMenu: FC<FilterMenuProps> = ({ label, options, selected, onToggle, testID }) => {
  const [open, setOpen] = useState(false);

  const buttonLabel = selected.size > 0 ? `${label} · ${selected.size}` : label;
  const rows = [FILTER_ALL, ...options];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        testID={testID}
      >
        <Box direction="row" gap={2} style={styles.button}>
          <SymbolIcon name="line.3.horizontal.decrease.circle" size={18} tone="textPrimary" />

          <Text variant="body">{buttonLabel}</Text>
        </Box>
      </Pressable>

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={2}
        backdropTestID={`${testID}-backdrop`}
      >
        <Text variant="heading">{label}</Text>

        {rows.map((value) => (
          <Pressable
            key={value}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isChecked(value, selected) }}
            testID={`${testID}-option-${value}`}
            onPress={() => onToggle(value)}
          >
            <Box direction="row" gap={2} style={styles.option}>
              <Box style={styles.check}>
                {isChecked(value, selected) && (
                  <SymbolIcon name="checkmark" size={16} tone="textPrimary" />
                )}
              </Box>

              <Text variant="body">{value}</Text>
            </Box>
          </Pressable>
        ))}
      </BottomSheet>
    </>
  );
};

export default FilterMenu;
