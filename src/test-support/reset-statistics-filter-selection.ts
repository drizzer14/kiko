import '@kiko/design-system/unistyles';
import { act, renderHook } from '@testing-library/react-native';
import { useStatisticsFilterSelection } from '@kiko/design-system/use-statistics-filter-selection';

/**
 * The Statistics account and category picks live for the app session, so a test that picks one
 * calls this in an `afterEach` to hand the next test a store on "all": it toggles every held
 * value off through a reader of its own.
 */
export const resetStatisticsFilterSelection = async (): Promise<void> => {
  const { result, unmount } = await renderHook(() => useStatisticsFilterSelection());
  const { selectedAccounts, selectedCategories } = result.current;

  await act(async () => {
    for (const account of selectedAccounts) {
      result.current.toggleAccount(account);
    }

    for (const category of selectedCategories) {
      result.current.toggleCategory(category);
    }
  });
  await unmount();
};
