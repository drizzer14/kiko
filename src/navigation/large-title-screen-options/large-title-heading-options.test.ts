import {
  inRowTitleOptions,
  largeTitleHeadingOptions,
  largeTitleRestoredOptions,
} from './large-title-screen-options';

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

  // Strict, so a blur key set to `undefined` fails too: merged over the stack options it would
  // clear the blur they carry.
  it('shows the whole title in the bar once the heading has scrolled under it', () => {
    expect(largeTitleHeadingOptions('A long title', true)).toStrictEqual({
      headerLargeTitle: false,
      headerTransparent: true,
      headerShadowVisible: true,
      headerTitle: 'A long title',
    });
  });
});

// The in-row look is the same translucent bar with the title left empty at rest AND after a
// scroll: the heading scrolls out and nothing takes its place in the bar.
describe('inRowTitleOptions', () => {
  it('is the translucent one-row bar with no title, strictly', () => {
    expect(inRowTitleOptions()).toStrictEqual({
      headerLargeTitle: false,
      headerTransparent: true,
      headerShadowVisible: true,
      headerTitle: '',
    });
  });

  it('is undone by the restore, key for key', () => {
    const restored = largeTitleRestoredOptions({}) as Record<string, unknown>;

    for (const key of Object.keys(inRowTitleOptions())) {
      expect(restored).toHaveProperty(key);
    }
  });
});

describe('largeTitleRestoredOptions', () => {
  it('brings the native large title back, with the bar title following the title again', () => {
    expect(largeTitleRestoredOptions({})).toEqual({
      headerLargeTitle: true,
      headerTransparent: undefined,
      headerShadowVisible: undefined,
      headerTitle: undefined,
    });
  });

  it("brings back the screen's own value of every key the heading look overrides", () => {
    expect(
      largeTitleRestoredOptions({
        headerTransparent: false,
        headerShadowVisible: false,
        headerTitle: 'Own bar title',
      }),
    ).toEqual({
      headerLargeTitle: true,
      headerTransparent: false,
      headerShadowVisible: false,
      headerTitle: 'Own bar title',
    });
  });

  it('undoes every key the heading look sets', () => {
    const restored = largeTitleRestoredOptions({}) as Record<string, unknown>;

    for (const key of Object.keys(largeTitleHeadingOptions('A long title', true))) {
      expect(restored).toHaveProperty(key);
    }
  });
});
