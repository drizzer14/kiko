import { largeTitleHeadingOptions, largeTitleRestoredOptions } from './large-title-screen-options';

// The heading look changes only what the large title is: it is the large-title look with the
// title moved into the content. The bar stays translucent, so the content lays out under it
// exactly as under a large-title bar (react-native-screens only does that for a translucent bar),
// and the blur options of `largeTitleScreenOptions` stay in force, so neither iOS tier gets a
// different bar.
describe('largeTitleHeadingOptions', () => {
  it('drops the large title and the bar title at rest, keeping the title itself', () => {
    const options = largeTitleHeadingOptions('A long title', false);

    expect(options).toEqual({
      headerLargeTitle: false,
      headerTransparent: true,
      headerShadowVisible: true,
      headerTitle: '',
    });
    expect(options).not.toHaveProperty('title');
  });

  it('shows the whole title in the bar once the heading has scrolled under it', () => {
    expect(largeTitleHeadingOptions('A long title', true)).toEqual({
      headerLargeTitle: false,
      headerTransparent: true,
      headerShadowVisible: true,
      headerTitle: 'A long title',
    });
  });

  it('keeps the bar translucent and leaves the bar blur to the stack options', () => {
    const options = largeTitleHeadingOptions('A long title', true);

    expect(options.headerTransparent).toBe(true);
    expect(options).not.toHaveProperty('headerBlurEffect');
    expect(options).not.toHaveProperty('headerLargeStyle');
  });
});

describe('largeTitleRestoredOptions', () => {
  it('brings the native large title back, with the bar title following the title again', () => {
    expect(largeTitleRestoredOptions).toEqual({
      headerLargeTitle: true,
      headerTransparent: undefined,
      headerShadowVisible: undefined,
      headerTitle: undefined,
    });
  });

  it('undoes every key the heading look sets', () => {
    const restored = largeTitleRestoredOptions as Record<string, unknown>;

    for (const key of Object.keys(largeTitleHeadingOptions('A long title', true))) {
      expect(restored).toHaveProperty(key);
    }
  });
});
