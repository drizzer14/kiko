import type { FC } from 'react';
import { useState } from 'react';
import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';

import {
  type BalanceProviderId,
  isBalanceProviderId,
  providerDisplayName,
} from '../../../crypto-sync/provider';
import CryptoSyncForm from '../crypto-sync-form';
import { styles } from '../account-detail.styles';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import type { AccountRow, HoldingRow } from '../../../db/schema';
import SymbolIcon from '../../../design-system/components/symbol';
import { resyncRequest } from '../../../crypto-sync/resync-request';
import { alertOnCatch } from '../../../design-system/alert-on-catch';
import SyncDisconnectActionsRow from '../sync-disconnect-actions-row';
import { formatLastSyncAt, latestSyncedAt } from '../format-last-sync';
import { disconnectCryptoAccount } from '../../../crypto-sync/disconnect';
import ConfirmSheet from '../../../design-system/components/confirm-sheet';

type CryptoSyncSectionProps = {
  account: AccountRow;
  holdings: HoldingRow[];
};

const disconnectMessage = (providerId: BalanceProviderId, t: TFunction): string =>
  match(providerId)
    .with('btc_wallet', () => t('accountDetail.disconnectProviderMessage.wallet'))
    .with('binance', () => t('accountDetail.disconnectProviderMessage.binance'))
    .exhaustive();

// The crypto account's Synchronization section — the counterpart of the bank
// account's Monobank token field + Connect/Sync/Disconnect row. Before a
// connection: a Wallet/Binance source picker and the matching entry field
// (each field's Connect runs the first sync, which marks the account). Once
// connected: Sync with the last-sync stamp, and a confirmed Disconnect.
const CryptoSyncSection: FC<CryptoSyncSectionProps> = ({ account, holdings }) => {
  const { t } = useTranslation();
  const { isSyncing, error, sync } = useCryptoSync();
  // Multi-connection: each crypto account connects independently, so
  // there is no "connected elsewhere" gate — another account holding this source
  // no longer blocks connecting it here.
  const connectedProvider = isBalanceProviderId(account.institution)
    ? account.institution
    : undefined;
  // Whether the themed Disconnect confirm (`ConfirmSheet`) is up, replacing the
  // old native `Alert.alert`; a scrim/back dismiss behaves like Cancel.
  const [disconnectPending, setDisconnectPending] = useState(false);

  const connectWallet = (address: string): Promise<boolean> =>
    sync({ providerId: 'btc_wallet', targetAccountId: account.id, address });

  const connectBinance = (): Promise<boolean> =>
    sync({ providerId: 'binance', targetAccountId: account.id });

  const runDisconnect = async (providerId: BalanceProviderId): Promise<void> => {
    try {
      await disconnectCryptoAccount(account.id, providerId);
    } catch {
      alertOnCatch(t, 'accountDetail.disconnectErrorTitle', 'accountDetail.tryAgainMessage');
    }
  };

  const confirmDisconnect = (): void => {
    setDisconnectPending(true);
  };

  const cancelDisconnect = (): void => {
    setDisconnectPending(false);
  };

  const disconnect = (providerId: BalanceProviderId): void => {
    setDisconnectPending(false);
    runDisconnect(providerId);
  };

  if (connectedProvider !== undefined) {
    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>

        {/* gap={3} (not 2) so the "last synced" line ↔ actions-row spacing equals
            the section root's gap={3}, keeping one even vertical rhythm. The Sync
            and Disconnect buttons themselves sit SIDE BY SIDE in the single
            actions row below, not stacked. */}
        <Box gap={3} testID="crypto-sync-status-actions">
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />

            <Text variant="body" tone="textSecondary">
              {t('accountDetail.lastSync', {
                time: formatLastSyncAt(latestSyncedAt(holdings), t),
              })}
            </Text>
          </Box>

          {/* Sync and Disconnect share a single row — the shared
              SyncDisconnectActionsRow (both the neutral `secondaryTonal`
              treatment, never blue). */}
          <SyncDisconnectActionsRow
            onSync={() => {
              sync(resyncRequest(connectedProvider, account.id));
            }}
            isSyncing={isSyncing}
            onDisconnect={confirmDisconnect}
            testID="crypto-sync-actions-row"
          />
        </Box>

        {error !== undefined && (
          <Text variant="body" tone="negative">
            {error}
          </Text>
        )}

        {/* The crypto provider Disconnect confirmation — the same shared themed
            `ConfirmSheet` the grid-card long-press delete uses, replacing the old
            native `Alert.alert`. A scrim/back dismiss behaves like Cancel. */}
        <ConfirmSheet
          visible={disconnectPending}
          title={t('accountDetail.disconnectProvider', {
            provider: providerDisplayName(connectedProvider, t),
          })}
          message={disconnectMessage(connectedProvider, t)}
          confirmLabel={t('accountDetail.disconnectAction')}
          onConfirm={() => disconnect(connectedProvider)}
          onCancel={cancelDisconnect}
          destructive
          confirmTestID="crypto-disconnect-confirm"
        />
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      <CryptoSyncForm
        accountId={account.id}
        onConnectWallet={connectWallet}
        onConnectBinance={connectBinance}
      />

      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}
    </Box>
  );
};

export default CryptoSyncSection;
