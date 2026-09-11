import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SelectableRow from '../../../design-system/components/selectable-row';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { FilterMenuProps, FilterOption } from './filter-menu.props';
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
 * explicit tap-outside. (A native iOS UIMenu rebuilds — and so dismisses —
 * itself whenever its actions change on toggle, which no prop reliably prevents,
 * so a pure-JS sheet owns this behaviour instead.)
 */
const FilterMenu: FC<FilterMenuProps> = ({ label, options, selected, onToggle, testID }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const buttonLabel = selected.size > 0 ? `${label} · ${selected.size}` : label;
  // Prepend the synthetic "All" row (no icon) to the real options. Every row is
  // a FilterOption so the render path is uniform; matching still keys on `value`.
  const rows: FilterOption[] = [{ value: FILTER_ALL }, ...options];
  // The sentinel's stored `value` (FILTER_ALL) stays the fixed English string
  // that toggleFilter/isChecked match on; only the DISPLAYED row label is
  // translated. A real option renders its own `label` when given one (e.g. a
  // category's resolved, localized title, distinct from its stable `value`
  // key) or falls back to `value` itself (an account name IS its own label).
  const rowLabel = (option: FilterOption): string =>
    option.value === FILTER_ALL ? t('common.all') : (option.label ?? option.value);
  // Reserve a fixed-width leading icon slot on every row only when at least one
  // option carries an icon, so labels stay aligned between icon and icon-less
  // rows (the "All" row, or any option with no icon) without adding dead space
  // to a menu whose options are all icon-less.
  const hasIcons = options.some((option) => option.icon != null);

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

        {rows.map((option) => (
          <SelectableRow
            key={option.value}
            accessibilityRole="checkbox"
            selected={isChecked(option.value, selected)}
            onPress={() => onToggle(option.value)}
            label={rowLabel(option)}
            icon={option.icon}
            iconColor={option.color}
            reserveIconSlot={hasIcons}
            testID={`${testID}-option-${option.value}`}
          />
        ))}
      </BottomSheet>
    </>
  );
};

export default FilterMenu;
