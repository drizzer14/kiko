// Manual mock for `react-native-bottom-tabs`, picked up by Jest automatically
// for every test (no `jest.mock('react-native-bottom-tabs')` call needed — see
// https://jestjs.io/docs/manual-mocks#mocking-node-modules).
//
// The real package is the NitroModules-backed native tab-view runtime behind
// `@bottom-tabs/react-navigation`. Two problems make it unusable under Jest:
// it ships raw ESM that Jest's transform can't parse ("Cannot use import
// statement outside a module"), and its hooks read from a native tab bar that
// does not exist under react-test-renderer. Any screen that reads the floating
// tab-bar height (the Accounts screen, to lift its footer clear of the bar) is
// reachable transitively from App.tsx / root.navigator tests, so this is
// mocked globally rather than per-test-file.
//
// `useBottomTabBarHeight` returns 0 here — a screen rendered outside a real
// native tab scene has no bar to clear. A test that needs a specific height
// (e.g. the Accounts footer-clearance test) overrides this with its own
// `jest.mock('react-native-bottom-tabs', ...)` factory.
export const useBottomTabBarHeight = (): number => 0;
