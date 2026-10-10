import {
  NavigationContext,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import type { ReactElement, ReactNode } from 'react';

/**
 * A screen navigation that only keeps `focus` listeners, so a test can say when
 * the screen regains focus (the way the hook under test hears it from the real
 * navigator) without building a navigator. `provide` wraps a tree in the
 * context a screen's components read it from. The cast is confined here: a full
 * navigation object cannot be built in a unit test.
 */
export const makeFocusNavigation = (): {
  provide: (children: ReactNode) => ReactElement;
  fireFocus: () => void;
} => {
  const focusListeners = new Set<() => void>();

  const navigation = {
    addListener: (event: string, callback: () => void) => {
      if (event === 'focus') {
        focusListeners.add(callback);

        return () => focusListeners.delete(callback);
      }

      return () => undefined;
    },
  } as unknown as NavigationProp<ParamListBase>;

  return {
    provide: (children) => (
      <NavigationContext.Provider value={navigation}>{children}</NavigationContext.Provider>
    ),
    fireFocus: () => {
      for (const callback of focusListeners) {
        callback();
      }
    },
  };
};
