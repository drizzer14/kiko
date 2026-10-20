import '@kiko/design-system/unistyles';
import { act, renderHook } from '@testing-library/react-native';
import { FILTER_ALL } from '@kiko/design-system/components/filter-menu';

import { useStatisticsFilterSelection } from './use-statistics-filter-selection';

describe('useStatisticsFilterSelection', () => {
  it('starts on all accounts and all categories', async () => {
    const { result } = await renderHook(() => useStatisticsFilterSelection());

    expect(result.current.selectedAccounts).toEqual(new Set());
    expect(result.current.selectedCategories).toEqual(new Set());
  });

  it('toggles an account and a category independently, replacing the set each time', async () => {
    const { result } = await renderHook(() => useStatisticsFilterSelection());
    const before = result.current.selectedAccounts;

    await act(async () => {
      result.current.toggleAccount('a');
    });

    expect(result.current.selectedAccounts).toEqual(new Set(['a']));
    expect(result.current.selectedAccounts).not.toBe(before);
    expect(result.current.selectedCategories).toEqual(new Set());

    await act(async () => {
      result.current.toggleCategory('groceries');
      result.current.toggleAccount('a');
    });

    expect(result.current.selectedAccounts).toEqual(new Set());
    expect(result.current.selectedCategories).toEqual(new Set(['groceries']));
  });

  it('clears one dimension for the FILTER_ALL row and leaves the other', async () => {
    const { result } = await renderHook(() => useStatisticsFilterSelection());

    await act(async () => {
      result.current.toggleAccount('a');
      result.current.toggleCategory('groceries');
      result.current.toggleAccount(FILTER_ALL);
    });

    expect(result.current.selectedAccounts).toEqual(new Set());
    expect(result.current.selectedCategories).toEqual(new Set(['groceries']));
  });

  it('shares a pick between two mounted readers', async () => {
    const first = await renderHook(() => useStatisticsFilterSelection());
    const second = await renderHook(() => useStatisticsFilterSelection());

    await act(async () => {
      first.result.current.toggleCategory('transport');
    });

    expect(second.result.current.selectedCategories).toEqual(new Set(['transport']));
  });

  it('starts on all again once no reader is mounted', async () => {
    const first = await renderHook(() => useStatisticsFilterSelection());

    await act(async () => {
      first.result.current.toggleAccount('b');
    });
    await first.unmount();

    const second = await renderHook(() => useStatisticsFilterSelection());

    expect(second.result.current.selectedAccounts).toEqual(new Set());
  });
});
