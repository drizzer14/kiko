import type { FC } from 'react';
import { ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../../design-system/components/box';
import PressableButton from '../../../design-system/components/pressable-button';
import Text from '../../../design-system/components/text';
import type { FilterChipRowProps } from './filter-chip-row.props';
import { styles } from './filter-chip-row.styles';

/** The default option on every filter row — "no filter applied". */
export const FILTER_ALL = 'All';

/**
 * A multi-select, horizontally-scrolling row of chips: `FILTER_ALL` plus one
 * per option. A chip is active when it is in `selected`; the `FILTER_ALL` chip
 * is active when `selected` is empty (an empty set means "no filter").
 */
const FilterChipRow: FC<FilterChipRowProps> = ({ options, selected, onToggle }) => {
  const { theme } = useUnistyles();

  const isActive = (option: string): boolean =>
    option === FILTER_ALL ? selected.size === 0 : selected.has(option);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
      <Box gap={2} direction="row">
        {[FILTER_ALL, ...options].map((option) => (
          <PressableButton
            key={option}
            onPress={() => onToggle(option)}
            backgroundColor={isActive(option) ? theme.colors.surfaceHigh : theme.colors.surface}
          >
            <Text variant="caption" tone={isActive(option) ? 'textPrimary' : 'textSecondary'}>
              {option}
            </Text>
          </PressableButton>
        ))}
      </Box>
    </ScrollView>
  );
};

export default FilterChipRow;
