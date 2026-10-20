import '@kiko/design-system/unistyles';
import { createElement, Fragment } from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
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

  it('keeps the pick while one reader unmounts and another stays mounted', async () => {
    const first = await renderHook(() => useStatisticsFilterSelection());
    const second = await renderHook(() => useStatisticsFilterSelection());

    await act(async () => {
      first.result.current.toggleAccount('a');
      first.result.current.toggleCategory('groceries');
    });
    await first.unmount();

    expect(second.result.current.selectedAccounts).toEqual(new Set(['a']));
    expect(second.result.current.selectedCategories).toEqual(new Set(['groceries']));

    // A reset writes no notification, so a reader that reads the store afresh shows whether it ran.
    const late = await renderHook(() => useStatisticsFilterSelection());

    expect(late.result.current.selectedAccounts).toEqual(new Set(['a']));
    expect(late.result.current.selectedCategories).toEqual(new Set(['groceries']));
  });

  describe('when every reader is replaced in one commit', () => {
    const latest: Record<string, ReturnType<typeof useStatisticsFilterSelection>> = {};

    const SwapReader = ({ name }: { name: string }): null => {
      latest[name] = useStatisticsFilterSelection();

      return null;
    };

    // A new key replaces both readers in one commit, like a fold/unfold that rebuilds the tree.
    const SwapPair = ({ generation }: { generation: number }) =>
      createElement(
        Fragment,
        { key: generation },
        createElement(SwapReader, { name: 'first' }),
        createElement(SwapReader, { name: 'second' }),
      );

    it('keeps the pick', async () => {
      const rendered = await render(createElement(SwapPair, { generation: 0 }));

      await act(async () => {
        latest.first.toggleAccount('a');
        latest.first.toggleCategory('groceries');
      });
      await rendered.rerender(createElement(SwapPair, { generation: 1 }));

      expect(latest.first.selectedAccounts).toEqual(new Set(['a']));
      expect(latest.first.selectedCategories).toEqual(new Set(['groceries']));
      expect(latest.second.selectedAccounts).toEqual(new Set(['a']));
      expect(latest.second.selectedCategories).toEqual(new Set(['groceries']));

      // The deferred reset writes no notification, so only a reader that reads the store afresh
      // shows whether it ran.
      const late = await renderHook(() => useStatisticsFilterSelection());

      expect(late.result.current.selectedAccounts).toEqual(new Set(['a']));
      expect(late.result.current.selectedCategories).toEqual(new Set(['groceries']));
    });
  });
});
