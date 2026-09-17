import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import Clipboard from '@react-native-clipboard/clipboard';

import SyncStatusLine from '../sync-status-line';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import Button from '../../../design-system/components/button';
import TextField from '../../../design-system/components/text-field';

type BunqConnectFieldProps = {
  // Runs the connect: store the entered API key to the Keychain (keyed by
  // the account id the screen owns) and start the first bunq sync (which
  // itself runs the handshake and validates the key). Resolves whether it
  // succeeded. The field passes the RAW key here and holds it only for the
  // duration of this call — never to the DB or a log.
  onConnect: (apiKey: string) => Promise<boolean>;
};

// The bunq counterpart of PrivatbankConnectField: ONE secure input (an API
// key), same single-field shape as PrivatBank's own token, plus the "create
// the API key" notice, an explicit Connect button, and a live status line.
// UNLIKE Monobank/PrivatBank, this field does NOT
// pre-validate the key with a side-effect-free call before handing it to
// `onConnect`: bunq has no such call — every real request needs an actual
// session (the handshake itself), and re-running it twice in a row would
// burn `/session-server`'s own strict rate limit (~1 req/30s) for nothing.
// So Connect hands the raw key straight to `onConnect`, which stores it and
// runs the first sync; that sync's own success/failure IS the validation,
// surfaced through the SAME status line. The field owns no account id and
// writes no Keychain item itself — the key's storage stays in the screen
// closure keyed by the pre-generated account id, so a validated-but-
// unstorable key surfaces as a `false` result here rather than an
// unhandled rejection.
const BunqConnectField: FC<BunqConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeApiKey = (value: string): void => {
    setApiKey(value);
    setStatus({ kind: 'idle' });
  };

  const handlePaste = (): void => {
    Clipboard.getString().then((value) => {
      handleChangeApiKey(value.trim());
    });
  };

  const handleConnect = (): void => {
    const trimmed = apiKey.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      const connected = await onConnect(trimmed);

      if (connected) {
        // SECURITY: drop the raw key from state once connected so the bank
        // secret is not parked in the React tree.
        setApiKey('');
        setStatus({ kind: 'success', message: t('accountDetail.bunqConnected') });

        return;
      }

      // On failure the user keeps the entered key to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectBunq') });
    })();
  };

  return (
    <Box gap={3}>
      <Text variant="body" tone="textSecondary">
        {t('accountDetail.bunqApiKeyNotice')}
      </Text>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.apiKeyLabel')}
            value={apiKey}
            onChangeText={handleChangeApiKey}
            placeholder={t('accountDetail.bunqApiKeyPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>

        <Button
          variant="ghost"
          size="small"
          fullWidth={false}
          icon="document.on.clipboard"
          textColor={theme.colors.textSecondary}
          accessibilityLabel={t('accountDetail.pasteBunqApiKey')}
          onPress={handlePaste}
        />
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking' || apiKey.trim() === ''}
          icon="lock"
        >
          {t('accountDetail.connectBunq')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default BunqConnectField;
