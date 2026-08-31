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
  | { kind: 'error' };

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

  const markEdited = (): void => {
    hasUserEditedToken.current = true;
  };

  const handleChangeToken = (value: string): void => {
    markEdited();
    setToken(value);
  };

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
  };

  const handleOpenMonobank = (): void => {
    void Linking.openURL(MONOBANK_API_URL);
  };

  const handlePasteToken = (): void => {
    void Clipboard.getString().then(value => {
      markEdited();
      setToken(value);
    });
  };

  const handleSaveToken = (): void => {
    setTokenStatus({ kind: 'checking' });
    void fetchClientInfo(token)
      .then(clientInfo => {
        setTokenStatus({ kind: 'success', name: clientInfo.name });
        return saveToken(token);
      })
      .catch(() => {
        setTokenStatus({ kind: 'error' });
      });
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
              {tokenStatus.kind === 'success' && (
                <Text variant="body" tone="positive">
                  Connected as {tokenStatus.name}
                </Text>
              )}
              {tokenStatus.kind === 'error' && (
                <Text variant="body" tone="negative">
                  Invalid token
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
