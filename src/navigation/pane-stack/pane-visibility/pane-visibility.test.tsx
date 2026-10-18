import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react-native';

import { PaneVisibilityContext, detailParamOf, useIsScreenVisible, useDetailPaneRoute } from '.';

let mockRouteKey = 'companion-route';
let mockIsFocused = false;

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ key: mockRouteKey }),
  useIsFocused: () => mockIsFocused,
}));

const VISIBLE_KEYS = new Set(['companion-route', 'primary-route']);
const DETAIL_ROUTE = {
  key: 'primary-route',
  name: 'AccountDetail',
  params: { accountId: 'a' },
  isDefault: false,
};

const renderInPanesWith = <Result,>(hook: () => Result, isTabFocused = true) =>
  renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <PaneVisibilityContext.Provider
        value={{ isTabFocused, visibleKeys: VISIBLE_KEYS, detailRoute: DETAIL_ROUTE }}
      >
        {children}
      </PaneVisibilityContext.Provider>
    ),
  });

const renderInPanes = (isTabFocused: boolean) =>
  renderInPanesWith(() => useIsScreenVisible(), isTabFocused);

describe('useIsScreenVisible', () => {
  beforeEach(() => {
    mockRouteKey = 'companion-route';
    mockIsFocused = false;
  });

  describe('in two panes', () => {
    it('reports the companion route visible although it is not the focused route', async () => {
      const { result } = await renderInPanes(true);

      expect(result.current).toBe(true);
    });

    it('reports the primary route visible', async () => {
      mockRouteKey = 'primary-route';
      mockIsFocused = true;
      const { result } = await renderInPanes(true);

      expect(result.current).toBe(true);
    });

    it('reports a route that a later route of its pane covers as not visible', async () => {
      mockRouteKey = 'covered-route';
      mockIsFocused = true;
      const { result } = await renderInPanes(true);

      expect(result.current).toBe(false);
    });

    it.each(['companion-route', 'primary-route'])(
      'reports %s as not visible while the tab is not focused',
      async (routeKey) => {
        mockRouteKey = routeKey;
        mockIsFocused = true;
        const { result } = await renderInPanes(false);

        expect(result.current).toBe(false);
      },
    );
  });

  describe('in one pane', () => {
    it.each([true, false])('equals useIsFocused (%s)', async (isFocused) => {
      mockIsFocused = isFocused;
      const { result } = await renderHook(() => useIsScreenVisible());

      expect(result.current).toBe(isFocused);
    });
  });
});

describe('useDetailPaneRoute', () => {
  it('hands over the first route of the detail pane', async () => {
    const { result } = await renderInPanesWith(() => useDetailPaneRoute());

    expect(result.current).toBe(DETAIL_ROUTE);
  });

  it('is null in one pane, where there is no detail pane', async () => {
    const { result } = await renderHook(() => useDetailPaneRoute());

    expect(result.current).toBeNull();
  });
});

describe('detailParamOf', () => {
  it('reads a string param of the named route', () => {
    expect(detailParamOf(DETAIL_ROUTE, 'AccountDetail', 'accountId')).toBe('a');
  });

  it.each([
    ['no route', null, 'AccountDetail', 'accountId'],
    ['another route', DETAIL_ROUTE, 'HoldingDetail', 'accountId'],
    ['a param the route lacks', DETAIL_ROUTE, 'AccountDetail', 'holdingId'],
    [
      'a route with no params',
      { ...DETAIL_ROUTE, params: undefined },
      'AccountDetail',
      'accountId',
    ],
    [
      'a param that is not a string',
      { ...DETAIL_ROUTE, params: { accountId: 7 } },
      'AccountDetail',
      'accountId',
    ],
  ])('is undefined for %s', (_name, route, name, param) => {
    expect(detailParamOf(route, name, param)).toBeUndefined();
  });
});
