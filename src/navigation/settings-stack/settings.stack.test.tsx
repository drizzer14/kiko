import { isValidElement, type ReactElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the root-navigator and accounts-stack tests do.
import '@kiko/design-system/unistyles';

// SettingsStack() is called directly below (a plain function call, not a real
// React render — see titleByScreen), so its own useTranslation() call would
// throw ("Invalid hook call") outside a real component render. It only reads
// static-title keys (no interpolation), so a plain catalog lookup stands in
// for the real hook here without needing a render or an I18nextProvider.
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

import SettingsStack from './settings.stack';

type ScreenOptions = {
  title?: string;
  animation?: string;
  headerShown?: boolean;
  headerLargeTitle?: boolean;
  headerBlurEffect?: string;
  headerLargeStyle?: object;
};

// Jest pins `isLiquidGlassSupported` to false (jest/setup.js), the iOS < 26 tier.
const sharedLargeTitleOptions = {
  headerLargeTitle: true,
  headerBlurEffect: 'systemChromeMaterialDark',
  headerLargeStyle: { backgroundColor: 'transparent' },
};

type ScreenElement = ReactElement<{
  name: string;
  options?: ScreenOptions | ((args: { route: { params: unknown } }) => ScreenOptions);
}>;

const screenElements = (): ScreenElement[] => {
  const navigator = SettingsStack({}) as ReactElement<{ children: ScreenElement[] }>;

  return navigator.props.children.filter(isValidElement);
};

// A screen's options as the navigator resolves them for a route with these params.
const optionsOf = (name: string, params?: unknown): ScreenOptions | undefined => {
  const options = screenElements().find((screen) => screen.props.name === name)?.props.options;

  return typeof options === 'function' ? options({ route: { params } }) : options;
};

// Walk the Stack.Screen children SettingsStack renders and read each screen's
// name -> static options.title, so a test can assert both screens carry a
// real, localized title rather than falling back to a raw route name. A
// screen whose title depends on its params (HelpTopic) is read in its own test.
const titleByScreen = (): Record<string, string | undefined> =>
  Object.fromEntries(
    screenElements().map(({ props: { name, options } }) => [
      name,
      typeof options === 'function' ? undefined : options?.title,
    ]),
  );

describe('SettingsStack', () => {
  it('gives the Settings, System, and Categories screens a static, localized title', () => {
    const titles = titleByScreen();
    expect(titles.Settings).toBe('Settings');
    expect(titles.System).toBe('System');
    expect(titles.Categories).toBe('Categories');
    expect(titles.ExportData).toBe('Export Data');
    expect(titles.ImportData).toBe('Import Data');
  });

  it('registers the reminders list and the reminder form it opens', () => {
    const titles = titleByScreen();
    expect(titles.Reminders).toBe('Reminders');
    expect(titles.ReminderForm).toBe('New Reminder');
  });

  it('registers the templates list with its title', () => {
    expect(titleByScreen().TransactionTemplates).toBe('Transaction Templates');
  });

  // The list opens the Transaction form, and an empty picker's "Add holding" row opens the
  // account and holding forms, so all three live in this stack, with Home's options.
  it('registers the Transaction, Account and Holding forms the way the Home stack does', () => {
    const names = screenElements().map((screen) => screen.props.name);

    expect(names).toEqual(
      expect.arrayContaining(['TransactionForm', 'AccountForm', 'HoldingForm']),
    );
    expect(optionsOf('TransactionForm')).toEqual({
      headerShown: true,
      ...sharedLargeTitleOptions,
    });
    expect(optionsOf('AccountForm', { accountId: 'account-1' })).toEqual({
      title: 'Add Account',
      animation: 'default',
      headerShown: true,
      ...sharedLargeTitleOptions,
    });
    expect(optionsOf('HoldingForm', { accountId: 'account-1' })).toEqual({
      title: 'Add Holding',
      animation: 'default',
      headerShown: true,
      ...sharedLargeTitleOptions,
    });
  });

  it('swaps the implicit holding form without an animation, as Home does', () => {
    const draft = { name: 'Flat', icon: null, color: null };

    expect(optionsOf('HoldingForm', { implicitKind: 'property', draft })).toMatchObject({
      title: 'Add Account',
      animation: 'none',
    });
  });

  // Jest pins `isLiquidGlassSupported` to false (jest/setup.js), the iOS < 26
  // tier, where the scrolled bar needs the blur react-native-screens omits.
  it('uses the shared large-title options, with the scrolled-bar blur below iOS 26', () => {
    const navigator = SettingsStack({}) as ReactElement<{ screenOptions: object }>;

    expect(navigator.props.screenOptions).toEqual({
      headerLargeTitle: true,
      headerBlurEffect: 'systemChromeMaterialDark',
      headerLargeStyle: { backgroundColor: 'transparent' },
    });
  });

  // The Help pages inherit the stack's header options, so their own options
  // may carry only a title or they would override the shared blur.
  it('leaves the header options of the Help pages to the stack', () => {
    expect(Object.keys(optionsOf('Help') ?? {})).toEqual(['title']);
    expect(Object.keys(optionsOf('HelpTopic', { topicId: 'addAccount' }) ?? {})).toEqual(['title']);
  });

  it('registers the Help page with its title', () => {
    expect(titleByScreen().Help).toBe('Help');
  });

  it('titles each Help topic page with its own topic title', () => {
    expect(optionsOf('HelpTopic', { topicId: 'addAccount' })?.title).toBe('Add an Account');
    expect(optionsOf('HelpTopic', { topicId: 'manageCategories' })?.title).toBe(
      'Manage Categories',
    );
  });
});
