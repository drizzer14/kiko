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
