import type { TrendFilter } from '../../../statistics/trend-filter';
import type { FilterOption } from '../../home/filter-menu/filter-menu.props';

export type TrendFilterFieldProps = {
  // The APPLIED (saved) filter — drives the button label and seeds the sheet's
  // draft each time it opens.
  filter: TrendFilter;
  // The category multi-select options for manual mode: stable KEYS as `value`,
  // localized titles as `label`, plus each category's icon and color. Reused
  // from the screen's `categoryOptions` (custom order preserved).
  categoryOptions: FilterOption[];
  // Apply AND persist the whole filter, then the field closes the sheet.
  onSave: (filter: TrendFilter) => void;
  // The field button's testID; the sheet, its actions, and its category rows
  // derive their own testIDs from it.
  testID: string;
};
