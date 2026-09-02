import type { FC } from 'react';
import { ScrollView } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../design-system/components/box';
import PressableButton from '../../design-system/components/pressable-button';
import Text from '../../design-system/components/text';
import { styles } from './transaction-filter-bar.styles';

/** The default option on every filter row — "no filter applied". */
export const FILTER_ALL = 'All';

type FilterChipRowProps = {
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
};

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
        {[FILTER_ALL, ...options].map(option => (
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

type TransactionFilterBarProps = {
  accounts: string[];
  categories: string[];
  selectedAccount: Set<string>;
  selectedCategory: Set<string>;
  onToggleAccount: (value: string) => void;
  onToggleCategory: (value: string) => void;
};

/** Two independent multi-select filter rows stacked above the transaction list. */
const TransactionFilterBar: FC<TransactionFilterBarProps> = ({
  accounts,
  categories,
  selectedAccount,
  selectedCategory,
  onToggleAccount,
  onToggleCategory,
}) => (
  <Box gap={2}>
    <FilterChipRow options={accounts} selected={selectedAccount} onToggle={onToggleAccount} />
    <FilterChipRow options={categories} selected={selectedCategory} onToggle={onToggleCategory} />
  </Box>
);

export default TransactionFilterBar;
