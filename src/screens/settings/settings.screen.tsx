import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';
import { TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { CurrencySwitch } from '../../design-system/components/currency-switch';
import { PressableButton } from '../../design-system/components/pressable-button';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import { readToken, saveToken } from '../../monobank/token';
import { settingsRepo } from '../../repositories/settings.repo';
import { useSync } from '../use-sync';

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : new Date(lastSyncAt).toLocaleString();

export const SettingsScreen: FC = () => {
  const { theme } = useUnistyles();
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);
  const [token, setToken] = useState('');
  const { isSyncing, error: syncError, sync } = useSync();
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
        <Text variant="title">Settings</Text>

        <Box gap={2}>
          <Text variant="heading">Base currency</Text>
          <CurrencySwitch selected={settings?.baseCurrency} onSelect={handleSelectCurrency} />
        </Box>

        <Box gap={2}>
          <Text variant="heading">Monobank token</Text>
          <TextInput
            value={token}
            onChangeText={handleChangeToken}
            placeholder="Monobank token"
            placeholderTextColor={theme.colors.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              color: theme.colors.textPrimary,
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radii.sm,
              padding: theme.spacing(2),
            }}
          />
          <PressableButton
            onPress={handleSaveToken}
            backgroundColor={theme.colors.surface}
            alignSelf="flex-start"
          >
            <Text variant="body">Save</Text>
          </PressableButton>
        </Box>

        <Box gap={2}>
          <PressableButton
            onPress={() => void sync()}
            disabled={isSyncing}
            backgroundColor={theme.colors.accent}
            alignSelf="flex-start"
          >
            <Text variant="body">{isSyncing ? 'Syncing…' : 'Sync'}</Text>
          </PressableButton>
          <Text variant="caption" tone="textSecondary">
            Last sync: {formatLastSyncAt(settings?.lastSyncAt ?? null)}
          </Text>
          {syncError !== undefined && (
            <Text variant="body" tone="negative">
              {syncError}
            </Text>
          )}
        </Box>
      </Box>
    </Screen>
  );
};
