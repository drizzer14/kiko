import { match } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import { BINANCE_API_MANAGEMENT_URL } from '@env';
import { type FC, useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { useIsMounted } from '@kiko/design-system/use-is-mounted';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';
import { type BinanceCredentials, fetchAccount, saveCredentials } from '@kiko/crypto-sync/binance';

import Box from '../box';
import Text from '../text';
import Button from '../button';
import InfoHint from '../info-hint';
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
   * succeeded. Receives the pair it stored, so a caller that gives up can clear that pair and no
   * other.
   */
  onConnect: (stored: BinanceCredentials) => Promise<boolean>;
  // Lets a form that saves without this connection remind the user to press Connect first.
  reminder?: ConnectReminder;
  /**
   * Runs instead of `onConnect` when the field unmounted during the Keychain write that stored the
   * verified pair, so the screen that owns the account decides what happens to the pair; it must
   * not reject. It receives the pair this field stored, held in memory only for as long as it runs.
   * Without it the pair stays where it was stored.
   */
  onStoredWhileUnmounted?: (stored: BinanceCredentials) => Promise<void>;
};

type Field = 'apiKey' | 'secret';

type StoreOutcome = 'stored' | 'saveError' | 'unmounted' | 'storedWhileUnmounted';

// Stores a verified pair unless the field is gone, and says whether the connect may go on. A fold
// or a kind switch removes the field during the check or the write. Gone before the write, nothing
// is stored: a key under an account id nothing connects would be left behind. Gone during the
// write, the pair is stored and reported through onStoredWhileUnmounted, because the screen that
// owns the account decides its fate. Either way connecting is skipped: it would insert the account
// row after the form that replaced this one already decided what to write.
const storePair = async (
  accountId: string,
  credentials: BinanceCredentials,
  isMounted: () => boolean,
): Promise<StoreOutcome> => {
  if (!isMounted()) {
    return 'unmounted';
  }

  try {
    await saveCredentials(accountId, credentials);
  } catch {
    return 'saveError';
  }

  return isMounted() ? 'stored' : 'storedWhileUnmounted';
};

// The Binance counterpart of the Monobank token field: two secure inputs for a
// read-only ("Enable Reading" only) key pair. Connect verifies the pair with one
// account call BEFORE it is written to the biometric Keychain, then runs the
// first sync. The pair never leaves this component except into `saveCredentials`.
const BinanceCredentialsField: FC<BinanceCredentialsFieldProps> = ({
  accountId,
  onConnect,
  reminder,
  onStoredWhileUnmounted,
}) => {
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
  const onDraftChange = reminder?.onDraftChange;
  const isMounted = useIsMounted();

  // The typed pair goes with the field, so a draft it reported must not outlive it.
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

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

    // Either input alone is a draft, so the other one's current text counts too.
    const otherValue = field === 'apiKey' ? secret : apiKey;
    onDraftChange?.(value.trim() !== '' || otherValue.trim() !== '');
  };

  const handleOpenBinance = (): void => {
    Linking.openURL(BINANCE_API_MANAGEMENT_URL);
  };

  const connectStoredPair = async (credentials: BinanceCredentials): Promise<void> => {
    const connected = await onConnect(credentials);

    if (connected) {
      // A connected pair is not an unsaved draft; editing it again makes it one.
      onDraftChange?.(false);
    }

    setStatus(
      connected
        ? { kind: 'success', message: t('accountDetail.binanceConnected') }
        : { kind: 'saveError', message: t('accountDetail.couldNotConnectBinance') },
    );
  };

  const handleConnect = (): void => {
    reminder?.onConnectPress();

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

      const credentials = { apiKey, secret };
      const stored = await storePair(accountId, credentials, isMounted);

      await match(stored)
        .with('saveError', async () =>
          setStatus({ kind: 'saveError', message: t('accountDetail.couldNotSaveCredentials') }),
        )
        .with('storedWhileUnmounted', async () => onStoredWhileUnmounted?.(credentials))
        .with('unmounted', async () => undefined)
        .with('stored', async () => connectStoredPair(credentials))
        .exhaustive();
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

      <View ref={reminder?.ref}>
        <Box gap={2}>
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

          {reminder?.message !== undefined && <InfoHint message={reminder.message} />}
        </Box>
      </View>
    </Box>
  );
};

export default BinanceCredentialsField;
