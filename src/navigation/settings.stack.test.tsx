import type { ReactElement } from 'react';
import { isValidElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the root-navigator and accounts-stack tests do.
import '../design-system/unistyles';

// SettingsStack() is called directly below (a plain function call, not a real
// React render — see titleByScreen), so its own useTranslation() call would
// throw ("Invalid hook call") outside a real component render. It only reads
// static-title keys (no interpolation), so a plain catalog lookup stands in
// for the real hook here without needing a render or an I18nextProvider.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string) => {
      const { en } = require('../i18n/locales/en');

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

type ScreenElement = ReactElement<{ name: string; options?: { title?: string } }>;

// Walk the Stack.Screen children SettingsStack renders and read each screen's
// name -> static options.title, so a test can assert both screens carry a
// real, localized title rather than falling back to a raw route name.
const titleByScreen = (): Record<string, string | undefined> => {
  const navigator = SettingsStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const screens = navigator.props.children.filter(isValidElement);

  return Object.fromEntries(
    screens.map((screen) => [screen.props.name, screen.props.options?.title]),
  );
};

describe('SettingsStack', () => {
  it('gives the Settings and Categories screens a static, localized title', () => {
    const titles = titleByScreen();
    expect(titles.Settings).toBe('Settings');
    expect(titles.Categories).toBe('Categories');
  });
});
