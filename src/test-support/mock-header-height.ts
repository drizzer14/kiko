import { Animated } from 'react-native';

/**
 * The native stack as a screen suite mounts it outside a navigator: the real module, with the
 * animated header height (which throws without a header) one value for the whole suite, so a screen
 * that hands it to a table sees the same node on every render. Wire it with
 * `jest.mock('@react-navigation/native-stack', () =>
 * (require('@kiko/test-support/mock-header-height') as typeof
 * import('@kiko/test-support/mock-header-height')).nativeStackModule())`: the `require` runs inside
 * the factory, which `jest.mock` hoists above every import, so no import order can run the screen
 * before the mock is in place.
 */
export const nativeStackModule = () => {
  const headerHeight = new Animated.Value(100);

  return {
    ...(jest.requireActual('@react-navigation/native-stack') as object),
    useAnimatedHeaderHeight: () => headerHeight,
  };
};
