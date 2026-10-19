import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { PaneActions } from '../pane-router';
import { OpenInPaneContext } from '../open-in-pane';

import { useShowPaneDefault } from '.';

const renderInPaneStack = async (dispatch: jest.Mock) =>
  renderHook(() => useShowPaneDefault(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <OpenInPaneContext.Provider value={dispatch}>{children}</OpenInPaneContext.Provider>
    ),
  });

describe('useShowPaneDefault', () => {
  it('dispatches the default for the detail pane, which the caller does not name', async () => {
    const dispatch = jest.fn();
    const { result } = await renderInPaneStack(dispatch);

    result.current('AccountDetail', { accountId: 'a' });

    expect(dispatch).toHaveBeenCalledWith(
      PaneActions.showDefault('AccountDetail', { accountId: 'a' }),
    );
  });

  it('tells the router when the default only stands for there being nothing to show', async () => {
    const dispatch = jest.fn();
    const { result } = await renderInPaneStack(dispatch);

    result.current('AccountsEmptyPane', undefined, true);

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ isPlaceholder: true }),
      }),
    );
  });

  it('does nothing outside a pane stack, which has no pane to fill', async () => {
    const { result } = await renderHook(() => useShowPaneDefault());

    expect(() => result.current('AccountDetail')).not.toThrow();
  });

  it('keeps one function while the dispatcher stays the same', async () => {
    const { result, rerender } = await renderInPaneStack(jest.fn());
    const first = result.current;

    await rerender({});

    expect(result.current).toBe(first);
  });
});
