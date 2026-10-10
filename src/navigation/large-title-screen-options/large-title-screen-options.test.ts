import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

// `isLiquidGlassSupported` is a static the options module reads once at load,
// so each tier needs a fresh module registry with its own mocked value.
const loadLargeTitleScreenOptions = (isLiquidGlassSupported: boolean) => {
  let options: NativeStackNavigationOptions | undefined;

  jest.isolateModules(() => {
    jest.doMock('@callstack/liquid-glass', () => ({ isLiquidGlassSupported }));
    options = require('./large-title-screen-options').largeTitleScreenOptions;
  });

  return options;
};

describe('largeTitleScreenOptions', () => {
  // Below iOS 26 react-native-screens builds a transparent bar with no
  // background effect, so a scrolled bar is fully see-through. The blur is
  // scoped to the scrolled bar: the at-rest large title stays transparent.
  it('blurs the scrolled bar and keeps the large title transparent below iOS 26', () => {
    expect(loadLargeTitleScreenOptions(false)).toEqual({
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterialDark',
      headerLargeStyle: { backgroundColor: 'transparent' },
    });
  });

  // The iOS 26/27 Liquid Glass header is user-approved and locked.
  it('passes only the large title on iOS 26+, with neither blur option', () => {
    const options = loadLargeTitleScreenOptions(true);

    expect(options).toEqual({ headerLargeTitle: true });
    expect(options).not.toHaveProperty('headerBlurEffect');
    expect(options).not.toHaveProperty('headerLargeStyle');
  });
});
