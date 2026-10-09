import {
  type PrimaryPaneRoute,
  useClosePaneRoute,
  usePrimaryPaneRoute,
  useShowPaneDefault,
} from '@kiko/navigation/pane-stack';
import { useEffect, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { usePaneContext } from '@kiko/design-system/pane-context';
import { accountDisplayName } from '@kiko/holdings/implicit-account';

type PaneDefault = { name: string; params: object | undefined };

type AccountsPaneInput = {
  isReady: boolean;
  // Both lists were read fresh. A cached or deferred read can be one write old, so a page is
  // judged gone only by a read that cannot be.
  isFresh: boolean;
  isVisible: boolean;
  isEmpty: boolean;
  // The account the list shows first: the page the primary pane starts with.
  firstAccount: AccountRow | undefined;
  accounts: AccountRow[];
  holdings: HoldingRow[];
};

const paramOf = (
  route: PaneDefault | PrimaryPaneRoute | null,
  name: string,
  param: string,
): string | undefined => {
  const value =
    route?.name === name
      ? (route.params as Record<string, unknown> | undefined)?.[param]
      : undefined;

  return typeof value === 'string' ? value : undefined;
};

const accountIdOf = (route: PaneDefault | PrimaryPaneRoute | null) =>
  paramOf(route, 'AccountDetail', 'accountId');

const holdingIdOf = (route: PaneDefault | PrimaryPaneRoute | null) =>
  paramOf(route, 'HoldingDetail', 'holdingId');

// Whether the pane already shows what the list would put there.
const isShown = (route: PrimaryPaneRoute, wanted: PaneDefault): boolean =>
  route.name === wanted.name && accountIdOf(route) === accountIdOf(wanted);

// A page about an account or a holding that no row has any more. An archived account and a closed
// holding are still rows.
const isGone = (
  route: PrimaryPaneRoute,
  accounts: AccountRow[],
  holdings: HoldingRow[],
): boolean => {
  const accountId = accountIdOf(route);
  const holdingId = holdingIdOf(route);

  return (
    (accountId !== undefined && !accounts.some((account) => account.id === accountId)) ||
    (holdingId !== undefined && !holdings.some((holding) => holding.id === holdingId))
  );
};

/**
 * What the Accounts list does on a wide window, where an account page fills the other pane. Until
 * the user taps a row that pane shows the first row of the list (or the empty pane while there is
 * no account), and the list marks the row the pane shows. A page the user opened closes once its
 * account or holding is deleted, which leaves the pane to the default again. On one pane there is
 * nothing to fill, mark or close.
 */
export const useAccountsPane = ({
  isReady,
  isFresh,
  isVisible,
  isEmpty,
  firstAccount,
  accounts,
  holdings,
}: AccountsPaneInput): { selectedAccountId: string | undefined } => {
  const { t } = useTranslation();
  const isInPane = usePaneContext() !== null;
  const primaryRoute = usePrimaryPaneRoute();
  const showPaneDefault = useShowPaneDefault();
  const closePaneRoute = useClosePaneRoute();
  const paneDefault = useMemo<PaneDefault | undefined>(
    () =>
      isEmpty
        ? { name: 'AccountsEmptyPane', params: undefined }
        : foldMap(maybe(firstAccount), (account) => ({
            name: 'AccountDetail',
            params: {
              accountId: account.id,
              name: accountDisplayName(account, t),
              kind: account.kind,
            },
          })),
    [isEmpty, firstAccount, t],
  );
  // The pane never loses a row the user tapped. The tab must be on screen: a tab left behind
  // would put its default back the moment the stack drops it on blur.
  const needsDefault =
    isInPane &&
    isVisible &&
    isReady &&
    paneDefault !== undefined &&
    (primaryRoute === null || (primaryRoute.isDefault && !isShown(primaryRoute, paneDefault)));
  // A default whose account is gone is replaced above; only a page the user opened is closed.
  const goneKey =
    isInPane &&
    isVisible &&
    isReady &&
    isFresh &&
    primaryRoute !== null &&
    !primaryRoute.isDefault &&
    isGone(primaryRoute, accounts, holdings)
      ? primaryRoute.key
      : undefined;

  useEffect(() => {
    if (needsDefault && paneDefault !== undefined) {
      showPaneDefault('primary', paneDefault.name, paneDefault.params);
    }
  }, [needsDefault, paneDefault, showPaneDefault]);

  useEffect(() => {
    if (goneKey !== undefined) {
      closePaneRoute(goneKey);
    }
  }, [goneKey, closePaneRoute]);

  return { selectedAccountId: accountIdOf(primaryRoute) };
};
