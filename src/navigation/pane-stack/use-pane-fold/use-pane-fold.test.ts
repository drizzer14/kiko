import { renderHook } from '@testing-library/react-native';

import { PaneActions } from '../pane-router';

import { usePaneFold } from '.';

const renderFold = (dispatch: jest.Mock, isSplit: boolean) =>
  renderHook(({ split }: { split: boolean }) => usePaneFold(dispatch, split), {
    initialProps: { split: isSplit },
  });

describe('usePaneFold', () => {
  it('dispatches nothing on mount, whichever the mode', async () => {
    const dispatch = jest.fn();

    await renderFold(dispatch, true);
    await renderFold(dispatch, false);

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('folds once when the window goes from two panes to one', async () => {
    const dispatch = jest.fn();
    const { rerender } = await renderFold(dispatch, true);

    await rerender({ split: false });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(PaneActions.fold());
  });

  it('unfolds once when the window goes from one pane to two', async () => {
    const dispatch = jest.fn();
    const { rerender } = await renderFold(dispatch, false);

    await rerender({ split: true });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(PaneActions.unfold());
  });

  it('dispatches nothing again for a rerender with the same mode', async () => {
    const dispatch = jest.fn();
    const { rerender } = await renderFold(dispatch, true);

    await rerender({ split: false });
    await rerender({ split: false });
    await rerender({ split: false });

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('follows every change of mode in turn', async () => {
    const dispatch = jest.fn();
    const { rerender } = await renderFold(dispatch, true);

    await rerender({ split: false });
    await rerender({ split: true });

    expect(dispatch.mock.calls).toEqual([[PaneActions.fold()], [PaneActions.unfold()]]);
  });
});
