import {
  type PrimaryPaneRoute,
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
  isVisible: boolean;
  isEmpty: boolean;
  mainAccounts: AccountRow[];
  // The property and debts sections: each lists its account's open holdings, and shows only
  // when it has some.
  sections: { account: AccountRow | undefined; holdings: HoldingRow[] }[];
};

const accountIdOf = (route: PaneDefault | PrimaryPaneRoute | null): string | undefined => {
  const params = route?.name === 'AccountDetail' ? route.params : undefined;

  return params !== undefined && 'accountId' in params && typeof params.accountId === 'string'
    ? params.accountId
    : undefined;
};

// Whether the pane already shows what the list would put there.
const isShown = (route: PrimaryPaneRoute, wanted: PaneDefault): boolean =>
  route.name === wanted.name && accountIdOf(route) === accountIdOf(wanted);

/**
 * What the Accounts list does on a wide window, where an account page fills the other pane. Until
 * the user taps a row that pane shows the first row of the list (or the empty pane while there is
 * no account), and the list marks the row the pane shows. On one pane there is nothing to fill or
 * mark.
 */
export const useAccountsPane = ({
  isReady,
  isVisible,
  isEmpty,
  mainAccounts,
  sections,
}: AccountsPaneInput): { selectedAccountId: string | undefined } => {
  const { t } = useTranslation();
  const isInPane = usePaneContext() !== null;
  const primaryRoute = usePrimaryPaneRoute();
  const showPaneDefault = useShowPaneDefault();
  const firstAccount =
    mainAccounts.at(0) ??
    sections.find((section) => section.holdings.length > 0 && section.account !== undefined)
      ?.account;
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

  useEffect(() => {
    if (needsDefault && paneDefault !== undefined) {
      showPaneDefault('primary', paneDefault.name, paneDefault.params);
    }
  }, [needsDefault, paneDefault, showPaneDefault]);

  return { selectedAccountId: isInPane ? accountIdOf(primaryRoute) : undefined };
};
