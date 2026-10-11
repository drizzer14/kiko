import { i18n } from '@kiko/i18n/init';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
import { isMatching, match, P } from 'ts-pattern';
import { holdingsRepo } from '@kiko/holdings/repo';
import { remindersRepo } from '@kiko/reminders/repo';
import type { AccountRow, HoldingRow } from '@kiko/db';
import type { ReminderKind } from '@kiko/reminders/schedule';
import { isPausedNoticeResponse } from '@kiko/reminders/planner';
import type { NotificationResponse } from '@kiko/reminders/native';
import { accountDisplayName } from '@kiko/holdings/implicit-account';
import type { NavigationContainerRef } from '@react-navigation/native';
import { isLedgerlessHoldingType } from '@kiko/holdings/holding-descriptor';
import type { AccountsStackParamList, TabParamList } from '@kiko/navigation/types';

type ReminderRoute = {
  accountDetail: AccountsStackParamList['AccountDetail'];
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
// implicit account (property or debt) opens its AccountDetail like any other,
// titled by `accountDisplayName` (the stored name is an English sentinel while
// the account is unrenamed), so a reminder a merge left on one routes by the
// same rules.
export const routeFor = (
  response: NotificationResponse,
  kind: ReminderKind,
  account: Pick<AccountRow, 'id' | 'name' | 'kind' | 'archivedAt'> | undefined,
  openHoldings: readonly Pick<HoldingRow, 'id' | 'type'>[],
): ReminderRoute | undefined =>
  foldMap(maybe(account), (found): ReminderRoute => {
    const accountId = found.id;
    // The kind rides along so the page knows its header items (no Reminders
    // bell for an implicit account) from its first render.
    const accountDetail = {
      accountId,
      name: accountDisplayName(found, i18n.t),
      kind: found.kind,
    };

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

// The stack the tap leaves: the list, the tapped account's page, and the screen above it, and
// nothing a user opened earlier. An earlier page left below the account's would close the account's
// with it (its entity deleted, say), and the list marks the first page of the detail pane. The list
// and a page of the tapped account the user opened right above it keep their keys, so neither is
// mounted again and the page takes the new params in place. A page right above the list may be the
// one a wide window fills the primary pane with, flagged `isDefault`, which the user never opened.
// A form open above the list is discarded with its draft: keeping it would let the close of an
// earlier account's page close the reminder's page too.
const rebuiltStack = (route: ReminderRoute, navigationRef: TabNavigationRef): StackRoute[] => {
  const tabs = navigationRef.getRootState()?.routes ?? [];
  const [list, page] = (tabs.find(({ name }) => name === 'AccountsTab')?.state?.routes ?? []).slice(
    0,
    2,
  ) as (StackRoute & { isDefault?: boolean })[];
  const isPageOpen =
    page?.isDefault !== true &&
    isMatching(
      { name: 'AccountDetail', params: { accountId: route.accountDetail.accountId } },
      page,
    );

  return [
    { key: list?.key, name: 'Accounts' },
    {
      key: isPageOpen ? page?.key : undefined,
      name: 'AccountDetail',
      params: route.accountDetail,
    },
    ...(foldMap(maybe(route.next), ({ screen, params }) => [{ name: screen, params }]) ?? []),
  ];
};

// One navigate with the whole stack: a second navigate right after the first
// replaces the tab's nested params before the stack has read them, so the
// account page would never land below the next screen.
const navigateNow = (route: ReminderRoute, navigationRef: TabNavigationRef): void => {
  const routes = rebuiltStack(route, navigationRef);

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
 * responses, in the Accounts tab, whose stack it rebuilds from the list. A tap for a
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
