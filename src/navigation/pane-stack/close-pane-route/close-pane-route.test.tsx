import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { PaneActions } from '../pane-router';
import { OpenInPaneContext } from '../open-in-pane';

import { useClosePaneRoute } from '.';

describe('useClosePaneRoute', () => {
  it('dispatches the close of the route named', async () => {
    const dispatch = jest.fn();
    const { result } = await renderHook(() => useClosePaneRoute(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
      ),
    });

    result.current('AccountDetail-key');

    expect(dispatch).toHaveBeenCalledWith(PaneActions.close('AccountDetail-key'));
  });

  it('does nothing outside a pane stack, which has no pane to close a route of', async () => {
    const { result } = await renderHook(() => useClosePaneRoute());

    expect(() => result.current('AccountDetail-key')).not.toThrow();
  });

  it('keeps one function while the dispatcher stays the same', async () => {
    const dispatch = jest.fn();
    const { result, rerender } = await renderHook(() => useClosePaneRoute(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
      ),
    });
    const first = result.current;

    await rerender({});

    expect(result.current).toBe(first);
  });
});
