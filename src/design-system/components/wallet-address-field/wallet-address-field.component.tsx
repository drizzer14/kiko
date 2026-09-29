import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidBitcoinAddress } from '@kiko/crypto-sync/btc-wallet';

import Box from '../box';
import Button from '../button';
import ClipboardTextField from '../clipboard-text-field';
import SyncStatusLine, { type SyncStatus } from '../sync-status-line';

import { styles } from './wallet-address-field.styles';

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
  // Shown only after a Connect press finds a blank address — Connect is
  // always enabled now (kiko-code-style's form validation model), so this
  // surfaces the address-required reason on press rather than a standing
  // disabled state.
  const [showAddressRequiredError, setShowAddressRequiredError] = useState(false);

  // Also runs on a clipboard paste (`ClipboardTextField` calls it with the
  // already-trimmed pasted value), so typing and pasting reset the stale
  // status identically.
  const handleChangeAddress = (value: string): void => {
    setAddress(value);
    setStatus({ kind: 'idle' });
    setShowAddressRequiredError(false);
  };

  const handleConnect = (): void => {
    const trimmed = address.trim();

    if (trimmed === '') {
      setShowAddressRequiredError(true);

      return;
    }

    if (!isValidBitcoinAddress(trimmed)) {
      setStatus({ kind: 'invalid', message: t('accountDetail.invalidBTCAddress') });

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
      <ClipboardTextField
        label={t('accountDetail.addressLabel')}
        value={address}
        onChangeText={handleChangeAddress}
        placeholder={t('accountDetail.btcAddressPlaceholder')}
        pasteAccessibilityLabel={t('accountDetail.pasteFromClipboard')}
        error={showAddressRequiredError ? t('accountDetail.walletAddressRequiredError') : undefined}
      />

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking'}
          icon="lock"
        >
          {t('accountDetail.connectWallet')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default WalletAddressField;
