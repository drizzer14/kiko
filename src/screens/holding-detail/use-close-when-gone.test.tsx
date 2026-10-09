import type { ReactNode } from 'react';
import type { HoldingRow } from '@kiko/db';
import { renderHook } from '@testing-library/react-native';
import { PaneContext, paneContextOf } from '@kiko/design-system/pane-context';

import { useCloseWhenGone } from './use-close-when-gone';

const mockClosePaneRoute = jest.fn();
jest.mock('@kiko/navigation/pane-stack', () => ({
  useClosePaneRoute: () => mockClosePaneRoute,
}));

const HOLDING = { id: 'h-1' } as HoldingRow;

const inPane = ({ children }: { children: ReactNode }) => (
  <PaneContext.Provider value={paneContextOf('columns', 'companion')}>
    {children}
  </PaneContext.Provider>
);

const renderGone = (
  input: { isFresh?: boolean; holding?: HoldingRow | undefined },
  wrapper?: typeof inPane,
) =>
  renderHook(
    () =>
      useCloseWhenGone({
        routeKey: 'page-key',
        isFresh: input.isFresh ?? true,
        holding: input.holding,
      }),
    { wrapper },
  );

describe('useCloseWhenGone', () => {
  beforeEach(() => {
    mockClosePaneRoute.mockClear();
  });

  it('closes its own route once a fresh read has no such holding', async () => {
    await renderGone({}, inPane);

    expect(mockClosePaneRoute).toHaveBeenCalledTimes(1);
    expect(mockClosePaneRoute).toHaveBeenCalledWith('page-key');
  });

  it('stays open while the holding is there', async () => {
    await renderGone({ holding: HOLDING }, inPane);

    expect(mockClosePaneRoute).not.toHaveBeenCalled();
  });

  it('waits for a read that is fresh, and for the first load, before judging it gone', async () => {
    await renderGone({ isFresh: false }, inPane);

    expect(mockClosePaneRoute).not.toHaveBeenCalled();
  });

  it('never closes on one pane, where the page is the whole screen', async () => {
    await renderGone({});

    expect(mockClosePaneRoute).not.toHaveBeenCalled();
  });

  it('closes once, not on every render after', async () => {
    const { rerender } = await renderGone({}, inPane);

    await rerender({});

    expect(mockClosePaneRoute).toHaveBeenCalledTimes(1);
  });
});
