import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SyncStatusLine from '../sync-status-line';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import Box from '../../../design-system/components/box';
import MonobankTokenInput from '../monobank-token-input';
import { fetchClientInfo } from '../../../monobank/client';
import Button from '../../../design-system/components/button';

type MonobankConnectFieldProps = {
  // Runs the connect: store the validated token to the Keychain (keyed by the
  // account id the screen owns) and start the first Monobank sync. Resolves
  // whether it succeeded. The field passes the RAW token here and holds it only
  // for the duration of this call — never to the DB or a log.
  onConnect: (token: string) => Promise<boolean>;
};

// The bank-create counterpart of WalletAddressField: the shared MonobankTokenInput
// (link + secure token field + paste icon) plus an explicit Connect button and a
// live status line. It validates the token in place with fetchClientInfo (so it
// can show "Connected as {name}") and then hands the RAW token to `onConnect`,
// which stores it and starts the sync. The field owns no account id and writes no
// Keychain item itself — the secret's storage stays in the screen closure keyed by
// the pre-generated account id, so a validated-but-unstorable token surfaces as a
// `false` result here rather than an unhandled rejection.
const MonobankConnectField: FC<MonobankConnectFieldProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<SyncStatus>({ kind: 'idle' });

  const handleChangeToken = (value: string): void => {
    setToken(value);
    setStatus({ kind: 'idle' });
  };

  const handleConnect = (): void => {
    const trimmed = token.trim();
    setStatus({ kind: 'checking' });
    (async () => {
      let clientName: string;
      try {
        const clientInfo = await fetchClientInfo(trimmed);
        clientName = clientInfo.name;
      } catch {
        setStatus({ kind: 'invalid', message: t('accountDetail.invalidToken') });

        return;
      }

      const connected = await onConnect(trimmed);
      if (connected) {
        // SECURITY: drop the raw token from state once connected so the bank
        // secret is not parked in the React tree (matches MonobankTokenField).
        setToken('');
        setStatus({
          kind: 'success',
          message: t('accountDetail.connectedAs', { name: clientName }),
        });

        return;
      }

      // On failure the user keeps the entered token to retry, so it stays in state.
      setStatus({ kind: 'saveError', message: t('accountDetail.couldNotConnectMonobank') });
    })();
  };

  return (
    <Box gap={3}>
      <MonobankTokenInput value={token} onChangeText={handleChangeToken} />

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleConnect}
          disabled={status.kind === 'checking' || token.trim() === ''}
          icon="link"
        >
          {t('accountDetail.connectMonobank')}
        </Button>

        <SyncStatusLine status={status} />
      </Box>
    </Box>
  );
};

export default MonobankConnectField;
