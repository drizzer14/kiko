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

type ScreenOptions = { title?: string };

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
