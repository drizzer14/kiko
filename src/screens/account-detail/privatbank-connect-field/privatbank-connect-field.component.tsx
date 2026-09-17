import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnistyles } from 'react-native-unistyles';
import Clipboard from '@react-native-clipboard/clipboard';

import SyncStatusLine from '../sync-status-line';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import Box from '../../../design-system/components/box';
import Text from '../../../design-system/components/text';
import { fetchAccounts } from '../../../privatbank/client';
import Button from '../../../design-system/components/button';
import TextField from '../../../design-system/components/text-field';

type PrivatbankConnectFieldProps = {
  // Runs the connect: store the validated token+clientId to the Keychain
  // (keyed by the account id the screen owns) and start the first PrivatBank
  // sync. Resolves whether it succeeded. The field passes the RAW pair here
  // and holds it only for the duration of this call — never to the DB or a
  // log.
  onConnect: (token: string, clientId: string) => Promise<boolean>;
};

type Field = 'token' | 'clientId';

// The PrivatBank counterpart of MonobankConnectField: two secure inputs (a
// token and a client id, mirroring `BinanceCredentialsField`'s two-field
// shape rather than Monobank's single token) plus the FOP eligibility notice,
// an explicit Connect button, and a live status line. It validates the pair
// in place with `fetchAccounts` BEFORE handing the RAW pair to `onConnect`,
// which stores it and starts the sync. The field owns no account id and
// writes no Keychain item itself — the pair's storage stays in the screen
// closure keyed by the pre-generated account id, so a validated-but-
// unstorable pair surfaces as a `false` result here rather than an
// unhandled rejection.
const PrivatbankConnectField: FC<PrivatbankConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [token, setToken] = useState('');
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const setField = (field: Field, value: string): void => {
    if (field === 'token') {
      setToken(value);
    } else {
      setClientId(value);
    }

    setStatus({ kind: 'idle' });
  };

  const handlePaste = (field: Field): void => {
    Clipboard.getString().then((value) => {
      setField(field, value.trim());
    });
  };

  const handleConnect = (): void => {
    const trimmedToken = token.trim();
    const trimmedClientId = clientId.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      try {
        await fetchAccounts({ token: trimmedToken, clientId: trimmedClientId });
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidPrivatbankCredentials') });

        return;
      }

      const connected = await onConnect(trimmedToken, trimmedClientId);
      if (connected) {
        // SECURITY: drop the raw pair from state once connected so the bank
        // secret is not parked in the React tree.
        setToken('');
        setClientId('');
        setStatus({ kind: 'success', message: t('accountDetail.privatbankConnected') });

        return;
      }

      // On failure the user keeps the entered pair to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectPrivatbank') });
    })();
  };

  return (
    <Box gap={3}>
      <Text variant="body" tone="textSecondary">
        {t('accountDetail.privatbankFopNotice')}
      </Text>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.tokenLabel')}
            value={token}
            onChangeText={(value) => setField('token', value)}
            placeholder={t('accountDetail.privatbankTokenPlaceholder')}
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
          accessibilityLabel={t('accountDetail.pastePrivatbankToken')}
          onPress={() => handlePaste('token')}
        />
      </Box>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.clientIdLabel')}
            value={clientId}
            onChangeText={(value) => setField('clientId', value)}
            placeholder={t('accountDetail.privatbankClientIdPlaceholder')}
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
          accessibilityLabel={t('accountDetail.pastePrivatbankClientId')}
          onPress={() => handlePaste('clientId')}
        />
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking' || token.trim() === '' || clientId.trim() === ''}
          icon="lock"
        >
          {t('accountDetail.connectPrivatbank')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default PrivatbankConnectField;
