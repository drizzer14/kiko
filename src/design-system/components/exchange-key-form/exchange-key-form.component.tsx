import { match } from 'ts-pattern';
import { useTranslation } from 'react-i18next';
import { Keyboard, Linking, Pressable, View } from 'react-native';
import { useIsMounted } from '@kiko/design-system/use-is-mounted';
import { type FC, type ReactNode, useEffect, useState } from 'react';
import type { ConnectReminder } from '@kiko/design-system/connect-reminder';
import type { ExchangeCredentials, WriteToken } from '@kiko/crypto-sync/exchange/credentials';

import Box from '../box';
import Text from '../text';
import Button from '../button';
import InfoHint from '../info-hint';
import ErrorNotice from '../error-notice';
import ClipboardTextField from '../clipboard-text-field';
import SyncStatusLine, { type SyncStatus, syncErrorMessage } from '../sync-status-line';

import { styles } from './exchange-key-form.styles';

/** The words of one exchange's field, already translated: the form shares the rest. */
type ExchangeKeyFormCopy = {
  openLink: string;
  apiKeyPlaceholder: string;
  apiSecretPlaceholder: string;
  disclosure: string;
  connect: string;
  connected: string;
  couldNotConnect: string;
  coolingDown: string;
  syncStillRunning: string;
};

type ExchangeKeyFormProps = {
  // The account this field's credentials belong to. The pair is a PER-ACCOUNT
  // Keychain item, so the Save write is keyed by this id — a second account of the same
  // exchange stores and reads its own credentials.
  accountId: string;
  /**
   * Runs the Connect sync once the pair is verified and stored; resolves whether it succeeded.
   * Receives the token of the write that stored the pair, so a caller that gives up can clear that
   * write's pair and no other; the pair itself stays in this field.
   */
  onConnect: (stored: WriteToken) => Promise<boolean>;
  // Lets a form that saves without this connection remind the user to press Connect first.
  reminder?: ConnectReminder;
  /**
   * Runs instead of `onConnect` when the field unmounted during the Keychain write that stored the
   * verified pair, so the screen that owns the account decides what happens to the pair; it must
   * not reject. It receives the token of that write, which clears that write's pair and no other.
   * Without it the pair stays where it was stored.
   */
  onStoredWhileUnmounted?: (stored: WriteToken) => Promise<void>;
  copy: ExchangeKeyFormCopy;
  /** The exchange's page where the user makes a key. */
  managementUrl: string;
  /** Whether the account is inside a rate-limit cooldown at `now`. */
  isCoolingDown: (accountId: string, now: number) => boolean;
  /** Whether a sync of the account is in flight. */
  isSyncRunning: (accountId: string) => boolean;
  /**
   * Checks the pair BEFORE it is stored, by a read of the exchange: the text that refuses it, or
   * `undefined` when it may be stored. It must not reject.
   */
  verify: (apiKey: string, secret: string) => Promise<string | undefined>;
  /** Stores the verified pair in the Keychain and resolves the token of that write. */
  save: (accountId: string, credentials: ExchangeCredentials) => Promise<WriteToken>;
  /** What the exchange tells the user above the inputs. */
  intro?: ReactNode;
};

type Field = 'apiKey' | 'secret';

type StoreOutcome =
  | { kind: 'saveError' }
  | { kind: 'unmounted' }
  | { kind: 'stored'; token: WriteToken }
  | { kind: 'storedWhileUnmounted'; token: WriteToken };

// Stores a verified pair unless the field is gone, and says whether the connect may go on. A fold
// or a kind switch removes the field during the check or the write. Gone before the write, nothing
// is stored: a key under an account id nothing connects would be left behind. Gone during the
// write, the pair is stored and its write token is reported through onStoredWhileUnmounted, because
// the screen that owns the account decides its fate. Either way connecting is skipped: it would
// insert the account row after the form that replaced this one already decided what to write.
const storePair = async (
  save: ExchangeKeyFormProps['save'],
  accountId: string,
  credentials: ExchangeCredentials,
  isMounted: () => boolean,
): Promise<StoreOutcome> => {
  if (!isMounted()) {
    return { kind: 'unmounted' };
  }

  try {
    const token = await save(accountId, credentials);

    return isMounted() ? { kind: 'stored', token } : { kind: 'storedWhileUnmounted', token };
  } catch {
    return { kind: 'saveError' };
  }
};

// The two-input form of an exchange's read-only API key pair, shared by each exchange's field.
// Connect verifies the pair with the exchange's own read BEFORE it is written to the biometric
// Keychain, then runs the first sync. The pair never leaves this component except into `verify` and
// `save`; the callbacks get only the token of that write.
const ExchangeKeyForm: FC<ExchangeKeyFormProps> = ({
  accountId,
  onConnect,
  reminder,
  onStoredWhileUnmounted,
  copy,
  managementUrl,
  isCoolingDown,
  isSyncRunning,
  verify,
  save,
  intro,
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
  const errorMessage = syncErrorMessage(status);

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

  const handleOpenLink = (): void => {
    Linking.openURL(managementUrl);
  };

  const connectStoredPair = async (token: WriteToken): Promise<void> => {
    const connected = await onConnect(token);

    if (connected) {
      // A connected pair is not an unsaved draft; editing it again makes it one.
      onDraftChange?.(false);
    }

    setStatus(
      connected
        ? { kind: 'success', message: copy.connected }
        : { kind: 'saveError', message: copy.couldNotConnect },
    );
  };

  const handleConnect = (): void => {
    // Connect submits like Return, and a notice under the row can sit under the keyboard.
    Keyboard.dismiss();
    reminder?.onConnectPress();

    if (apiKey.trim() === '' || secret.trim() === '') {
      setAttemptedConnect(true);

      return;
    }

    // A cooling account makes no request: the sync would skip quietly and the field would report a
    // connection it never read.
    if (isCoolingDown(accountId, Date.now())) {
      setStatus({ kind: 'saveError', message: copy.coolingDown });

      return;
    }

    // A running sync of this account holds the pair of an earlier connection, and the sync's join
    // would hand this Connect that run: it would report a connection it never read.
    if (isSyncRunning(accountId)) {
      setStatus({ kind: 'saveError', message: copy.syncStillRunning });

      return;
    }

    setStatus({ kind: 'checking' });
    // Every step catches into a status, and onConnect (the shared sync action) never rejects.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function)
    (async () => {
      const refusal = await verify(apiKey, secret);

      if (refusal !== undefined) {
        setStatus({ kind: 'invalid', message: refusal });

        return;
      }

      const stored = await storePair(save, accountId, { apiKey, secret }, isMounted);

      await match(stored)
        .with({ kind: 'saveError' }, async () =>
          setStatus({ kind: 'saveError', message: t('accountDetail.couldNotSaveCredentials') }),
        )
        .with({ kind: 'storedWhileUnmounted' }, async ({ token }) =>
          onStoredWhileUnmounted?.(token),
        )
        .with({ kind: 'unmounted' }, async () => undefined)
        .with({ kind: 'stored' }, async ({ token }) => connectStoredPair(token))
        .exhaustive();
    })();
  };

  return (
    <Box gap={3}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={copy.openLink}
        onPress={handleOpenLink}
        style={styles.linkPressable}
      >
        <Text variant="body" tone="accent">
          {copy.openLink}
        </Text>
      </Pressable>

      {intro}

      <ClipboardTextField
        label={t('accountDetail.apiKeyLabel')}
        value={apiKey}
        onChangeText={(value) => setField('apiKey', value)}
        placeholder={copy.apiKeyPlaceholder}
        pasteAccessibilityLabel={t('accountDetail.pasteApiKey')}
        secureTextEntry
        error={apiKeyError}
      />

      <ClipboardTextField
        label={t('accountDetail.apiSecretLabel')}
        value={secret}
        onChangeText={(value) => setField('secret', value)}
        placeholder={copy.apiSecretPlaceholder}
        pasteAccessibilityLabel={t('accountDetail.pasteApiSecret')}
        secureTextEntry
        error={secretError}
      />

      {/* Guideline 5.1.1 / 5.1.2 data-handling disclosure: the key pair never leaves the
          device except straight to the exchange's own API. */}
      <Text variant="caption" tone="textSecondary">
        {copy.disclosure}
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
              {copy.connect}
            </Button>

            <SyncStatusLine status={status} />
          </Box>

          {errorMessage !== undefined && <ErrorNotice message={errorMessage} />}

          {reminder?.message !== undefined && <InfoHint message={reminder.message} />}
        </Box>
      </View>
    </Box>
  );
};

export default ExchangeKeyForm;
