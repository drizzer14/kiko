import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencySwitch from '../../design-system/components/currency-switch';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { readToken, saveToken } from '../../monobank/token';
import { settingsRepo } from '../../repositories/settings.repo';
import { styles } from './settings.styles';

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : new Date(lastSyncAt).toLocaleString();

const SettingsScreen: FC = () => {
  const { theme } = useUnistyles();
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);
  const [token, setToken] = useState('');
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
  };

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
  };

  const handleSaveToken = (): void => {
    void saveToken(token);
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
            <Box style={[styles.row, styles.rowLast]}>
              <PressableButton
                onPress={handleSaveToken}
                backgroundColor={theme.colors.surfaceHigh}
                alignSelf="flex-start"
              >
                <Text variant="body">Save</Text>
              </PressableButton>
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
