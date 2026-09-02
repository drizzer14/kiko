import Clipboard from '@react-native-clipboard/clipboard';
import { type FC, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Text as RNText, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import Box from '../../design-system/components/box';
import PressableButton from '../../design-system/components/pressable-button';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { fetchClientInfo } from '../../monobank/monobank.client';
import { readToken, saveToken } from '../../monobank/token';
import { styles } from './account-detail.styles';

const MONOBANK_API_URL = 'https://api.monobank.ua/';

type TokenStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success'; name: string }
  | { kind: 'invalid' }
  | { kind: 'saveError' };

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
  const { theme } = useUnistyles();
  const [token, setToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>({ kind: 'idle' });
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
        setTokenStatus({ kind: 'invalid' });

        return;
      }

      try {
        await saveToken(token);
        setTokenStatus({ kind: 'success', name: clientName });
      } catch {
        setTokenStatus({ kind: 'saveError' });
      }
    })();
  };

  // Once connected, only the section heading remains — the token has already
  // been accepted and stored, so the link/input/Save entry controls no longer
  // apply. Re-entry runs through Disconnect on the parent screen first.
  if (isConnected) {
    return (
      <Box gap={3}>
        <Text variant="heading">Synchronization</Text>
      </Box>
    );
  }

  return (
    <Box gap={3}>
      <Text variant="heading">Synchronization</Text>

      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Open api.monobank.ua"
        onPress={handleOpenMonobank}
        style={styles.linkPressable}
      >
        <RNText style={styles.link}>Open api.monobank.ua</RNText>
      </Pressable>

      <Box direction="row" gap={3} style={styles.fieldRow}>
        <TextInput
          value={token}
          onChangeText={handleChangeToken}
          placeholder="Monobank token"
          placeholderTextColor={theme.colors.textSecondary}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.textField}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Paste from clipboard"
          onPress={handlePasteToken}
          style={styles.iconButton}
        >
          <SymbolIcon name="doc.on.clipboard" tone="textSecondary" />
        </Pressable>
      </Box>

      <Box direction="row" gap={2} style={styles.statusLine}>
        <PressableButton
          onPress={handleSaveToken}
          backgroundColor={theme.colors.surfaceHigh}
          alignSelf="flex-start"
          disabled={tokenStatus.kind === 'checking'}
          icon={<SymbolIcon name="checkmark.circle" tone="textPrimary" />}
          label="Save"
        />
        {tokenStatus.kind === 'checking' && (
          <Text variant="body" tone="textSecondary">
            Checking…
          </Text>
        )}
        {tokenStatus.kind === 'success' && (
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="checkmark.circle" tone="positive" />
            <Text variant="body" tone="positive">
              Connected as {tokenStatus.name}
            </Text>
          </Box>
        )}
        {tokenStatus.kind === 'invalid' && (
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="xmark.circle" tone="negative" />
            <Text variant="body" tone="negative">
              Invalid token
            </Text>
          </Box>
        )}
        {tokenStatus.kind === 'saveError' && (
          <Box direction="row" gap={2} style={styles.statusLine}>
            <SymbolIcon name="xmark.circle" tone="negative" />
            <Text variant="body" tone="negative">
              Could not save token
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default MonobankTokenField;
