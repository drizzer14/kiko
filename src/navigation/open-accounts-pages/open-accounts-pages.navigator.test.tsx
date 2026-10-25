// `openAccountsPages` on the REAL React Navigation routers: a spy cannot show which screens end up
// on the Accounts stack, nor where Back lands from the page it opened.
import {
  accountsStack,
  focusedTab,
  onStack,
  renderRealTabs,
} from '@kiko/test-support/real-tab-navigator';
import { act } from '@testing-library/react-native';
import { CommonActions } from '@react-navigation/native';
import { navigationRef } from '@kiko/navigation/navigation-ref';

import '@kiko/design-system/unistyles';

import { openAccountsPages } from '.';

const renderApp = () => renderRealTabs(['Accounts', 'AccountDetail', 'HoldingDetail']);

const CASH = { accountId: 'cash', name: 'Cash', kind: 'cash' as const };
const MONO = { accountId: 'bank', name: 'Mono', kind: 'bank' as const };
const WALLET = { holdingId: 'wallet', name: 'Wallet' };

const LIST = onStack('Accounts');
const CASH_PAGE = onStack('AccountDetail', CASH);
const MONO_PAGE = onStack('AccountDetail', MONO);
const WALLET_PAGE = onStack('HoldingDetail', WALLET);

const open = async (
  accountDetail: Parameters<typeof openAccountsPages>[1],
  next?: Parameters<typeof openAccountsPages>[2],
): Promise<void> => {
  await act(async () => {
    openAccountsPages(navigationRef, accountDetail, next);
  });
};

const openOnAccountsTab = async (screen: 'AccountDetail' | 'HoldingDetail', params: object) => {
  await act(async () => {
    navigationRef.navigate('AccountsTab', { screen, params, initial: false } as never);
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

describe('openAccountsPages (real router)', () => {
  it('opens the account page above the list when the Accounts tab was never visited', async () => {
    await renderApp();
    expect(accountsStack()).toEqual([]);

    await open(CASH);

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([LIST, CASH_PAGE]);
  });

  it('opens the holding page above the account page, so Back lands on the account', async () => {
    await renderApp();

    await open(CASH, { screen: 'HoldingDetail', params: WALLET });

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([LIST, CASH_PAGE, WALLET_PAGE]);

    await goBack();

    expect(accountsStack()).toEqual([LIST, CASH_PAGE]);
  });

  it('navigates once, naming the whole stack', async () => {
    await renderApp();
    const navigate = jest.spyOn(navigationRef, 'navigate');

    await open(CASH, { screen: 'HoldingDetail', params: WALLET });

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('AccountsTab', {
      state: {
        routes: [
          { key: undefined, name: 'Accounts' },
          { key: undefined, name: 'AccountDetail', params: CASH },
          { name: 'HoldingDetail', params: WALLET },
        ],
        index: 2,
      },
    });
    navigate.mockRestore();
  });

  it('drops the pages the Accounts tab had open and keeps its list in place', async () => {
    await renderApp();
    await openOnAccountsTab('AccountDetail', MONO);
    await openOnAccountsTab('HoldingDetail', { holdingId: 'card', name: 'Card' });
    const [listBefore] = accountsStack();

    await open(CASH);

    expect(accountsStack()).toEqual([LIST, CASH_PAGE]);
    expect(accountsStack()[0]?.key).toBe(listBefore?.key);
  });

  it('keeps the page of the account already open above the list, taking the new params in place', async () => {
    await renderApp();
    await openOnAccountsTab('AccountDetail', MONO);
    await openOnAccountsTab('HoldingDetail', { holdingId: 'card', name: 'Card' });
    const [, pageBefore] = accountsStack();

    await open(MONO, { screen: 'HoldingDetail', params: WALLET });

    expect(accountsStack()).toEqual([LIST, MONO_PAGE, WALLET_PAGE]);
    expect(accountsStack()[1]?.key).toBe(pageBefore?.key);
  });

  it('mounts a new page for another account instead of reusing the page of the open one', async () => {
    await renderApp();
    await openOnAccountsTab('AccountDetail', MONO);
    const [, monoPageBefore] = accountsStack();

    await open(CASH);

    expect(accountsStack()).toEqual([LIST, CASH_PAGE]);
    expect(accountsStack()[1]?.key).not.toBe(monoPageBefore?.key);
  });

  it('mounts an account page of its own above a holding page that sat right above the list', async () => {
    await renderApp();
    await openOnAccountsTab('HoldingDetail', { holdingId: 'card', name: 'Card' });
    const [, holdingPageBefore] = accountsStack();

    await open(CASH);

    expect(accountsStack()).toEqual([LIST, CASH_PAGE]);
    expect(accountsStack()[1]?.key).not.toBe(holdingPageBefore?.key);
  });

  it('opens from another tab after the Accounts tab was left on a page', async () => {
    await renderApp();
    await openOnAccountsTab('AccountDetail', MONO);
    await goHome();
    expect(focusedTab()).toBe('HomeTab');

    await open(CASH, { screen: 'HoldingDetail', params: WALLET });

    expect(focusedTab()).toBe('AccountsTab');
    expect(accountsStack()).toEqual([LIST, CASH_PAGE, WALLET_PAGE]);
  });

  // The plain navigate `useOpenInPane` falls back to outside a pane pushes the account page again
  // instead of going back to the one below it, so the holding page the user came from stays under
  // it and Back returns there.
  it('pushes the account page again above the holding page that was opened from it, keeping that page for Back', async () => {
    await renderApp();
    await open(CASH, { screen: 'HoldingDetail', params: WALLET });
    const [, firstAccountPage] = accountsStack();

    await act(async () => {
      navigationRef.dispatch(CommonActions.navigate({ name: 'AccountDetail', params: CASH }));
    });

    expect(accountsStack()).toEqual([LIST, CASH_PAGE, WALLET_PAGE, CASH_PAGE]);
    expect(accountsStack()[3]?.key).not.toBe(firstAccountPage?.key);

    await goBack();

    expect(accountsStack()).toEqual([LIST, CASH_PAGE, WALLET_PAGE]);
  });
});
