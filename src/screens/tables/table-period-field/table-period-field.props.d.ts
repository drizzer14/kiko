import type { TablePeriod } from '@kiko/statistics/table-period';

export type TablePeriodFieldProps = {
  period: TablePeriod;
  /** Every period on offer, in the order the sheet lists them. */
  options: readonly TablePeriod[];
  onSelect: (period: TablePeriod) => void;
  testID: string;
};
