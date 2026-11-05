import type { FC } from 'react';
import { useLiveQuery } from '@kiko/db';
import { useTranslation } from 'react-i18next';
import { syncStateRepo } from '@kiko/sync-state';
import { isBalanceProviderId } from '@kiko/crypto-sync/provider';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { balanceNotesOf } from '@kiko/crypto-sync/exchange/history-status';

import { hasKeyLines } from '../crypto-sync-section/binance-history-status';

import type { HoldingsEmptyStateProps } from './holdings-empty-state.props';

// The block under the Holdings heading when the account has no active holding. A Bybit account
// whose last balance read set a coin aside or was refused a wallet is not empty, so it says so
// instead of "No holdings yet" under lines that name the coins. It reads the account's own
// `sync_state` row, gated on its own isLoading: while that read is on its first load a Bybit
// account shows nothing, because either block would be a guess. Every other account has no notes
// to read, so its read stays off and its block shows at once.
const HoldingsEmptyState: FC<HoldingsEmptyStateProps> = ({
  accountId,
  institution,
  onAddHolding,
}) => {
  const { t } = useTranslation();
  const exchange = institution ?? null;
  const readsBalanceNotes = isBalanceProviderId(exchange) && hasKeyLines(exchange);
  const { data: syncStateRows, isLoading } = useLiveQuery(
    syncStateRepo.getQuery(accountId),
    ['sync_state'],
    readsBalanceNotes,
  );

  if (readsBalanceNotes && isLoading) {
    return null;
  }

  const balanceNotes = balanceNotesOf(
    parseExchangeState(syncStateRows.at(0)?.exchangeState ?? null),
  );
  const hasBalanceNotes =
    readsBalanceNotes && Object.values(balanceNotes).some((list) => list.length > 0);

  return (
    <EmptyState
      icon={genericEntitySymbol.holding}
      title={
        hasBalanceNotes
          ? t('accountDetail.bybitBalancesNotRead.title')
          : t('accountDetail.emptyHoldings.title')
      }
      message={
        hasBalanceNotes
          ? t('accountDetail.bybitBalancesNotRead.message')
          : t('accountDetail.emptyHoldings.message')
      }
      action={{
        label: t('accountDetail.addHolding'),
        icon: genericEntitySymbol.holding,
        onPress: onAddHolding,
      }}
      testID="account-detail-holdings-empty"
    />
  );
};

export default HoldingsEmptyState;
