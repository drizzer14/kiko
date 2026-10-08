// `openAccountForm` on the REAL React Navigation routers: a spy cannot show
// which screens end up on the Accounts stack when the tab was never visited,
// or was left with a page open.
import {
  accountsStack,
  focusedTab,
  onStack,
  renderRealTabs,
} from '@kiko/test-support/real-tab-navigator';
import { act } from '@testing-library/react-native';
import type { TabParamList } from '@kiko/navigation/types';
import type { NavigationProp } from '@react-navigation/native';
import { navigationRef } from '@kiko/navigation/navigation-ref';

import '@kiko/design-system/unistyles';

import { openAccountForm } from '.';

const renderApp = () => renderRealTabs(['Accounts', 'AccountDetail', 'AccountForm']);

// A screen holds the tab navigator's prop; the container ref is the same
// router's object, typed with a looser `routeNames`.
const tabNavigation = navigationRef as unknown as NavigationProp<TabParamList>;

const open = async (): Promise<void> => {
  await act(async () => {
    openAccountForm(tabNavigation);
  });
};

const openAccount = async (accountId: string, name: string): Promise<void> => {
  await act(async () => {
    navigationRef.navigate('AccountsTab', {
      screen: 'AccountDetail',
      params: { accountId, name },
      initial: false,
    });
  });
};

const goHome = async (): Promise<void> => {
  await act(async () => {
    navigationRef.navigate('HomeTab');
  });
};

const goBack = async (): Promise<void> => {
  await act(async () => {
    navigationRef.goBack();
  });
};

describe('openAccountForm (real router)', () => {
  it('opens the form above the Accounts root when the Accounts tab was never visited', async () => {
    await renderApp();
    expect(accountsStack()).toEqual([]);

    await open();

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([onStack('Accounts'), onStack('AccountForm', {})]);

    await goBack();

    expect(accountsStack()).toEqual([onStack('Accounts')]);
  });

  // The callers (Home, Statistics, Settings) are on another tab. Leaving the
  // Accounts tab pops its stack to the root (`resetTabStackOnBlur`), so the
  // page the user had open is gone and the form lands on the root.
  it('opens the form above the Accounts root from another tab, after the tab was left on a page', async () => {
    await renderApp();
    await openAccount('bank', 'Mono');
    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
    ]);
    await goHome();
    expect(focusedTab()).toBe('HomeTab');

    await open();

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([onStack('Accounts'), onStack('AccountForm', {})]);

    await goBack();

    expect(accountsStack()).toEqual([onStack('Accounts')]);
  });

  it('keeps the page the Accounts tab shows and puts the form above it, when called from that tab', async () => {
    await renderApp();
    await openAccount('bank', 'Mono');

    await open();

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
      onStack('AccountForm', {}),
    ]);

    await goBack();

    expect(accountsStack()).toEqual([
      onStack('Accounts'),
      onStack('AccountDetail', { accountId: 'bank', name: 'Mono' }),
    ]);
  });

  it('navigates once, naming the form screen', async () => {
    await renderApp();
    const navigate = jest.spyOn(navigationRef, 'navigate');

    await open();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('AccountsTab', {
      screen: 'AccountForm',
      params: {},
      initial: false,
    });
    navigate.mockRestore();
  });
});
