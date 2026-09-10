import { type FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import Text from '../../../design-system/components/text';
import { fetchClientInfo } from '../../../monobank/monobank.client';
import { hasToken, saveToken } from '../../../monobank/token';
import { styles } from '../account-detail.styles';
import MonobankTokenInput from '../monobank-token-input';
import type { SyncStatus } from '../sync-status-line';
import SyncStatusLine from '../sync-status-line';

type MonobankTokenFieldProps = {
  // True once the account is connected/synced to Monobank. The token-entry
  // controls only make sense before that, so they hide once it flips true.
  isConnected: boolean;
};

// The Monobank token belongs with the bank account, not global Settings:
// entry, the Open/Paste helpers, a validated Save, and the result status all
// live here. The link + token input + paste icon come from the shared
// `MonobankTokenInput` (also used by the add-account create form so the two
// entry surfaces stay identical); this component adds the edit-surface-only
// Save + result status around it. Persists through the same Keychain path
// (`saveToken`). Once the account is connected, the token-entry controls (link,
// input, Save) disappear — the Connect/Sync/Disconnect actions live on the
// parent account-detail screen instead.
const MonobankTokenField: FC<MonobankTokenFieldProps> = ({ isConnected }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [isTokenSaved, setIsTokenSaved] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<SyncStatus>({ kind: 'idle' });

  // SECURITY: a stored token is never read back into state — only its existence
  // is. Prefilling a `secureTextEntry` field with the real secret displays
  // nothing to the user and parks the bank token in the React tree for anything
  // that can read the JS heap. Changing the token means re-entering it.
  // Skipped entirely once connected: this branch renders no input at all.
  useEffect(() => {
    if (isConnected) {
      return;
    }

    let alive = true;
    hasToken().then((exists) => {
      if (alive) {
        setIsTokenSaved(exists);
      }
    });

    return () => {
      alive = false;
    };
  }, [isConnected]);

  const handleChangeToken = (value: string): void => {
    setToken(value);
    setTokenStatus({ kind: 'idle' });
  };

  const handleSaveToken = (): void => {
    setTokenStatus({ kind: 'checking' });
    (async () => {
      let clientName: string;
      try {
        const clientInfo = await fetchClientInfo(token);
        clientName = clientInfo.name;
      } catch {
        setTokenStatus({ kind: 'invalid', message: t('accountDetail.invalidToken') });

        return;
      }

      try {
        await saveToken(token);
        setToken('');
        setIsTokenSaved(true);
        setTokenStatus({
          kind: 'success',
          message: t('accountDetail.connectedAs', { name: clientName }),
        });
      } catch {
        setTokenStatus({ kind: 'saveError', message: t('accountDetail.couldNotSaveToken') });
      }
    })();
  };

  // Once connected, only the section heading remains — the token has already
  // been accepted and stored, so the link/input/Save entry controls no longer
  // apply. Re-entry runs through Disconnect on the parent screen first.
  if (isConnected) {
    return (
      <Box gap={3}>
        <Text variant="heading">{t('accountDetail.synchronization')}</Text>
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">{t('accountDetail.synchronization')}</Text>

      {isTokenSaved ? (
        <Text variant="caption" tone="textSecondary">
          {t('accountDetail.tokenSaved')}
        </Text>
      ) : null}

      <MonobankTokenInput value={token} onChangeText={handleChangeToken} />

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondaryTonal"
          size="small"
          fullWidth={false}
          onPress={handleSaveToken}
          disabled={tokenStatus.kind === 'checking' || token.trim() === ''}
          icon="checkmark.circle"
        >
          {t('common.save')}
        </Button>

        <SyncStatusLine status={tokenStatus} />
      </Box>
    </Box>
  );
};

export default MonobankTokenField;
