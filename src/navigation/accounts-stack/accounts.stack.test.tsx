import { isValidElement, type ReactElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the root-navigator and repo tests do.
import '@kiko/design-system/unistyles';

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
      const { en } = require('@kiko/i18n/locales');

      // The accumulator is a NESTED catalogue node, not a string, and it becomes
      // `undefined` the moment a key part is missing — so the reduce is typed over
      // `unknown` and each step narrows before indexing.
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

import AccountsStack from './accounts.stack';

type ScreenOptions = { title?: string; animation?: string };

type ScreenElement = ReactElement<{
  name: string;
  options?: ScreenOptions | ((args: { route: { params: unknown } }) => ScreenOptions);
  listeners?: (args: { navigation: { setOptions: jest.Mock }; route: { params: unknown } }) => {
    transitionEnd: () => void;
  };
}>;

const screenElements = (): ScreenElement[] => {
  const navigator = AccountsStack({}) as ReactElement<{ children: ScreenElement[] }>;

  return navigator.props.children.filter(isValidElement);
};

// A screen's options as the navigator resolves them for a route with these
// params: a static object as it is, a function called with the route.
const optionsOf = (name: string, params: unknown): ScreenOptions | undefined => {
  const options = screenElements().find((screen) => screen.props.name === name)?.props.options;

  return typeof options === 'function' ? options({ route: { params } }) : options;
};

/**
 * Walk the `Stack.Screen` children the `AccountsStack` component renders and
 * read each screen's `name` -> static `options.title`. The add-only form
 * screens carry a static header title here (their route names are camelCase,
 * so without this they would show the raw route name); the detail screens set
 * a dynamic title in-screen once their entity loads, so they intentionally
 * have no static title on the navigator.
 */
const titleByScreen = (): Record<string, string | undefined> =>
  Object.fromEntries(
    screenElements().map((screen) => [
      screen.props.name,
      optionsOf(screen.props.name, { accountId: 'account-1' })?.title,
    ]),
  );

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

  it('gives the price-point form a static "Update Value" title', () => {
    expect(titleByScreen().PricePointForm).toBe('Update Value');
  });

  it('gives the lot form a static "Add Lot" title', () => {
    expect(titleByScreen().LotForm).toBe('Add Lot');
  });

  it('gives the share-change form a static "Edit Share Change" title', () => {
    expect(titleByScreen().OwnershipChangeForm).toBe('Edit Share Change');
  });

  it('gives the account reminders page a static "Reminders" title', () => {
    expect(titleByScreen().AccountReminders).toBe('Reminders');
  });

  it('gives the reminder form the create title, which an edit replaces', () => {
    expect(titleByScreen().ReminderForm).toBe('New Reminder');
  });

  describe('the account form and the implicit holding form swap without an animation', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    it('animates a form opened from the Accounts screen as usual', () => {
      expect(optionsOf('AccountForm', {})?.animation).toBe('default');
      expect(optionsOf('AccountForm', undefined)?.animation).toBe('default');
      expect(optionsOf('AccountForm', { accountId: 'account-1' })?.animation).toBe('default');
      expect(optionsOf('HoldingForm', { accountId: 'account-1' })?.animation).toBe('default');
    });

    it('swaps in the holding form with no animation', () => {
      expect(optionsOf('HoldingForm', { implicitKind: 'property', draft })?.animation).toBe('none');
    });

    it('swaps back to the account form with no animation', () => {
      expect(optionsOf('AccountForm', { initialKind: 'bank', draft })?.animation).toBe('none');
    });

    // native-stack pops with the animation a screen carries, so the swap's
    // 'none' is undone once the form has appeared, and only for a route that
    // swapped in: any other route has nothing to undo.
    describe('the transitionEnd listener', () => {
      const transitionEndFor = (name: string, params: unknown): { setOptions: jest.Mock } => {
        const listeners = screenElements().find((screen) => screen.props.name === name)?.props
          .listeners;
        const setOptions = jest.fn();

        if (typeof listeners !== 'function') {
          throw new Error(`${name} has no listeners function`);
        }

        listeners({ navigation: { setOptions }, route: { params } }).transitionEnd();

        return { setOptions };
      };

      it.each(['AccountForm', 'HoldingForm'])(
        'sets the default animation on a %s route that carries a draft',
        (name) => {
          const { setOptions } = transitionEndFor(name, { draft });

          expect(setOptions).toHaveBeenCalledTimes(1);
          expect(setOptions).toHaveBeenCalledWith({ animation: 'default' });
        },
      );

      it.each([
        ['no params', undefined],
        ['empty params', {}],
        ['an account id', { accountId: 'account-1' }],
        ['an undefined draft', { draft: undefined }],
      ])('leaves a route with %s alone', (_label, params) => {
        expect(transitionEndFor('AccountForm', params).setOptions).not.toHaveBeenCalled();
        expect(transitionEndFor('HoldingForm', params).setOptions).not.toHaveBeenCalled();
      });
    });

    it('keeps the static titles on the swapped routes', () => {
      expect(optionsOf('AccountForm', { initialKind: 'bank', draft })?.title).toBe('Add Account');
      expect(optionsOf('HoldingForm', { implicitKind: 'debt', draft })?.title).toBe('Add Account');
      expect(optionsOf('HoldingForm', { accountId: 'account-1' })?.title).toBe('Add Holding');
    });
  });

  it('leaves the detail screens without a static title (they set it dynamically)', () => {
    const titles = titleByScreen();
    expect(titles.AccountDetail).toBeUndefined();
    expect(titles.HoldingDetail).toBeUndefined();
  });
});
