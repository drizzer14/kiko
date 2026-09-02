import type { FC } from 'react';
import Box from '../../design-system/components/box';
import FilterChipRow from './filter-chip-row';

export { FILTER_ALL } from './filter-chip-row';

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
}) => {
  return (
    <Box gap={2}>
      <FilterChipRow options={accounts} selected={selectedAccount} onToggle={onToggleAccount} />
      <FilterChipRow options={categories} selected={selectedCategory} onToggle={onToggleCategory} />
    </Box>
  );
};

export default TransactionFilterBar;
