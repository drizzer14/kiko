import type { FC } from 'react';
import { useState } from 'react';
import { match } from 'ts-pattern';
import { Alert } from 'react-native';
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
import Button from '../../../design-system/components/button';
import type { AccountRow, HoldingRow } from '../../../db/schema';
import SymbolIcon from '../../../design-system/components/symbol';
import { resyncRequest } from '../../../crypto-sync/resync-request';
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
  // Multi-connection (Task 5.2): each crypto account connects independently, so
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
      Alert.alert(t('accountDetail.disconnectErrorTitle'), t('accountDetail.tryAgainMessage'));
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

          {/* Sync and Disconnect share a single row. Sync is the affirmative blue
              `primary` re-import action; Disconnect stays a neutral tonal action
              beside it — never blue. */}
          <Box direction="row" gap={2} testID="crypto-sync-actions-row">
            <Button
              variant="primary"
              size="small"
              fullWidth={false}
              onPress={() => {
                sync(resyncRequest(connectedProvider, account.id));
              }}
              disabled={isSyncing}
              // iOS-26 rotate glyph; the central IOS26_SYMBOL_FALLBACKS map
              // (symbol.availability.ts) hands SymbolIcon the iOS-16-safe
              // `arrow.triangle.2.circlepath` on a pre-26 device for free, even
              // through the shared Button's `icon` prop.
              icon="arrow.trianglehead.2.clockwise.rotate.90"
            >
              {isSyncing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
            </Button>

            <Button
              variant="secondaryTonal"
              size="small"
              fullWidth={false}
              onPress={confirmDisconnect}
              icon="lock.open"
            >
              {t('accountDetail.disconnectAction')}
            </Button>
          </Box>
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
