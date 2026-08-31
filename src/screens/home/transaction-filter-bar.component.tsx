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
  selected: string;
  onSelect: (value: string) => void;
};

/** A single-select, horizontally-scrolling row of chips: `FILTER_ALL` plus one per option. */
const FilterChipRow: FC<FilterChipRowProps> = ({ options, selected, onSelect }) => {
  const { theme } = useUnistyles();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row}>
      <Box gap={2} direction="row">
        {[FILTER_ALL, ...options].map(option => (
          <PressableButton
            key={option}
            onPress={() => onSelect(option)}
            backgroundColor={selected === option ? theme.colors.surfaceHigh : theme.colors.surface}
          >
            <Text variant="caption" tone={selected === option ? 'textPrimary' : 'textSecondary'}>
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
  selectedAccount: string;
  selectedCategory: string;
  onSelectAccount: (value: string) => void;
  onSelectCategory: (value: string) => void;
};

/** Two independent single-select filter rows stacked above the transaction list. */
const TransactionFilterBar: FC<TransactionFilterBarProps> = ({
  accounts,
  categories,
  selectedAccount,
  selectedCategory,
  onSelectAccount,
  onSelectCategory,
}) => (
  <Box gap={2}>
    <FilterChipRow options={accounts} selected={selectedAccount} onSelect={onSelectAccount} />
    <FilterChipRow options={categories} selected={selectedCategory} onSelect={onSelectCategory} />
  </Box>
);

export default TransactionFilterBar;
