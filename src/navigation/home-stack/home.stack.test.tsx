import { isValidElement, type ReactElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load, so stub it the way accounts.stack.test
// does. HomeStack() is called directly below (a plain function call, not a
// render), so its own useTranslation() call is replaced by a plain catalogue
// lookup. require() is lazy (inside the factory), which jest.mock allows.
import '@kiko/design-system/unistyles';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string) => {
      const { en } = require('@kiko/i18n/locales');

      return key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            typeof node === 'object' && node !== null
              ? (node as Record<string, unknown>)[part]
              : undefined,
          en,
        );
    },
  }),
}));

import { fittingLargeTitleLayout } from '../fitting-large-title';

import HomeStack from './home.stack';

type ScreenOptions = {
  title?: string;
  animation?: string;
  headerShown?: boolean;
  headerLargeTitle?: boolean;
  headerBlurEffect?: string;
  headerLargeStyle?: object;
};

type ScreenElement = ReactElement<{
  name: string;
  options?: ScreenOptions | ((args: { route: { params: unknown } }) => ScreenOptions);
}>;

const optionsOf = (name: string, params: unknown): ScreenOptions | undefined => {
  const navigator = HomeStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const options = navigator.props.children
    .filter(isValidElement)
    .find((screen) => screen.props.name === name)?.props.options;

  return typeof options === 'function' ? options({ route: { params } }) : options;
};

// Jest pins `isLiquidGlassSupported` to false (jest/setup.js), the iOS < 26
// tier, where the scrolled bar needs the blur react-native-screens omits.
const sharedLargeTitleOptions = {
  headerLargeTitle: true,
  headerBlurEffect: 'systemChromeMaterialDark',
  headerLargeStyle: { backgroundColor: 'transparent' },
};

describe('HomeStack', () => {
  it('hides the header on the Home root', () => {
    const navigator = HomeStack({}) as ReactElement<{ screenOptions: object }>;

    expect(navigator.props.screenOptions).toEqual({ headerShown: false });
  });

  it('wraps every screen in the fitting large-title layout', () => {
    const navigator = HomeStack({}) as ReactElement<{ screenLayout: unknown }>;

    expect(navigator.props.screenLayout).toBe(fittingLargeTitleLayout);
  });

  it('shows the Transaction form header with the shared large-title options', () => {
    expect(optionsOf('TransactionForm', undefined)).toEqual({
      headerShown: true,
      ...sharedLargeTitleOptions,
    });
  });

  it('shows the Statistics header with the shared large-title options and the translated title', () => {
    expect(optionsOf('Statistics', undefined)).toEqual({
      headerShown: true,
      ...sharedLargeTitleOptions,
      title: 'Statistics',
    });
  });

  it('leaves the Home root without options of its own', () => {
    expect(optionsOf('Home', undefined)).toBeUndefined();
  });

  it.each([
    ['AccountForm', 'Add Account'],
    ['HoldingForm', 'Add Holding'],
  ])(
    'gives %s its Title-Case title and a visible header with the shared large-title options',
    (name, title) => {
      expect(optionsOf(name, { accountId: 'account-1' })).toEqual({
        title,
        animation: 'default',
        headerShown: true,
        ...sharedLargeTitleOptions,
      });
    },
  );

  it('keeps the default animation on a form that holds its own saved draft', () => {
    const savedDraft = { saved: true, name: 'Flat', icon: null, color: null };

    expect(optionsOf('AccountForm', { draft: savedDraft })?.animation).toBe('default');
    expect(optionsOf('HoldingForm', { accountId: 'account-1', draft: savedDraft })?.animation).toBe(
      'default',
    );
    expect(
      optionsOf('HoldingForm', { implicitKind: 'property', draft: savedDraft })?.animation,
    ).toBe('default');
  });

  it('titles the implicit holding form like an account and swaps without an animation', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    expect(optionsOf('HoldingForm', { implicitKind: 'property', draft })).toMatchObject({
      title: 'Add Account',
      animation: 'none',
    });
  });
});
