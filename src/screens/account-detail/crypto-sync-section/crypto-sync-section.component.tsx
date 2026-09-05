import { type FC, useState } from 'react';
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
import { accountsRepo } from '../../../repositories/accounts.repo';
import ChipRow from '../../forms/chip-row';
import { useCryptoSync } from '../../use-crypto-sync';
import { styles } from '../account-detail.styles';
import BinanceCredentialsField from '../binance-credentials-field';
import { formatLastSyncAt, latestSyncedAt } from '../format-last-sync';
import WalletAddressField from '../wallet-address-field';

type CryptoSyncSectionProps = {
  account: AccountRow;
  holdings: HoldingRow[];
};

const sourceLabels: Record<BalanceProviderId, string> = {
  btc_wallet: providerDisplayName('btc_wallet'),
  binance: providerDisplayName('binance'),
};

const disconnectMessage = (providerId: BalanceProviderId): string =>
  match(providerId)
    .with(
      'btc_wallet',
      () => 'This clears the connection. Your BTC holding stays as a manual snapshot.',
    )
    .with(
      'binance',
      () =>
        'This clears the connection and the stored API key. Your BTC holding stays as a manual snapshot.',
    )
    .exhaustive();

// The crypto account's Synchronization section — the counterpart of the bank
// account's Monobank token field + Connect/Sync/Disconnect row. Before a
// connection: a Wallet/Binance source picker and the matching entry field
// (each field's Connect runs the first sync, which marks the account). Once
// connected: Sync now with the last-sync stamp, and a confirmed Disconnect.
const CryptoSyncSection: FC<CryptoSyncSectionProps> = ({ account, holdings }) => {
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
      Alert.alert('Could not disconnect', 'Please try again.');
    }
  };

  const confirmDisconnect = (providerId: BalanceProviderId): void => {
    Alert.alert(`Disconnect ${providerDisplayName(providerId)}`, disconnectMessage(providerId), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          runDisconnect(providerId);
        },
      },
    ]);
  };

  if (connectedProvider !== undefined) {
    return (
      <Box gap={3}>
        <Text variant="heading">Synchronization</Text>

        <Box direction="row" gap={2} style={styles.statusLine}>
          <Button
            variant="primary"
            size="compact"
            fullWidth={false}
            onPress={() => {
              sync(resyncRequest(connectedProvider, account.id));
            }}
            disabled={isSyncing}
            icon="arrow.triangle.2.circlepath"
          >
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </Button>

          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="clock" tone="textSecondary" />

            <Text variant="body" tone="textSecondary">
              Last sync: {formatLastSyncAt(latestSyncedAt(holdings))}
            </Text>
          </Box>
        </Box>

        <Button
          variant="secondary"
          size="compact"
          fullWidth={false}
          onPress={() => confirmDisconnect(connectedProvider)}
          icon="link.badge.plus"
        >
          {`Disconnect ${providerDisplayName(connectedProvider)}`}
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
      <Text variant="heading">Synchronization</Text>

      <ChipRow
        label="Source"
        options={balanceProviderIds}
        selected={source}
        onSelect={setSource}
        labels={sourceLabels}
      />

      {sourceConnectedElsewhere && (
        <Text variant="caption" tone="textSecondary">
          {providerDisplayName(source)} is already connected to another account
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
