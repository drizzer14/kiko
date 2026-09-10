import { BINANCE_API_MANAGEMENT_URL } from '@env';
import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text as RNText } from 'react-native';

import { fetchAccount } from '../../../crypto-sync/binance/binance.client';
import { saveCredentials } from '../../../crypto-sync/binance/binance.credentials';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import TextField from '../../../design-system/components/text-field';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import SyncStatusLine from '../sync-status-line';

type BinanceCredentialsFieldProps = {
  /** Runs the Binance Connect sync once the pair is verified and stored; resolves whether it succeeded. */
  onConnect: () => Promise<boolean>;
};

type Field = 'apiKey' | 'secret';

// The Binance counterpart of the Monobank token field: two secure inputs for a
// read-only ("Enable Reading" only) key pair. Connect verifies the pair with one
// account call BEFORE it is written to the biometric Keychain, then runs the
// first sync. The pair never leaves this component except into `saveCredentials`.
const BinanceCredentialsField: FC<BinanceCredentialsFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [apiKey, setAPIKey] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const setField = (field: Field, value: string): void => {
    if (field === 'apiKey') {
      setAPIKey(value);
    } else {
      setSecret(value);
    }

    setStatus({ kind: 'idle' });
  };

  const handlePaste = (field: Field): void => {
    Clipboard.getString().then((value) => {
      setField(field, value.trim());
    });
  };

  const handleOpenBinance = (): void => {
    Linking.openURL(BINANCE_API_MANAGEMENT_URL);
  };

  const handleConnect = (): void => {
    setStatus({ kind: 'checking' });
    (async () => {
      try {
        await fetchAccount(apiKey, secret);
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidApiKeyOrSecret') });

        return;
      }

      try {
        await saveCredentials({ apiKey, secret });
      } catch {
        setStatus({ kind: 'saveError', message: t('accountDetail.couldNotSaveCredentials') });

        return;
      }

      const connected = await onConnect();
      setStatus(
        connected
          ? { kind: 'success', message: t('accountDetail.binanceConnected') }
          : { kind: 'saveError', message: t('accountDetail.couldNotConnectBinance') },
      );
    })();
  };

  return (
    <Box gap={3}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('accountDetail.openBinanceLink')}
        onPress={handleOpenBinance}
        style={styles.linkPressable}
      >
        <RNText style={styles.link}>{t('accountDetail.openBinanceLink')}</RNText>
      </Pressable>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.apiKeyLabel')}
            value={apiKey}
            onChangeText={(value) => setField('apiKey', value)}
            placeholder={t('accountDetail.binanceApiKeyPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountDetail.pasteApiKey')}
          onPress={() => handlePaste('apiKey')}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.apiSecretLabel')}
            value={secret}
            onChangeText={(value) => setField('secret', value)}
            placeholder={t('accountDetail.binanceApiSecretPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountDetail.pasteApiSecret')}
          onPress={() => handlePaste('secret')}
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
          disabled={status.kind === 'checking' || apiKey.trim() === '' || secret.trim() === ''}
          icon="link"
        >
          {t('accountDetail.connectBinance')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default BinanceCredentialsField;
