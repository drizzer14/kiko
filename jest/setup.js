// Jest setup: mock react-native-safe-area-context so SafeAreaProvider
// renders children synchronously in tests instead of waiting for a
// native onLayout event that never arrives under react-test-renderer.
// The package's own mock module is transpiled ESM (default export
// only), so unwrap `.default` to get the plain object of named
// exports (SafeAreaProvider, useSafeAreaInsets, ...) that Babel's CJS
// interop expects when App.tsx does `import { SafeAreaProvider } ...`.
jest.mock('react-native-safe-area-context', () => {
  const mock = require('react-native-safe-area-context/jest/mock');
  return mock.default ?? mock;
});

// react-native-unistyles ships an official Jest mock (self-registering via
// jest.mock calls run as a side effect of requiring it) that stubs out its
// native NitroModules-backed runtime, so components using
// `StyleSheet.create`/`useUnistyles` can render under react-test-renderer
// without a native binary. Required here, in setupFiles, so it registers
// before any test file's own `react-native-unistyles` import runs.
require('react-native-unistyles/mocks');

// @react-native-clipboard/clipboard ships an official Jest mock that stubs
// its TurboModule-backed native binding (there is no native binary under
// react-test-renderer, so an unmocked import throws
// `TurboModuleRegistry.getEnforcing(...): 'RNCClipboard' could not be
// found`). Registered globally, not per-test-file, because any screen that
// imports it (e.g. settings) is reachable transitively from App.tsx /
// root.navigator tests that never mock it themselves.
jest.mock('@react-native-clipboard/clipboard', () =>
  require('@react-native-clipboard/clipboard/jest/clipboard-mock'),
);

// @callstack/liquid-glass and react-native-nitro-sfsymbols are both
// Nitro/native-binding packages with no software fallback — an unmocked
// import throws under react-test-renderer, the same class of failure as the
// clipboard mock above. Design-system components (GlassSurface, Symbol) hide
// behind these two modules, so any test that renders one transitively needs
// this mocked globally, not per-test-file. Kept minimal: just enough surface
// (a plain View, plus isLiquidGlassSupported as a static false) for
// GlassSurface's fallback branch and Symbol to render without crashing.
jest.mock('@callstack/liquid-glass', () => {
  const { View } = require('react-native');
  return {
    LiquidGlassView: View,
    isLiquidGlassSupported: false,
  };
});

jest.mock('react-native-nitro-sfsymbols', () => {
  const { View } = require('react-native');
  return { SFSymbolView: View };
});
