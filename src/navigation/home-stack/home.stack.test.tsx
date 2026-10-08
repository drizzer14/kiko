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

import HomeStack from './home.stack';

type ScreenOptions = {
  title?: string;
  animation?: string;
  headerShown?: boolean;
  headerLargeTitle?: boolean;
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

describe('HomeStack', () => {
  it('registers the account and holding create forms the transaction form opens', () => {
    const navigator = HomeStack({}) as ReactElement<{ children: ScreenElement[] }>;
    const names = navigator.props.children
      .filter(isValidElement)
      .map((screen) => screen.props.name);

    expect(names).toEqual(['Home', 'TransactionForm', 'AccountForm', 'HoldingForm']);
  });

  it.each([
    ['AccountForm', 'Add Account'],
    ['HoldingForm', 'Add Holding'],
  ])('gives %s its Title-Case title and a visible large-title header', (name, title) => {
    expect(optionsOf(name, { accountId: 'account-1' })).toEqual({
      title,
      animation: 'default',
      headerShown: true,
      headerLargeTitle: true,
    });
  });

  it('titles the implicit holding form like an account and swaps without an animation', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    expect(optionsOf('HoldingForm', { implicitKind: 'property', draft })).toMatchObject({
      title: 'Add Account',
      animation: 'none',
    });
  });
});
