import {
  NavigationContext,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useFocusRefreshedNow } from './use-focus-refreshed-now';

// A minimal fake navigation that reports itself focused and lets a test fire the
// `focus`/`blur` events `useFocusEffect` subscribes to — the same real-context
// approach use-scroll-to-top-on-tab-press.test.tsx drives its tabPress through.
// `useFocusEffect` (`@react-navigation/core`) runs its effect immediately at
// mount when `navigation.isFocused()` is already true, and its own internal
// "already focused" guard then SKIPS a bare `focus` emit that isn't preceded by
// a `blur` — real navigation only ever emits `focus` after a `blur` put the
// screen out of focus first, so `fireFocus` models that real sequence (blur
// then focus) rather than a bare re-emit.
const makeNavigation = (): {
  navigation: NavigationProp<ParamListBase>;
  fireFocus: () => void;
} => {
  const focusListeners = new Set<() => void>();
  const blurListeners = new Set<() => void>();

  const navigation = {
    isFocused: () => true,
    addListener: (event: string, callback: () => void) => {
      if (event === 'focus') {
        focusListeners.add(callback);

        return () => focusListeners.delete(callback);
      }

      if (event === 'blur') {
        blurListeners.add(callback);

        return () => blurListeners.delete(callback);
      }

      return () => undefined;
    },
  } as unknown as NavigationProp<ParamListBase>;

  const fireFocus = () => {
    for (const callback of blurListeners) {
      callback();
    }

    for (const callback of focusListeners) {
      callback();
    }
  };

  return { navigation, fireFocus };
};

describe('useFocusRefreshedNow', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds now at mount and re-reads the clock on every focus', async () => {
    let clock = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);

    const { navigation, fireFocus } = makeNavigation();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
    );
    const { result } = await renderHook(() => useFocusRefreshedNow(), { wrapper });

    expect(result.current).toBe(1_000);

    clock = 5_000;
    await act(async () => {
      fireFocus();
    });

    expect(result.current).toBe(5_000);
  });
});
