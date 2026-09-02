import type { ReactElement } from 'react';
import { isValidElement } from 'react';

// The real Statistics screen wired into this stack pulls in db/client, which
// opens a real op-sqlite connection at module load. op-sqlite has no Jest
// binary, so stub it the same way the root-navigator and repo tests do.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import '../design-system/unistyles';
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
