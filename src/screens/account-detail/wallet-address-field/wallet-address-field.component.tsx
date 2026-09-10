import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { isValidBitcoinAddress } from '../../../crypto-sync/btc-wallet/bitcoin-address';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import TextField from '../../../design-system/components/text-field';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import SyncStatusLine from '../sync-status-line';

type WalletAddressFieldProps = {
  /**
   * Runs the wallet Connect sync for a format-valid address and resolves
   * whether it succeeded. The sync fetches the balance BEFORE it marks the
   * account or writes the holding, so this call is also the spec's trial
   * fetch: a bad address persists nothing.
   */
  onConnect: (address: string) => Promise<boolean>;
};

// The wallet counterpart of the Monobank token field: a public BTC address is
// not a secret, so the input is plain (not secureTextEntry) and nothing goes to
// the Keychain — the address lands in the synced holding's metadata. Connect
// runs a local format check first, then the trial sync behind `onConnect`.
const WalletAddressField: FC<WalletAddressFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeAddress = (value: string): void => {
    setAddress(value);
    setStatus({ kind: 'idle' });
  };

  const handlePasteAddress = (): void => {
    Clipboard.getString().then((value) => {
      setAddress(value.trim());
      setStatus({ kind: 'idle' });
    });
  };

  const handleConnect = (): void => {
    const trimmed = address.trim();

    if (!isValidBitcoinAddress(trimmed)) {
      setStatus({ kind: 'invalid', message: t('accountDetail.invalidBtcAddress') });

      return;
    }

    setStatus({ kind: 'checking' });
    onConnect(trimmed).then((connected) => {
      setStatus(
        connected
          ? { kind: 'success', message: t('accountDetail.walletConnected') }
          : { kind: 'saveError', message: t('accountDetail.couldNotConnectWallet') },
      );
    });
  };

  return (
    <Box gap={3}>
      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.addressLabel')}
            value={address}
            onChangeText={handleChangeAddress}
            placeholder={t('accountDetail.btcAddressPlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountDetail.pasteFromClipboard')}
          onPress={handlePasteAddress}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking' || address.trim() === ''}
          icon="link"
        >
          {t('accountDetail.connectWallet')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default WalletAddressField;
