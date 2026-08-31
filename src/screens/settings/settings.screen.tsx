import Clipboard from '@react-native-clipboard/clipboard';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Linking, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencySwitch from '../../design-system/components/currency-switch';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { fetchClientInfo } from '../../monobank/monobank.client';
import { readToken, saveToken } from '../../monobank/token';
import { settingsRepo } from '../../repositories/settings.repo';
import { styles } from './settings.styles';

const MONOBANK_API_URL = 'https://api.monobank.ua/';

type TokenStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'success'; name: string }
  | { kind: 'invalid' }
  | { kind: 'saveError' };

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : new Date(lastSyncAt).toLocaleString();

const SettingsScreen: FC = () => {
  const { theme } = useUnistyles();
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);
  const [token, setToken] = useState('');
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>({ kind: 'idle' });
  const hasUserEditedToken = useRef(false);

  useEffect(() => {
    let alive = true;
    void readToken().then(existing => {
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

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
  };

  const handleOpenMonobank = (): void => {
    void Linking.openURL(MONOBANK_API_URL);
  };

  const handlePasteToken = (): void => {
    void Clipboard.getString().then(value => {
      hasUserEditedToken.current = true;
      setToken(value.trim());
      setTokenStatus({ kind: 'idle' });
    });
  };

  const handleSaveToken = (): void => {
    setTokenStatus({ kind: 'checking' });
    void (async () => {
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

  return (
    <Screen>
      <Box gap={4}>
        <Box gap={2}>
          <Text variant="caption" tone="textSecondary">
            Base currency
          </Text>
          <Box style={styles.card}>
            <Box style={[styles.row, styles.rowLast]}>
              <CurrencySwitch selected={settings?.baseCurrency} onSelect={handleSelectCurrency} />
            </Box>
          </Box>
        </Box>

        <Box gap={2}>
          <Text variant="caption" tone="textSecondary">
            Monobank token
          </Text>
          <Box style={styles.card}>
            <Box direction="row" gap={2} style={styles.row}>
              <PressableButton
                onPress={handleOpenMonobank}
                backgroundColor={theme.colors.surfaceHigh}
                alignSelf="flex-start"
              >
                <Text variant="body">Open api.monobank.ua</Text>
              </PressableButton>
              <PressableButton
                onPress={handlePasteToken}
                backgroundColor={theme.colors.surfaceHigh}
                alignSelf="flex-start"
              >
                <Text variant="body">Paste from clipboard</Text>
              </PressableButton>
            </Box>
            <Box style={styles.row}>
              <TextInput
                value={token}
                onChangeText={handleChangeToken}
                placeholder="Monobank token"
                placeholderTextColor={theme.colors.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.tokenInput}
              />
            </Box>
            <Box gap={2} style={[styles.row, styles.rowLast]}>
              <PressableButton
                onPress={handleSaveToken}
                backgroundColor={theme.colors.surfaceHigh}
                alignSelf="flex-start"
                disabled={tokenStatus.kind === 'checking'}
              >
                <Text variant="body">Save</Text>
              </PressableButton>
              {tokenStatus.kind === 'checking' && (
                <Text variant="body" tone="textSecondary">
                  Checking…
                </Text>
              )}
              {tokenStatus.kind === 'success' && (
                <Text variant="body" tone="positive">
                  Connected as {tokenStatus.name}
                </Text>
              )}
              {tokenStatus.kind === 'invalid' && (
                <Text variant="body" tone="negative">
                  Invalid token
                </Text>
              )}
              {tokenStatus.kind === 'saveError' && (
                <Text variant="body" tone="negative">
                  Could not save token
                </Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box gap={2}>
          <Text variant="caption" tone="textSecondary">
            Sync status
          </Text>
          <Box style={styles.card}>
            <Box style={[styles.row, styles.rowLast]}>
              <Text variant="body" tone="textSecondary">
                Last sync: {formatLastSyncAt(settings?.lastSyncAt ?? null)}
              </Text>
            </Box>
          </Box>
        </Box>
      </Box>
    </Screen>
  );
};

export default SettingsScreen;
