import { useState } from 'react';
import { defaultDateRange } from '@kiko/dates';

type CustomRange = { from: Date | null; to: Date | null };

type DateRangeSelection = {
  dateFrom: Date | null;
  dateTo: Date | null;
  applyDateRange: (from: Date | null, to: Date | null) => void;
  clearDateRange: () => void;
};

/**
 * The date-range selection behind a `DateRangeField`. `customRange` holds an
 * explicit user pick; `null` means "show the default (last-30-days) range". The
 * default is derived FRESH from `now` on every render instead of being frozen
 * once in a `useState` initializer — a tab stays mounted after it is left, and
 * a range stored at mount would stop including today once a calendar day
 * passes. A user pick still stays exactly as given, even one side left null
 * (open-ended) via the date-range field.
 */
export const useDateRangeSelection = (now: number): DateRangeSelection => {
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const range = customRange ?? defaultDateRange(now);

  // The date-range modal commits both bounds at once on Apply; either may be
  // null when that side of the range is left open-ended.
  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setCustomRange({ from, to });
  };

  const clearDateRange = (): void => {
    setCustomRange(null);
  };

  return {
    dateFrom: range.from,
    dateTo: range.to,
    applyDateRange,
    clearDateRange,
  };
};
