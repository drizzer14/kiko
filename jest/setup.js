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
