import type { FC } from 'react';
import { useLiveQuery } from '@kiko/db';
import { useTranslation } from 'react-i18next';
import { syncStateRepo } from '@kiko/sync-state';
import { isBalanceProviderId } from '@kiko/crypto-sync/provider';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import EmptyState from '@kiko/design-system/components/empty-state';
import { parseExchangeState } from '@kiko/crypto-sync/exchange/walk-state';
import { balanceNotesOf, untrackedBalanceCoinsOf } from '@kiko/crypto-sync/exchange/history-status';

import { hasKeyLines, isTrackedAssetOf } from '../crypto-sync-section/binance-history-status';

import type { HoldingsEmptyStateProps } from './holdings-empty-state.props';

// The block under the Holdings heading when the account has no active holding. A Bybit account
// whose last balance read set a coin aside, was refused a wallet, could not read a wallet, or
// listed a coin Kiko does not track is not empty, so it says so instead of "No holdings yet" under
// lines that name them. The untracked coins it counts are the balance list alone, not the union
// of `untrackedCoinsOf`: a coin on the history list has no balance claim behind it and no balance
// read clears that list (O83). The caption under Synchronization keeps the union. It reads the
// account's own `sync_state` row, gated on its own isLoading: while that read is on its first
// load a Bybit account shows nothing, because either block would be a guess. Every other account
// has no notes to read, so its read stays off and its block shows at once.
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

  if (isLoading) {
    return null;
  }

  const state = parseExchangeState(syncStateRows.at(0)?.exchangeState ?? null);
  // The provider is named again for its own tracked-coin rule: a disabled read gives no rows, so
  // an account of any other provider reaches neither list.
  const untrackedCoins = isBalanceProviderId(exchange)
    ? untrackedBalanceCoinsOf(state, isTrackedAssetOf(exchange))
    : [];
  const hasBalanceNotes =
    untrackedCoins.length > 0 ||
    Object.values(balanceNotesOf(state)).some((list) => list.length > 0);

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
