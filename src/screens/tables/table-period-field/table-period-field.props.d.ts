import type { TablePeriod } from '@kiko/statistics/table-period';

export type TablePeriodFieldProps = {
  period: TablePeriod;
  /** Every period on offer, in the order the sheet lists them. */
  options: readonly TablePeriod[];
  /** The moment that "this quarter" and "this year" are read against. */
  now: number;
  onSelect: (period: TablePeriod) => void;
  testID: string;
};
