import { act } from '@testing-library/react-native';
import type { LayoutMode } from '@kiko/display-regions';

// The layout mode a test can change, as the native module reports it: through a subscription.
const store = { mode: 'single' as LayoutMode, listeners: new Set<() => void>() };

// A test file mocks `@kiko/display-regions` with this module: everything real, except that
// `useLayoutMode` reads the store below, so `emitLayoutMode` re-renders what uses it.
export const layoutModeSpyModule = () => {
  const { useSyncExternalStore } = require('react');

  return {
    ...jest.requireActual('@kiko/display-regions'),
    useLayoutMode: (): LayoutMode =>
      useSyncExternalStore(
        (listener: () => void) => {
          store.listeners.add(listener);

          return () => store.listeners.delete(listener);
        },
        () => store.mode,
      ),
  };
};

// The window changes shape, as on a fold or unfold.
export const emitLayoutMode = async (mode: LayoutMode): Promise<void> => {
  await act(async () => {
    store.mode = mode;

    for (const listener of store.listeners) {
      listener();
    }
  });
};

export const resetLayoutMode = (): void => {
  store.mode = 'single';
};
