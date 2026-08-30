import type { FC } from 'react';
import { useEffect, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import { runSync } from '../../monobank/sync';
import { readToken, saveToken } from '../../monobank/token';
import { refreshRates } from '../../rates/rates-refresh';
import { settingsRepo } from '../../repositories/settings.repo';

const currencyOptions: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

const toErrorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

const formatLastSyncAt = (lastSyncAt: number | null): string =>
  lastSyncAt === null ? 'Never' : new Date(lastSyncAt).toLocaleString();

export const SettingsScreen: FC = () => {
  const { theme } = useUnistyles();
  const { data } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const settings = data.at(0);
  const [token, setToken] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    void readToken().then(existing => {
      if (alive && existing !== undefined) {
        setToken(existing);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
  };

  const handleSaveToken = (): void => {
    void saveToken(token);
  };

  const handleSync = async (): Promise<void> => {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await runSync();
      await refreshRates();
    } catch (caught) {
      setSyncError(toErrorMessage(caught));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Settings</Text>

        <Box gap={2}>
          <Text variant="heading">Base currency</Text>
          <Box gap={2} style={{ flexDirection: 'row' }}>
            {currencyOptions.map(currency => (
              <Pressable
                key={currency}
                accessibilityRole="button"
                onPress={() => handleSelectCurrency(currency)}
                style={{
                  paddingVertical: theme.spacing(2),
                  paddingHorizontal: theme.spacing(3),
                  borderRadius: theme.radii.sm,
                  backgroundColor:
                    settings?.baseCurrency === currency
                      ? theme.colors.surfaceHigh
                      : theme.colors.surface,
                }}
              >
                <Text
                  variant="body"
                  tone={settings?.baseCurrency === currency ? 'textPrimary' : 'textSecondary'}
                >
                  {currency}
                </Text>
              </Pressable>
            ))}
          </Box>
        </Box>

        <Box gap={2}>
          <Text variant="heading">Monobank token</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
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
          <Pressable
            accessibilityRole="button"
            onPress={handleSaveToken}
            style={{
              paddingVertical: theme.spacing(2),
              paddingHorizontal: theme.spacing(3),
              borderRadius: theme.radii.sm,
              backgroundColor: theme.colors.surface,
              alignSelf: 'flex-start',
            }}
          >
            <Text variant="body">Save</Text>
          </Pressable>
        </Box>

        <Box gap={2}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleSync()}
            disabled={syncing}
            style={{
              paddingVertical: theme.spacing(2),
              paddingHorizontal: theme.spacing(3),
              borderRadius: theme.radii.sm,
              backgroundColor: theme.colors.accent,
              alignSelf: 'flex-start',
            }}
          >
            <Text variant="body">{syncing ? 'Syncing…' : 'Sync'}</Text>
          </Pressable>
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
