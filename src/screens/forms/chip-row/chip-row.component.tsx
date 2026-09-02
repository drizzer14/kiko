import type { ReactElement } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import type { ChipRowProps } from './chip-row.props';
import { styles } from './chip-row.styles';

// A labeled single-select chip row: the kind and currency pickers are otherwise
// identical Pressable/Text JSX, so this reusable component renders either from
// its options/selected/onSelect props instead of duplicating the markup.
const ChipRow = <Option extends string>({
  options,
  selected,
  onSelect,
}: ChipRowProps<Option>): ReactElement => {
  const { theme } = useUnistyles();

  return (
    <Box style={styles.chipRow} gap={2}>
      {options.map((option) => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === option }}
          onPress={() => onSelect(option)}
          style={[
            styles.chip,
            { backgroundColor: selected === option ? theme.colors.accent : theme.colors.surface },
          ]}
        >
          <Text variant="body">{option}</Text>
        </Pressable>
      ))}
    </Box>
  );
};

export default ChipRow;
