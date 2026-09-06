import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, Text as RNText } from 'react-native';

import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import TextField from '../../../design-system/components/text-field';
import { fetchClientInfo } from '../../../monobank/monobank.client';
import { readToken, saveToken } from '../../../monobank/token';
import { styles } from '../account-detail.styles';
import type { SyncStatus } from '../sync-status-line';
import SyncStatusLine from '../sync-status-line';

const MONOBANK_API_URL = 'https://api.monobank.ua/';

type MonobankTokenFieldProps = {
  // True once the account is connected/synced to Monobank. The token-entry
  // controls only make sense before that, so they hide once it flips true.
  isConnected: boolean;
};

// The Monobank token belongs with the bank account, not global Settings:
// entry, the Open/Paste helpers, a validated Save, and the result status all
// live here. Persists through the same Keychain path (`saveToken`), so only
// the token's location in the UI moved. Once the account is connected, the
// token-entry controls (link, input, Save) disappear — the Connect/Sync/
// Disconnect actions live on the parent account-detail screen instead.
const MonobankTokenField: FC<MonobankTokenFieldProps> = ({ isConnected }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<SyncStatus>({ kind: 'idle' });
  const hasUserEditedToken = useRef(false);

  useEffect(() => {
    let alive = true;
    readToken().then((existing) => {
      if (alive && !hasUserEditedToken.current && existing !== undefined) {
        setToken(existing);
      }
    });

    return () => {
      alive = false;
    };
  }, []);

  const handleChangeToken = (value: string): void => {
    hasUserEditedToken.current = true;
    setToken(value);
    setTokenStatus({ kind: 'idle' });
  };

  const handleOpenMonobank = (): void => {
    Linking.openURL(MONOBANK_API_URL);
  };

  const handlePasteToken = (): void => {
    Clipboard.getString().then((value) => {
      hasUserEditedToken.current = true;
      setToken(value.trim());
      setTokenStatus({ kind: 'idle' });
    });
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

      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('accountDetail.openMonobankLink')}
        onPress={handleOpenMonobank}
        style={styles.linkPressable}
      >
        <RNText style={styles.link}>{t('accountDetail.openMonobankLink')}</RNText>
      </Pressable>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <Box style={styles.tokenFieldColumn}>
          <TextField
            label={t('accountDetail.tokenLabel')}
            value={token}
            onChangeText={handleChangeToken}
            placeholder={t('accountDetail.monobankTokenPlaceholder')}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Box>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('accountDetail.pasteFromClipboard')}
          onPress={handlePasteToken}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <Button
          variant="secondary"
          size="compact"
          fullWidth={false}
          onPress={handleSaveToken}
          disabled={tokenStatus.kind === 'checking'}
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
