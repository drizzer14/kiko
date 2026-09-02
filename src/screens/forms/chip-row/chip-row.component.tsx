import type { ReactElement } from 'react';
import { Pressable } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import type { ChipRowProps } from './chip-row.props';
import { styles } from './chip-row.styles';

// A labeled single-select chip row: the kind and currency pickers are otherwise
// identical Pressable/Text JSX, so this reusable component renders either from
// its options/selected/onSelect props instead of duplicating the markup. An
// optional `labels` map humanizes id-like values (term_deposit -> Term Deposit)
// for display while `onSelect` keeps reporting the underlying value; an optional
// `label` renders a caption above the chips so it reads as a labeled field.
const ChipRow = <Option extends string>({
  options,
  selected,
  onSelect,
  label,
  labels,
}: ChipRowProps<Option>): ReactElement => {
  const { theme } = useUnistyles();

  return (
    <Box gap={1}>
      {label !== undefined && (
        <Text variant="caption" tone="textSecondary">
          {label}
        </Text>
      )}

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
            <Text variant="body">{labels?.[option] ?? option}</Text>
          </Pressable>
        ))}
      </Box>
    </Box>
  );
};

export default ChipRow;
