import type { ReactElement } from 'react';
import { isValidElement } from 'react';

// The real screens wired into this stack pull in db/client, which opens a real
// op-sqlite connection at module load. op-sqlite has no Jest binary, so stub it
// the same way the root-navigator and repo tests do.
jest.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({ execute: () => ({ rows: [] }) }),
}));

import '../design-system/unistyles';
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
    screens.map(screen => [screen.props.name, screen.props.options?.title]),
  );
};

describe('AccountsStack', () => {
  it('gives the add-only form screens static Title-Case "Add …" titles', () => {
    const titles = titleByScreen();
    expect(titles.AccountForm).toBe('Add Account');
    expect(titles.HoldingForm).toBe('Add Holding');
    expect(titles.TransactionForm).toBe('Add Transaction');
  });

  it('leaves the detail screens without a static title (they set it dynamically)', () => {
    const titles = titleByScreen();
    expect(titles.AccountDetail).toBeUndefined();
    expect(titles.HoldingDetail).toBeUndefined();
  });
});
