import { act, renderHook } from '@testing-library/react-native';
import type { TablePeriod } from '@kiko/statistics/table-period';
import { useTablesPeriodSelection } from '@kiko/statistics/use-tables-period-selection';

/**
 * The Tables period lives for the app session, so a test that starts from a kept period picks it
 * here before it renders the screen, through a reader of its own.
 */
export const pickTablesPeriod = async (period: TablePeriod | undefined): Promise<void> => {
  const { result, unmount } = await renderHook(() => useTablesPeriodSelection());

  await act(async () => {
    result.current.selectPeriod(period);
  });
  await unmount();
};

/** Hands the next test a store with no pick, so its Tables screen opens on the default. */
export const resetTablesPeriodSelection = async (): Promise<void> => {
  await pickTablesPeriod(undefined);
};
