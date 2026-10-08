import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BINANCE_API_MANAGEMENT_URL } from '@env';
import { Linking, Pressable } from 'react-native';
import { fetchAccount, saveCredentials } from '@kiko/crypto-sync/binance';

import Box from '../box';
import Text from '../text';
import Button from '../button';
import ClipboardTextField from '../clipboard-text-field';
import SyncStatusLine, { type SyncStatus } from '../sync-status-line';

import { styles } from './binance-credentials-field.styles';

type BinanceCredentialsFieldProps = {
  // The account this field's credentials belong to. The pair is a PER-ACCOUNT
  // Keychain item, so the Save write is keyed by this id — a second Binance
  // account stores and reads its own credentials.
  accountId: string;
  /**
   * Runs the Binance Connect sync once the pair is verified and stored; resolves whether it
   * succeeded.
   */
  onConnect: () => Promise<boolean>;
};

type Field = 'apiKey' | 'secret';

// The Binance counterpart of the Monobank token field: two secure inputs for a
// read-only ("Enable Reading" only) key pair. Connect verifies the pair with one
// account call BEFORE it is written to the biometric Keychain, then runs the
// first sync. The pair never leaves this component except into `saveCredentials`.
const BinanceCredentialsField: FC<BinanceCredentialsFieldProps> = ({ accountId, onConnect }) => {
  const { t } = useTranslation();
  const [apiKey, setAPIKey] = useState('');
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });
  // Shown only after a Connect press finds either field blank — Connect is
  // always enabled now (kiko-code-style's form validation model), so this
  // gates each field's OWN required reason (computed from only its own
  // value) rather than a standing disabled state.
  const [attemptedConnect, setAttemptedConnect] = useState(false);
  const apiKeyError =
    attemptedConnect && apiKey.trim() === '' ? t('accountDetail.apiKeyRequiredError') : undefined;
  const secretError =
    attemptedConnect && secret.trim() === '' ? t('accountDetail.secretRequiredError') : undefined;

  // Also runs on a clipboard paste (`ClipboardTextField` calls it with the
  // already-trimmed pasted value), so typing and pasting reset the stale
  // status identically.
  const setField = (field: Field, value: string): void => {
    if (field === 'apiKey') {
      setAPIKey(value);
    } else {
      setSecret(value);
    }

    setStatus({ kind: 'idle' });
  };

  const handleOpenBinance = (): void => {
    Linking.openURL(BINANCE_API_MANAGEMENT_URL);
  };

  const handleConnect = (): void => {
    if (apiKey.trim() === '' || secret.trim() === '') {
      setAttemptedConnect(true);

      return;
    }

    setStatus({ kind: 'checking' });
    // Every step catches into a status, and onConnect (the shared sync action) never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    (async () => {
      try {
        await fetchAccount(apiKey, secret);
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidApiKeyOrSecret') });

        return;
      }

      try {
        await saveCredentials(accountId, { apiKey, secret });
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
        <Text variant="body" tone="accent">
          {t('accountDetail.openBinanceLink')}
        </Text>
      </Pressable>

      <ClipboardTextField
        label={t('accountDetail.apiKeyLabel')}
        value={apiKey}
        onChangeText={(value) => setField('apiKey', value)}
        placeholder={t('accountDetail.binanceApiKeyPlaceholder')}
        pasteAccessibilityLabel={t('accountDetail.pasteApiKey')}
        secureTextEntry
        error={apiKeyError}
      />

      <ClipboardTextField
        label={t('accountDetail.apiSecretLabel')}
        value={secret}
        onChangeText={(value) => setField('secret', value)}
        placeholder={t('accountDetail.binanceApiSecretPlaceholder')}
        pasteAccessibilityLabel={t('accountDetail.pasteApiSecret')}
        secureTextEntry
        error={secretError}
      />

      {/* Guideline 5.6 data-handling disclosure: the key pair never leaves the
          device except straight to Binance's own API. */}
      <Text variant="caption" tone="textSecondary">
        {t('accountDetail.binanceKeychainDisclosure')}
      </Text>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking'}
          icon="lock"
        >
          {t('accountDetail.connectBinance')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default BinanceCredentialsField;
