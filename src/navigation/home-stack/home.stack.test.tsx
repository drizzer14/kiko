import { isValidElement, type ReactElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the other stack tests do.
import '@kiko/design-system/unistyles';

import HomeStack from './home.stack';

type ScreenElement = ReactElement<{ name: string; options?: object }>;

// HomeStack() is called directly (a plain function call, not a real React
// render), which is enough: it uses no hook.
const optionsByScreen = (): Record<string, object | undefined> => {
  const navigator = HomeStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const screens = navigator.props.children.filter(isValidElement);

  return Object.fromEntries(screens.map((screen) => [screen.props.name, screen.props.options]));
};

describe('HomeStack', () => {
  it('hides the header on the Home root', () => {
    const navigator = HomeStack({}) as ReactElement<{ screenOptions: object }>;

    expect(navigator.props.screenOptions).toEqual({ headerShown: false });
  });

  // Jest pins `isLiquidGlassSupported` to false (jest/setup.js), the iOS < 26
  // tier, where the scrolled bar needs the blur react-native-screens omits.
  it('shows the Transaction form header with the shared large-title options', () => {
    expect(optionsByScreen().TransactionForm).toEqual({
      headerShown: true,
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterialDark',
      headerLargeStyle: { backgroundColor: 'transparent' },
    });
  });
});
