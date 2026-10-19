import {
  type DetailPaneRoute,
  detailParamOf,
  useClosePaneRoute,
  useDetailPaneRoute,
  useShowPaneDefault,
} from '@kiko/navigation/pane-stack';
import { useEffect, useMemo } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { usePaneContext } from '@kiko/design-system/pane-context';
import { accountDisplayName } from '@kiko/holdings/implicit-account';

// The empty pane is a placeholder: opening the account form from it must not make it a page the
// pane keeps once the new account exists.
type PaneDefault = { name: string; params: object | undefined; isPlaceholder: boolean };

type AccountsPaneInput = {
  isReady: boolean;
  // Both lists were read fresh. A cached or deferred read can be one write old, so a page is
  // judged gone only by a read that cannot be.
  isFresh: boolean;
  isVisible: boolean;
  isEmpty: boolean;
  // The account the list shows first: the page the detail pane starts with.
  firstAccount: AccountRow | undefined;
  accounts: AccountRow[];
  holdings: HoldingRow[];
};

const accountIdOf = (route: PaneDefault | DetailPaneRoute | null) =>
  detailParamOf(route, 'AccountDetail', 'accountId');

const holdingIdOf = (route: PaneDefault | DetailPaneRoute | null) =>
  detailParamOf(route, 'HoldingDetail', 'holdingId');

// Whether the pane already shows what the list would put there.
const isShown = (route: DetailPaneRoute, wanted: PaneDefault): boolean =>
  route.name === wanted.name && accountIdOf(route) === accountIdOf(wanted);

// A page about an account or a holding that no row has any more. An archived account and a closed
// holding are still rows.
const isGone = (
  route: DetailPaneRoute,
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
 * no account), and the list marks the row of the page the pane opened with, which stays marked
 * while a step opened from that page covers it. A page the user opened closes, with every step
 * opened from it, once its account or holding is deleted, which leaves the pane to the default
 * again. On one pane there is nothing to fill, mark or close.
 */
export const useAccountsPane = ({
  isReady,
  isFresh,
  isVisible,
  isEmpty,
  firstAccount,
  accounts,
  holdings,
}: AccountsPaneInput): {
  selectedAccountId: string | undefined;
  selectedHoldingId: string | undefined;
} => {
  const { t } = useTranslation();
  const isInPane = usePaneContext() !== null;
  const detailRoute = useDetailPaneRoute();
  const showPaneDefault = useShowPaneDefault();
  const closePaneRoute = useClosePaneRoute();
  const paneDefault = useMemo<PaneDefault | undefined>(
    () =>
      isEmpty
        ? { name: 'AccountsEmptyPane', params: undefined, isPlaceholder: true }
        : foldMap(maybe(firstAccount), (account) => ({
            name: 'AccountDetail',
            params: {
              accountId: account.id,
              name: accountDisplayName(account, t),
              kind: account.kind,
            },
            isPlaceholder: false,
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
    (detailRoute === null || (detailRoute.isDefault && !isShown(detailRoute, paneDefault)));
  // A default whose account is gone is replaced above; only a page the user opened is closed.
  const goneKey =
    isInPane &&
    isVisible &&
    isReady &&
    isFresh &&
    detailRoute !== null &&
    !detailRoute.isDefault &&
    isGone(detailRoute, accounts, holdings)
      ? detailRoute.key
      : undefined;

  useEffect(() => {
    if (needsDefault && paneDefault !== undefined) {
      showPaneDefault(paneDefault.name, paneDefault.params, paneDefault.isPlaceholder);
    }
  }, [needsDefault, paneDefault, showPaneDefault]);

  useEffect(() => {
    if (goneKey !== undefined) {
      closePaneRoute(goneKey);
    }
  }, [goneKey, closePaneRoute]);

  return {
    selectedAccountId: accountIdOf(detailRoute),
    selectedHoldingId: holdingIdOf(detailRoute),
  };
};
