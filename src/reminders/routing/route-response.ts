import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { isMatching, match, P } from 'ts-pattern';
import { holdingsRepo } from '@kiko/holdings/repo';
import { remindersRepo } from '@kiko/reminders/repo';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { isPausedNoticeResponse } from '@kiko/reminders/planner';
import type { NotificationResponse } from '@kiko/reminders/native';
import { isImplicitAccount } from '@kiko/holdings/implicit-account';
import type { NavigationContainerRef } from '@react-navigation/native';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { AccountsStackParamList, TabParamList } from '@kiko/navigation/types';

type ReminderRoute = {
  // Absent for an implicit account: it has no AccountDetail page, so `next`
  // lands above the Accounts pages that are already open (the Accounts root
  // when the tab is unmounted or at its root).
  accountDetail?: AccountsStackParamList['AccountDetail'];
  // Pushed above the account, so Back from it lands on the account.
  next?:
    | { screen: 'TransactionForm'; params: { holdingId: string } }
    | { screen: 'AccountReminders'; params: AccountsStackParamList['AccountReminders'] };
};

// The native queue appends each response as it comes, so the last is the
// latest.
export const latestOpenResponse = (
  responses: readonly NotificationResponse[],
): NotificationResponse | undefined =>
  responses.filter((response) => response.action === 'open').at(-1);

// The paused notice says the reminder has stopped, so its tap opens the page
// where the user can resume it. A holding that takes no transactions (a
// deposit, a bond, a property item, a metal, a loan) has no form to open. An
// implicit account has no page at all, so a reminder that is still saved on one
// opens the Accounts tab with its current pages kept (the root only when the
// tab is unmounted or at its root), and its paused notice the reminders page
// above them.
export const routeFor = (
  response: NotificationResponse,
  kind: ReminderKind,
  account: Pick<AccountRow, 'id' | 'name' | 'kind' | 'archivedAt'> | undefined,
  openHoldings: readonly Pick<HoldingRow, 'id' | 'type'>[],
): ReminderRoute | undefined =>
  foldMap(maybe(account), (found): ReminderRoute => {
    const { id: accountId, name } = found;
    const accountDetail = { accountId, name };

    if (isImplicitAccount(found)) {
      return isPausedNoticeResponse(response)
        ? { next: { screen: 'AccountReminders', params: { accountId } } }
        : {};
    }

    if (isPausedNoticeResponse(response)) {
      return { accountDetail, next: { screen: 'AccountReminders', params: { accountId } } };
    }

    return match(kind)
      .returnType<ReminderRoute>()
      .with('statement_import', () => ({
        accountDetail: { ...accountDetail, intent: 'importStatement' },
      }))
      .with('add_transactions', () =>
        match(openHoldings)
          .returnType<ReminderRoute>()
          .with([{ type: P.when((type) => !isLedgerlessHoldingType(type)) }], ([{ id }]) => ({
            accountDetail,
            next: { screen: 'TransactionForm', params: { holdingId: id } },
          }))
          .otherwise(() => ({ accountDetail })),
      )
      .exhaustive();
  });

type TabNavigationRef = NavigationContainerRef<TabParamList>;

type StackRoute = { key?: string; name: string; params?: object };

// The Accounts stack as it is now, or its root while the tab has not mounted.
const accountsStackRoutes = (navigationRef: TabNavigationRef): StackRoute[] => {
  const tabs = navigationRef.getRootState()?.routes ?? [];
  const routes = tabs.find(({ name }) => name === 'AccountsTab')?.state?.routes ?? [];

  return routes.length === 0
    ? [{ name: 'Accounts' }]
    : routes.map(({ key, name, params }) => ({ key, name, params }));
};

// The page of the tapped account already on top takes the new params in
// place, as a navigate to the current route does; any other page stays below.
const withAccountOnTop = (
  routes: StackRoute[],
  accountDetail: AccountsStackParamList['AccountDetail'],
): StackRoute[] => {
  const top = routes.at(-1);

  if (isMatching({ name: 'AccountDetail', params: { accountId: accountDetail.accountId } }, top)) {
    return [...routes.slice(0, -1), { ...top, params: accountDetail }];
  }

  return [...routes, { name: 'AccountDetail', params: accountDetail }];
};

// One navigate with the whole stack: a second navigate right after the first
// replaces the tab's nested params before the stack has read them, so the
// account page would never land below the next screen.
const navigateNow = (route: ReminderRoute, navigationRef: TabNavigationRef): void => {
  const stack = accountsStackRoutes(navigationRef);
  const routes = [
    ...(foldMap(maybe(route.accountDetail), (accountDetail) =>
      withAccountOnTop(stack, accountDetail),
    ) ?? stack),
    ...(foldMap(maybe(route.next), ({ screen, params }) => [{ name: screen, params }]) ?? []),
  ];

  navigationRef.navigate('AccountsTab', { state: { routes, index: routes.length - 1 } });
};

// Before the navigator is ready (a tap that launched the app), the route
// waits. Routes that waited all navigate in the same tick, so the newest one's
// stack is the one the Accounts stack reads.
const navigateTo = (route: ReminderRoute, navigationRef: TabNavigationRef): void => {
  if (navigationRef.isReady()) {
    navigateNow(route, navigationRef);

    return;
  }

  const unsubscribe = navigationRef.addListener('ready', () => {
    unsubscribe();
    navigateNow(route, navigationRef);
  });
};

/**
 * Opens the screen for the latest notification tap among the drained
 * responses, in the Accounts tab above the screens it shows now. A tap for a
 * reminder that is gone (deleted, or deleted with its account) goes nowhere.
 * The navigator mounts only below `LockGate`, so nothing opens before unlock.
 */
export const routeLatestResponse = async (
  responses: readonly NotificationResponse[],
  navigationRef: TabNavigationRef,
): Promise<void> => {
  const response = latestOpenResponse(responses);

  if (response === undefined) {
    return;
  }

  const [reminder] = await remindersRepo.byIdQuery(response.reminderId);

  if (reminder === undefined) {
    return;
  }

  const [account] = await accountsRepo.byIdQuery(reminder.accountId);
  const holdings = await holdingsRepo.listByAccountQuery(reminder.accountId);
  const openHoldings = holdings.filter(({ closedAt }) => closedAt === null);

  foldMap(maybe(routeFor(response, reminder.kind, account, openHoldings)), (route) =>
    navigateTo(route, navigationRef),
  );
};
