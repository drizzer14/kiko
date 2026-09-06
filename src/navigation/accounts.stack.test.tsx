import type { ReactElement } from 'react';
import { isValidElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the root-navigator and repo tests do.
import '../design-system/unistyles';

// AccountsStack() is called directly below (a plain function call, not a real
// React render — see titleByScreen), so its own useTranslation() call would
// throw ("Invalid hook call") outside a real component render. It only reads
// static-title keys (no interpolation), so a plain catalog lookup stands in
// for the real hook here without needing a render or an I18nextProvider.
// require() is lazy (inside the factory), which is what jest.mock allows an
// out-of-scope reference to do.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string) => {
      const { en } = require('../i18n/locales/en');

      return key
        .split('.')
        .reduce((node: Record<string, unknown>, part: string) => node?.[part], en);
    },
  }),
}));

import AccountsStack from './accounts.stack';

type ScreenElement = ReactElement<{ name: string; options?: { title?: string } }>;

/**
 * Walk the `Stack.Screen` children the `AccountsStack` component renders and
 * read each screen's `name` -> static `options.title`. The add-only form
 * screens carry a static header title here (their route names are camelCase,
 * so without this they would show the raw route name); the detail screens set
 * a dynamic title in-screen once their entity loads, so they intentionally
 * have no static title on the navigator.
 */
const titleByScreen = (): Record<string, string | undefined> => {
  const navigator = AccountsStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const screens = navigator.props.children.filter(isValidElement);

  return Object.fromEntries(
    screens.map((screen) => [screen.props.name, screen.props.options?.title]),
  );
};

describe('AccountsStack', () => {
  it('gives the tab-root Accounts list a static, localized title', () => {
    expect(titleByScreen().Accounts).toBe('Accounts');
  });

  it('gives the add-only form screens static Title-Case "Add …" titles', () => {
    const titles = titleByScreen();
    expect(titles.AccountForm).toBe('Add Account');
    expect(titles.HoldingForm).toBe('Add Holding');
    expect(titles.TransactionForm).toBe('Add Transaction');
    expect(titles.ContributionForm).toBe('Add Contribution');
  });

  it('leaves the detail screens without a static title (they set it dynamically)', () => {
    const titles = titleByScreen();
    expect(titles.AccountDetail).toBeUndefined();
    expect(titles.HoldingDetail).toBeUndefined();
  });
});
