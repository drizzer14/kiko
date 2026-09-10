import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { useCryptoSync } from '@kiko/sync/use-crypto-sync';
import type { TFunction } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { match } from 'ts-pattern';

import { disconnectCryptoAccount } from '../../../crypto-sync/disconnect';
import {
  type BalanceProviderId,
  balanceProviderIds,
  isBalanceProviderId,
  providerDisplayName,
} from '../../../crypto-sync/provider';
import { resyncRequest } from '../../../crypto-sync/resync-request';
import type { AccountRow, HoldingRow } from '../../../db/schema';
import { useLiveQuery } from '../../../db/use-live-query';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import ChipRow from '../../forms/chip-row';
import { styles } from '../account-detail.styles';
import BinanceCredentialsField from '../binance-credentials-field';
import { formatLastSyncAt, latestSyncedAt } from '../format-last-sync';
import WalletAddressField from '../wallet-address-field';

type CryptoSyncSectionProps = {
  account: AccountRow;
  holdings: HoldingRow[];
};

// A function (not a module-level constant) so its labels re-resolve against
// the active language on every render, rather than freezing to whatever
// language was active when this module first loaded.
const sourceLabels = (t: TFunction): Record<BalanceProviderId, string> => ({
  btc_wallet: providerDisplayName('btc_wallet', t),
  binance: providerDisplayName('binance', t),
});

const disconnectMessage = (providerId: BalanceProviderId, t: TFunction): string =>
  match(providerId)
    .with('btc_wallet', () => t('accountDetail.disconnectProviderMessage.wallet'))
    .with('binance', () => t('accountDetail.disconnectProviderMessage.binance'))
    .exhaustive();

// The crypto account's Synchronization section — the counterpart of the bank
// account's Monobank token field + Connect/Sync/Disconnect row. Before a
// connection: a Wallet/Binance source picker and the matching entry field
// (each field's Connect runs the first sync, which marks the account). Once
// connected: Sync now with the last-sync stamp, and a confirmed Disconnect.
const CryptoSyncSection: FC<CryptoSyncSectionProps> = ({ account, holdings }) => {
  const { t } = useTranslation();
  const { isSyncing, error, sync } = useCryptoSync();
  const [source, setSource] = useState<BalanceProviderId>('btc_wallet');
  // One connection per institution: another account holding the picked source
  // blocks connecting it here (the same rule `runBalanceSync` enforces).
  const { data: walletAccounts } = useLiveQuery(accountsRepo.connectedQuery('btc_wallet'), [
    'accounts',
  ]);
  const { data: binanceAccounts } = useLiveQuery(accountsRepo.connectedQuery('binance'), [
    'accounts',
  ]);
  const connectedProvider = isBalanceProviderId(account.institution)
    ? account.institution
    : undefined;
  const sourceAccounts = source === 'btc_wallet' ? walletAccounts : binanceAccounts;
  const sourceConnectedElsewhere = sourceAccounts.some((connected) => connected.id !== account.id);

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

  const confirmDisconnect = (providerId: BalanceProviderId): void => {
    Alert.alert(
      t('accountDetail.disconnectProvider', { provider: providerDisplayName(providerId, t) }),
      disconnectMessage(providerId, t),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('accountDetail.disconnectAction'),
          style: 'destructive',
          onPress: () => {
            runDisconnect(providerId);
          },
        },
      ],
    );
  };

  if (connectedProvider !== undefined) {
    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>

        {/* gap={3} (not 2) so the "last synced" line ↔ "Sync now" spacing equals
            the "Sync now" ↔ "Disconnect" spacing (the section root's gap={3}),
            giving the three stacked elements one even rhythm. */}
        <Box gap={3} testID="crypto-sync-status-actions">
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />

            <Text variant="body" tone="textSecondary">
              {t('accountDetail.lastSync', {
                time: formatLastSyncAt(latestSyncedAt(holdings), t),
              })}
            </Text>
          </Box>

          <Button
            variant="secondaryTonal"
            size="small"
            fullWidth={false}
            onPress={() => {
              sync(resyncRequest(connectedProvider, account.id));
            }}
            disabled={isSyncing}
            icon="arrow.triangle.2.circlepath"
          >
            {isSyncing ? t('accountDetail.syncing') : t('accountDetail.syncNow')}
          </Button>
        </Box>

        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={() => confirmDisconnect(connectedProvider)}
          icon="link.badge.plus"
        >
          {t('accountDetail.disconnectProvider', {
            provider: providerDisplayName(connectedProvider, t),
          })}
        </Button>

        {error !== undefined && (
          <Text variant="body" tone="negative">
            {error}
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      <ChipRow
        label={t('accountDetail.sourceLabel')}
        options={balanceProviderIds}
        selected={source}
        onSelect={setSource}
        labels={sourceLabels(t)}
      />

      {sourceConnectedElsewhere && (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.sourceConnectedElsewhere', { source: providerDisplayName(source, t) })}
        </Text>
      )}

      {!sourceConnectedElsewhere && source === 'btc_wallet' && (
        <WalletAddressField onConnect={connectWallet} />
      )}

      {!sourceConnectedElsewhere && source === 'binance' && (
        <BinanceCredentialsField onConnect={connectBinance} />
      )}

      {error !== undefined && (
        <Text variant="body" tone="negative">
          {error}
        </Text>
      )}
    </Box>
  );
};

export default CryptoSyncSection;
