import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { PaneActions } from '../pane-router';
import { OpenInPaneContext } from '../open-in-pane';

import { useShowPaneDefault } from '.';

describe('useShowPaneDefault', () => {
  it('dispatches the pane default for the pane named', async () => {
    const dispatch = jest.fn();
    const { result } = await renderHook(() => useShowPaneDefault(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
      ),
    });

    result.current('primary', 'AccountDetail', { accountId: 'a' });

    expect(dispatch).toHaveBeenCalledWith(
      PaneActions.showDefault('primary', 'AccountDetail', { accountId: 'a' }),
    );
  });

  it('does nothing outside a pane stack, which has no pane to fill', async () => {
    const { result } = await renderHook(() => useShowPaneDefault());

    expect(() => result.current('primary', 'AccountDetail')).not.toThrow();
  });

  it('keeps one function while the dispatcher stays the same', async () => {
    const dispatch = jest.fn();
    const { result, rerender } = await renderHook(() => useShowPaneDefault(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
      ),
    });
    const first = result.current;

    await rerender({});

    expect(result.current).toBe(first);
  });
});
