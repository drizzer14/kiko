import type { ReactElement } from 'react';
import { isValidElement } from 'react';

// The real Statistics screen wired into this stack pulls in db/client, which
// opens a real op-sqlite connection at module load. op-sqlite has no Jest
// binary, so stub it the same way the root-navigator and repo tests do.
import '../design-system/unistyles';

// StatisticsStack() is called directly below (a plain function call, not a
// real React render — see screenNames), so its own useTranslation() call
// would throw ("Invalid hook call") outside a real component render. This
// test only reads route `name`s, not the translated title, so a no-op stub
// (returning the raw key) is enough to unblock the call.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import StatisticsStack from './statistics.stack';

type ScreenElement = ReactElement<{ name: string }>;

// Walk the Stack.Screen children the StatisticsStack renders and read each
// screen's route name, so a test can assert the stack is rooted at Statistics.
const screenNames = (): string[] => {
  const navigator = StatisticsStack({}) as ReactElement<{ children: ScreenElement[] }>;
  const screens = [navigator.props.children].flat().filter(isValidElement) as ScreenElement[];

  return screens.map((screen) => screen.props.name);
};

describe('StatisticsStack', () => {
  it('is rooted at the Statistics screen', () => {
    expect(screenNames()).toContain('Statistics');
  });
});
