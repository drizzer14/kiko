// Semgrep fixture (NEGATIVE, NESTED): kiko-no-inline-text-variant-mock MUST report nothing here.
// A factory that returns a ready-made component through a getter is the sanctioned shape (the
// real tests return the `mock-text-variant-tone` helper; this file holds a local stand-in, since
// the guard denies an alias import into its own feature at a src/test-support probe path). A
// tone-only factory (a `testID` built from `tone`) is another shape. A mock of another module
// that forwards a `variant` prop is not a mock of `Text`. A factory that only names the helper
// `mock-text-variant-tone` holds the word `variant` inside a hyphenated name, which is not the
// prop (it pins the rule's lookarounds around the word).
export {};

const mockTextVariantTone = require('react-native').Text;

jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: ({ tone }: { tone?: string }) =>
    require('react').createElement(require('react-native').Text, { testID: `text-tone-${tone}` }),
}));

jest.mock('@kiko/design-system/components/text', () => {
  // The shared helper is src/test-support/mock-text-variant-tone.tsx.
  return { __esModule: true, default: require('react-native').Text };
});

jest.mock('@kiko/design-system/components/button', () => ({
  __esModule: true,
  default: ({ variant }: { variant?: string }) => variant,
}));
