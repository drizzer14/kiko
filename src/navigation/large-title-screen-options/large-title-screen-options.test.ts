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

type HeadingOptions = {
  largeTitleHeadingOptions: (title: string, scrolled: boolean) => NativeStackNavigationOptions;
  largeTitleRestoredOptions: NativeStackNavigationOptions;
};

const loadHeadingOptions = (isLiquidGlassSupported: boolean): HeadingOptions => {
  let loaded: HeadingOptions | undefined;

  jest.isolateModules(() => {
    jest.doMock('@callstack/liquid-glass', () => ({ isLiquidGlassSupported }));
    loaded = require('./large-title-screen-options');
  });

  if (loaded === undefined) {
    throw new Error('large-title-screen-options did not load');
  }

  return loaded;
};

describe('largeTitleHeadingOptions', () => {
  it('drops the large title and the bar title at rest, keeping the title itself', () => {
    const options = loadHeadingOptions(true).largeTitleHeadingOptions('A long title', false);

    expect(options).toEqual({ headerLargeTitle: false, headerTitle: '' });
    expect(options).not.toHaveProperty('title');
  });

  it('shows the whole title in the bar once the heading has scrolled under it', () => {
    expect(loadHeadingOptions(true).largeTitleHeadingOptions('A long title', true)).toEqual({
      headerLargeTitle: false,
      headerTitle: 'A long title',
    });
  });

  // The inline bar below iOS 26 would be blurred at rest; the locked fallback look keeps it
  // transparent until the content scrolls under it.
  it('keeps the bar transparent at rest and blurs it once scrolled below iOS 26', () => {
    const { largeTitleHeadingOptions } = loadHeadingOptions(false);

    expect(largeTitleHeadingOptions('A long title', false)).toEqual({
      headerLargeTitle: false,
      headerTitle: '',
      headerBlurEffect: 'none',
    });
    expect(largeTitleHeadingOptions('A long title', true)).toEqual({
      headerLargeTitle: false,
      headerTitle: 'A long title',
      headerBlurEffect: 'systemChromeMaterialDark',
    });
  });

  it('leaves the Liquid Glass bar alone on iOS 26+', () => {
    const options = loadHeadingOptions(true).largeTitleHeadingOptions('A long title', true);

    expect(options).not.toHaveProperty('headerBlurEffect');
  });
});

describe('largeTitleRestoredOptions', () => {
  it('brings the native large title back, with the bar title following the title again', () => {
    expect(loadHeadingOptions(true).largeTitleRestoredOptions).toEqual({
      headerLargeTitle: true,
      headerTitle: undefined,
    });
  });

  it('brings back the scrolled-bar blur below iOS 26', () => {
    expect(loadHeadingOptions(false).largeTitleRestoredOptions).toEqual({
      headerLargeTitle: true,
      headerTitle: undefined,
      headerBlurEffect: 'systemChromeMaterialDark',
    });
  });
});
