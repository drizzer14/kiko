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

// react-native-calendars' Calendar is a pure-JS component, but it pulls in
// XDate/recyclerlistview machinery that is noisy under react-test-renderer and
// gives a test no direct handle on day selection. Mocked to a plain View that
// preserves `testID`, `markedDates`, `markingType`, and `onDayPress` as props,
// so the Home date-range sheet mounts and a test can drive a day tap by calling
// `onDayPress` with a DateData object directly.
jest.mock('react-native-calendars', () => {
  const { View } = require('react-native');
  return { Calendar: View };
});

// react-native's Modal returns null under react-test-renderer (there is no
// native modal host to portal into), so its children — the Home date-range
// modal's calendars and Apply/Clear actions — never enter the tree for a test
// to query. Mocked to a View that mirrors real Modal visibility: it renders
// its children inline only while `visible` is truthy, and renders null
// otherwise. This lets an open modal's contents be queried, while a closed
// modal (e.g. the settings icon-picker) renders nothing, matching native
// behavior — a bare passthrough View would leak a closed modal's children.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Modal = ({ visible, children, ...rest }) =>
    visible ? React.createElement(View, rest, children) : null;
  return { __esModule: true, default: Modal };
});

// react-native-reanimated ships an official Jest mock that replaces its
// worklet/native-driven animation runtime with synchronous JS stubs, so any
// component that imports it (react-native-sortables, GestureHandlerRootView's
// tree) renders under react-test-renderer without the native worklets binary.
// Registered globally because the accounts / holdings grids reach it
// transitively from App.tsx / navigator tests.
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// react-native-gesture-handler's jestSetup self-registers mocks for its native
// gesture recognizers (it calls jest.mock internally as a side effect of being
// required), so GestureHandlerRootView and the sortables drag gestures mount
// without the native binding.
require('react-native-gesture-handler/jestSetup');

// react-native-sortables' Grid is JS-only but its drag machinery leans on
// reanimated shared values and gesture-handler internals that stay noisy under
// react-test-renderer and give a test no direct handle on reordering. Mocked so
// `Sortable.Grid` renders each datum through `renderItem` in `data` order (its
// keys via `keyExtractor`) inside a host View that surfaces `onDragEnd` as a
// prop, letting a test read the rendered order and drive a reorder by calling
// `onDragEnd` with a params object directly. The other exports resolve to inert
// passthroughs so an import never crashes.
jest.mock('react-native-sortables', () => {
  const React = require('react');
  const { View } = require('react-native');

  const Grid = ({ data, renderItem, keyExtractor, onDragEnd }) =>
    React.createElement(
      View,
      { testID: 'sortable-grid', onDragEnd },
      (data ?? []).map((item, index) =>
        React.createElement(
          React.Fragment,
          { key: keyExtractor ? keyExtractor(item) : index },
          renderItem({ item, index }),
        ),
      ),
    );

  const Passthrough = ({ children }) => children ?? null;

  return {
    __esModule: true,
    default: { Grid, Flex: Passthrough, Layer: Passthrough, Handle: Passthrough },
  };
});
