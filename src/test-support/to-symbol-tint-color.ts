type SymbolColorModule = { toSFSymbolTintColor: (color: string) => string };

// `symbol.color` is not on the symbol barrel (a barrel must not carry a test-only helper), and a
// test-support helper has no barrel to go through either: `jest.requireActual` keeps the resolved
// file, so a test can still expect the exact tint a SymbolIcon hands to the native view.
const actual: SymbolColorModule = jest.requireActual(
  '@kiko/design-system/components/symbol/symbol.color',
);

export const toSymbolTintColor = actual.toSFSymbolTintColor;
