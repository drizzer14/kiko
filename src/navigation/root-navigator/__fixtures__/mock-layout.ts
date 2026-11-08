import { useSyncExternalStore } from 'react';

/** The layout mode the Tables navigator suites move by hand; its listeners are the live hooks. */
export const layout = { mode: 'single' as 'single' | 'columns', listeners: new Set<() => void>() };

const subscribe = (listener: () => void) => {
  layout.listeners.add(listener);

  return () => layout.listeners.delete(listener);
};

/**
 * `@kiko/display-regions` with the layout mode read from `layout` and no fold region. Wire it
 * with `jest.mock('@kiko/display-regions', () =>
 * require('./__fixtures__/mock-layout').displayRegionsModule())`.
 */
export const displayRegionsModule = () => ({
  ...jest.requireActual('@kiko/display-regions'),
  useLayoutMode: () => useSyncExternalStore(subscribe, () => layout.mode),
  useFoldRegion: () => null,
});

/**
 * The bottom tabs on the real tab router, where a tab mounts on its first focus and stays
 * mounted, as the native bottom tabs do. Wire it with `jest.mock('@bottom-tabs/react-navigation',
 * () => require('./__fixtures__/mock-layout').bottomTabsModule())`.
 */
export const bottomTabsModule = () => {
  const native = jest.requireActual('@react-navigation/native');
  const LazyTabs = jest.requireActual('@kiko/test-support/lazy-tabs').default;

  return { createNativeBottomTabNavigator: native.createNavigatorFactory(LazyTabs) };
};
