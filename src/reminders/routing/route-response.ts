import { match, P } from 'ts-pattern';
import { i18n } from '@kiko/i18n/init';
import maybe, { foldMap } from 'fnts/maybe';
import { accountsRepo } from '@kiko/accounts';
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
import { type AccountsPagesNext, openAccountsPages } from '@kiko/navigation/open-accounts-pages';

type ReminderRoute = {
  accountDetail: AccountsStackParamList['AccountDetail'];
  // Pushed above the account, so Back from it lands on the account.
  next?: AccountsPagesNext;
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

// Before the navigator is ready (a tap that launched the app), the route
// waits. Routes that waited all navigate in the same tick, so the newest one's
// stack is the one the Accounts stack reads.
const navigateTo = (route: ReminderRoute, navigationRef: TabNavigationRef): void => {
  if (navigationRef.isReady()) {
    openAccountsPages(navigationRef, route.accountDetail, route.next);

    return;
  }

  const unsubscribe = navigationRef.addListener('ready', () => {
    unsubscribe();
    openAccountsPages(navigationRef, route.accountDetail, route.next);
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
