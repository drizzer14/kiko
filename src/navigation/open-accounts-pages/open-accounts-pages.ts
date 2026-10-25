import { isMatching } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import type { NavigationContainerRef } from '@react-navigation/native';

import type { AccountsStackParamList, TabParamList } from '../types';

// The screen pushed above the account's page, so Back from it lands on the account.
export type AccountsPagesNext =
  | { screen: 'TransactionForm'; params: { holdingId: string } }
  | { screen: 'AccountReminders'; params: AccountsStackParamList['AccountReminders'] }
  | { screen: 'HoldingDetail'; params: AccountsStackParamList['HoldingDetail'] };

type TabNavigationRef = NavigationContainerRef<TabParamList>;

type StackRoute = { key?: string; name: string; params?: object };

// The stack the open leaves: the list, the account's page, and the screen above it, and nothing a
// user opened earlier. An earlier page left below the account's would close the account's with it
// (its entity deleted, say), and the list marks the first page of the detail pane. The list and a
// page of the same account the user opened right above it keep their keys, so neither is mounted
// again and the page takes the new params in place. A page right above the list may be the one a
// wide window fills the primary pane with, flagged `isDefault`, which the user never opened. A
// form open above the list is discarded with its draft: keeping it would let the close of an
// earlier account's page close the new page too.
const rebuiltStack = (
  accountDetail: AccountsStackParamList['AccountDetail'],
  next: AccountsPagesNext | undefined,
  navigationRef: TabNavigationRef,
): StackRoute[] => {
  const tabs = navigationRef.getRootState()?.routes ?? [];
  const [list, page] = (tabs.find(({ name }) => name === 'AccountsTab')?.state?.routes ?? []).slice(
    0,
    2,
  ) as (StackRoute & { isDefault?: boolean })[];
  const isPageOpen =
    page?.isDefault !== true &&
    isMatching({ name: 'AccountDetail', params: { accountId: accountDetail.accountId } }, page);

  return [
    { key: list?.key, name: 'Accounts' },
    {
      key: isPageOpen ? page?.key : undefined,
      name: 'AccountDetail',
      params: accountDetail,
    },
    ...(foldMap(maybe(next), ({ screen, params }) => [{ name: screen, params }]) ?? []),
  ];
};

/**
 * Opens an account's page in the Accounts tab, with `next` above it when given, from any tab
 * (Home, Statistics, a notification tap). The Home and Statistics stacks have neither detail
 * page, so one navigate carries the whole stack: a second navigate right after the first
 * replaces the tab's nested params before the stack has read them, so the account page would
 * never land below the next screen.
 */
export const openAccountsPages = (
  navigationRef: TabNavigationRef,
  accountDetail: AccountsStackParamList['AccountDetail'],
  next?: AccountsPagesNext,
): void => {
  const routes = rebuiltStack(accountDetail, next, navigationRef);

  navigationRef.navigate('AccountsTab', { state: { routes, index: routes.length - 1 } });
};
