// Semgrep fixture (POSITIVE, NESTED): kiko-no-inline-text-variant-mock carries a path-prefixed
// `paths.include` entry (`src/test-support/**`), which draws NOTHING against a fixture placed
// directly in rules/fixtures/ (kiko-linter's "Semgrep facts" gotcha), so this fixture mirrors a
// real src/test-support/ path instead. The rule MUST report a finding on each pinned line: a
// mock of the design-system `Text` whose own factory forwards `variant`, whether the factory has
// a block body or an expression body, and whether the module is named by alias or relatively.
export {};

// EXPECT-FINDING
jest.mock('@kiko/design-system/components/text', () => {
  const React = require('react');
  const { Text: RNText } = require('react-native');

  const MockText = ({
    children,
    tone,
    variant,
  }: {
    children: unknown;
    tone?: string;
    variant?: string;
  }) => React.createElement(RNText, { tone, variant }, children);

  return { __esModule: true, default: MockText };
});

// EXPECT-FINDING
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: ({ children, variant }: { children: unknown; variant?: string }) =>
    require('react').createElement(require('react-native').Text, { variant }, children),
}));

// EXPECT-FINDING
jest.mock('../text', () => ({
  __esModule: true,
  default: ({ variant }: { variant?: string }) => variant,
}));
