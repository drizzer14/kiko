import { useCallback } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useTranslation } from 'react-i18next';
import type { AccountRow, HoldingRow } from '@kiko/db';
import { useOpenInPane } from '@kiko/navigation/pane-stack';
import { accountDisplayName } from '@kiko/holdings/implicit-account';

type ViewActions = { onViewAccount?: () => void; onViewHolding?: () => void };

/**
 * The View account / View holding actions of a ledger row, by the holding the row is stored on.
 * A row on this page's own holding offers View account only (View holding would open the page
 * the user is on). A row stored on another holding (a loan's linked payment lives on its payer)
 * offers both, pointing at that holding and its account. An action whose target is not loaded is
 * left out.
 */
export const useViewActions = ({
  holdingId,
  holdings,
  accounts,
}: {
  holdingId: string;
  holdings: readonly Pick<HoldingRow, 'id' | 'accountId' | 'name'>[];
  accounts: readonly Pick<AccountRow, 'id' | 'name' | 'kind' | 'archivedAt'>[];
}): ((rowHoldingId: string) => ViewActions) => {
  const { t } = useTranslation();
  const openInPane = useOpenInPane();

  return useCallback(
    (rowHoldingId) => {
      const rowHolding = holdings.find(({ id }) => id === rowHoldingId);
      const rowAccount = foldMap(maybe(rowHolding), ({ accountId }) =>
        accounts.find(({ id }) => id === accountId),
      );

      return {
        onViewAccount: foldMap(maybe(rowAccount), (found) => () => {
          openInPane('AccountDetail', {
            accountId: found.id,
            name: accountDisplayName(found, t),
            kind: found.kind,
          });
        }),
        onViewHolding:
          rowHoldingId === holdingId
            ? undefined
            : foldMap(maybe(rowHolding), (found) => () => {
                openInPane('HoldingDetail', { holdingId: found.id, name: found.name });
              }),
      };
    },
    [holdingId, holdings, accounts, openInPane, t],
  );
};
