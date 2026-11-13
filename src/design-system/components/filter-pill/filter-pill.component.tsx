import type { FC } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import Box from '../box';
import Text from '../text';
import SymbolIcon from '../symbol';

import { styles } from './filter-pill.styles';
import type { FilterPillProps } from './filter-pill.props';

// The trigger of a screen filter: a glyph and a label in one bordered chip. FilterMenu and
// DateRangeField render it, so the filters of a screen read as one row.
const FilterPill: FC<FilterPillProps> = ({ label, icon, onPress, accessibilityLabel, testID }) => {
  const { theme } = useUnistyles();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.pill}
      testID={testID}
    >
      <Box direction="row" gap={2} style={styles.row}>
        {icon !== undefined && (
          <SymbolIcon name={icon} size={theme.iconSizes.body} tone="textPrimary" />
        )}

        <Text variant="body" tone="textPrimary">
          {label}
        </Text>
      </Box>
    </Pressable>
  );
};

export default FilterPill;
