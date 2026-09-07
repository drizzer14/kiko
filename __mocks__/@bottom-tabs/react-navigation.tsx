// Manual mock for `@bottom-tabs/react-navigation`, picked up by Jest
// automatically for every test (no `jest.mock('@bottom-tabs/react-navigation')`
// call needed — see https://jestjs.io/docs/manual-mocks#mocking-node-modules).
//
// The real package renders a native tab-bar view backed by a NitroModules
// binary that does not exist under Jest, and its own transitive `color`
// dependency ships raw ESM that Jest's transform can't parse either
// ("Cannot use import statement outside a module" from
// `node_modules/@bottom-tabs/react-navigation/node_modules/color/index.js`).
// This stands in a plain React Navigation-shaped `{ Navigator, Screen }`
// pair: `Navigator` renders each `Screen`'s `options.title` as findable
// text, scoped inside a `tab-bar` testID container (the real native tab bar
// renders its labels in a view outside the JS tree, so nothing in the
// mounted screen can collide with a tab label — a mounted screen may well
// contain its own text that happens to match a tab title, e.g. the Home
// screen's "Accounts" section heading), and mounts the initial (first)
// screen's `component` — enough to exercise "does the tab navigator wire
// the right tabs to the right stacks" without a native tab-bar renderer.

import {
  Children,
  type ComponentType,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Text, View, type ViewProps } from 'react-native';

type MockScreenProps = {
  name: string;
  component: React.ComponentType;
  options?: { title?: string };
};

// Native tab-bar appearance props the real navigator forwards to the
// UITabBar. Surfaced here on the `tab-bar` view so tests can assert the app
// pins them (e.g. `tabBarStyle.backgroundColor` to keep the bar's scheme
// deterministic, `tabBarActiveTintColor`/`tabBarInactiveTintColor` to keep the
// tints theme-reactive — Task 6). None of these are real `ViewProps`
// members, so the host element below is cast through `TabBarView` rather
// than typed as plain `View`.
type MockTabBarProps = {
  tabBarStyle?: { backgroundColor?: string };
  translucent?: boolean;
  tabBarActiveTintColor?: string;
  tabBarInactiveTintColor?: string;
};

// `View`'s own type has no room for `MockTabBarProps` — they are native
// tab-bar appearance props, not real `ViewProps` members. This mock only
// needs the `tab-bar` host element to carry them so a test can read them
// back off `.props`; the cast below is that boundary, scoped to this mock
// only, not a widening of the app's own component surface.
const TabBarView = View as ComponentType<ViewProps & MockTabBarProps>;

type MockNavigatorProps = MockTabBarProps & {
  children: ReactNode;
  // Forward ONLY the props the real @bottom-tabs/react-navigation adapter
  // consumes. `barTintColor` is NOT one of them: it is not a
  // NativeBottomTabNavigatorProps member, so the real adapter drops it into
  // `...rest` and react-native-bottom-tabs' TabView then OVERWRITES it with
  // `tabBarStyle?.backgroundColor` (TabView.tsx:477). A mock that accepted and
  // painted `barTintColor` made root.navigator.test.tsx green while the device
  // tab bar still flipped light/dark (bug B1). Keep this mock's prop surface
  // narrower than the app's, never wider. `tabBarActiveTintColor` /
  // `tabBarInactiveTintColor` ARE real NativeBottomTabNavigatorProps members
  // (unlike `barTintColor`), so this mock forwards them onto the `tab-bar`
  // view below for tests to assert on (Task 6: theme-reactive tab bar).
};

function Screen(_props: MockScreenProps): null {
  return null;
}

function Navigator({
  children,
  tabBarStyle,
  translucent,
  tabBarActiveTintColor,
  tabBarInactiveTintColor,
}: MockNavigatorProps) {
  const screens = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<MockScreenProps>[];
  const active = screens[0];
  const ActiveComponent = active?.props.component;
  return (
    <>
      <TabBarView
        testID="tab-bar"
        tabBarStyle={tabBarStyle}
        translucent={translucent}
        tabBarActiveTintColor={tabBarActiveTintColor}
        tabBarInactiveTintColor={tabBarInactiveTintColor}
      >
        {screens.map((screen) => (
          <Text key={screen.props.name}>{screen.props.options?.title ?? screen.props.name}</Text>
        ))}
      </TabBarView>
      {ActiveComponent ? <ActiveComponent /> : null}
    </>
  );
}

export const createNativeBottomTabNavigator = () => ({ Navigator, Screen });
