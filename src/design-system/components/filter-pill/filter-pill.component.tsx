import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './filter-pill.styles';
import type { FilterPillProps } from './filter-pill.props';

// The trigger of a screen filter: a glyph, a label and a trailing chevron in one bordered chip.
// FilterMenu, DateRangeField and TrendFilterField render it, so the filters of a screen read as
// one row.
const FilterPill: FC<FilterPillProps> = ({
  label,
  icon,
  onPress,
  accessibilityLabel,
  accessibilityValue,
  active = false,
  testID,
}) => {
  const { theme } = useUnistyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={accessibilityValue}
      hitSlop={{ top: theme.layout.filterPillHitSlop, bottom: theme.layout.filterPillHitSlop }}
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      testID={testID}
    >
      <Box direction="row" gap={2} style={styles.row}>
        {icon !== undefined && (
          <SymbolIcon
            name={icon}
            size={theme.iconSizes.body}
            tone={active ? 'accent' : 'textPrimary'}
          />
        )}

        <Box style={styles.label}>
          <Text variant="body" tone="textPrimary">
            {label}
          </Text>
        </Box>

        <Box accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <SymbolIcon name="chevron.down" size={theme.iconSizes.caption} tone="textSecondary" />
        </Box>
      </Box>
    </Pressable>
  );
};

export default FilterPill;
