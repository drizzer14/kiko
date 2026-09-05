import type { FC } from 'react';

import Box from '../../../design-system/components/box';
import DateRangeField from '../date-range-field';
import FilterMenu, { type FilterOption } from '../filter-menu';

// Re-exported so the Home screen keeps a single import site for the sentinel
// while the checkable-menu logic lives with the FilterMenu that owns it.
export { FILTER_ALL } from '../filter-menu';

type TransactionFilterBarProps = {
  accounts: FilterOption[];
  categories: FilterOption[];
  selectedAccount: Set<string>;
  selectedCategory: Set<string>;
  onToggleAccount: (value: string) => void;
  onToggleCategory: (value: string) => void;
  dateFrom: Date | null;
  dateTo: Date | null;
  minDate: Date;
  maxDate: Date;
  onApplyDates: (from: Date | null, to: Date | null) => void;
  onClearDates: () => void;
};

/** Two multi-select dropdowns (accounts, categories) plus a date-range field. */
const TransactionFilterBar: FC<TransactionFilterBarProps> = ({
  accounts,
  categories,
  selectedAccount,
  selectedCategory,
  onToggleAccount,
  onToggleCategory,
  dateFrom,
  dateTo,
  minDate,
  maxDate,
  onApplyDates,
  onClearDates,
}) => {
  return (
    <Box gap={3}>
      <Box direction="row" gap={3}>
        <FilterMenu
          label="Accounts"
          options={accounts}
          selected={selectedAccount}
          onToggle={onToggleAccount}
          testID="account-filter-menu"
        />

        <FilterMenu
          label="Categories"
          options={categories}
          selected={selectedCategory}
          onToggle={onToggleCategory}
          testID="category-filter-menu"
        />
      </Box>

      <DateRangeField
        dateFrom={dateFrom}
        dateTo={dateTo}
        minDate={minDate}
        maxDate={maxDate}
        onApply={onApplyDates}
        onClear={onClearDates}
      />
    </Box>
  );
};

export default TransactionFilterBar;
