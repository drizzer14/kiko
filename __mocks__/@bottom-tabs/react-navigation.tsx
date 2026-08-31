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
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Text, View } from 'react-native';

type MockScreenProps = {
  name: string;
  component: React.ComponentType;
  options?: { title?: string };
};

function Screen(_props: MockScreenProps): null {
  return null;
}

function Navigator({
  children,
  initialRouteName,
}: {
  children: ReactNode;
  initialRouteName?: string;
}) {
  const screens = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<MockScreenProps>[];
  const activeIndex = initialRouteName
    ? screens.findIndex(screen => screen.props.name === initialRouteName)
    : 0;
  const active = screens[activeIndex] ?? screens[0];
  const ActiveComponent = active?.props.component;
  return (
    <>
      <View testID="tab-bar">
        {screens.map(screen => (
          <Text key={screen.props.name}>{screen.props.options?.title ?? screen.props.name}</Text>
        ))}
      </View>
      {ActiveComponent ? <ActiveComponent /> : null}
    </>
  );
}

export const createNativeBottomTabNavigator = () => ({ Navigator, Screen });
