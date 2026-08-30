import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC } from 'react';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { Money } from '../../currency/money';
import type { CurrencyRateRow, HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { MoneyText } from '../../design-system/components/money-text';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import { runSync } from '../../monobank/sync';
import type { RootStackParamList } from '../../navigation/types';
import { netWorth, type RateTable } from '../../rates/conversion';
import { refreshRates } from '../../rates/rates-refresh';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

type ConvertibleHolding = Pick<HoldingRow, 'accountId' | 'currency' | 'balanceMinorUnits'>;

const currencyOptions: Currency[] = ['BTC', 'USD', 'EUR', 'UAH'];

const toErrorMessage = (caught: unknown): string =>
  caught instanceof Error ? caught.message : String(caught);

/** The `rate` column is stored as a string; parse it into the numeric RateTable. */
const buildRateTable = (rows: Pick<CurrencyRateRow, 'base' | 'quote' | 'rate'>[]): RateTable => {
  const table: RateTable = {};
  for (const row of rows) {
    const rate = Number(row.rate);
    if (Number.isFinite(rate)) {
      table[`${row.base}:${row.quote}`] = rate;
    }
  }
  return table;
};

/**
 * `convert`/`netWorth` throw on a missing rate pair (RULING R2). A holding is
 * convertible only when it is already in the base currency or a base rate
 * exists — otherwise it is excluded from any sum so a first-run (no rates yet)
 * render never crashes.
 */
const canConvert = (currency: Currency, base: Currency, rates: RateTable): boolean =>
  currency === base || rates[`${currency}:${base}`] !== undefined;

/** Sum the given holdings in the base currency, excluding any that cannot convert. */
const guardedNetWorth = (
  holdings: ConvertibleHolding[],
  base: Currency,
  rates: RateTable,
): Money => {
  const convertible = holdings.filter(holding => canConvert(holding.currency, base, rates));
  return netWorth(convertible, base, rates);
};

export const HomeScreen: FC<HomeScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | undefined>();

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);

  const activeHoldings = holdings.filter(holding => holding.closedAt == null);
  const total = guardedNetWorth(activeHoldings, baseCurrency, rateTable);
  const hasUnconvertible = activeHoldings.some(
    holding => !canConvert(holding.currency, baseCurrency, rateTable),
  );

  const handleSelectCurrency = (currency: Currency): void => {
    void settingsRepo.setBaseCurrency(currency);
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
        <Text variant="title">Home</Text>
        <Box gap={1}>
          <Text variant="caption" tone="textSecondary">
            Net worth
          </Text>
          <MoneyText money={total} />
          {hasUnconvertible && (
            <Text variant="caption" tone="textSecondary">
              Rates unavailable — tap Sync
            </Text>
          )}
        </Box>

        <Box gap={2}>
          <Text variant="heading">Base currency</Text>
          <Box gap={2} style={{ flexDirection: 'row' }}>
            {currencyOptions.map(currency => (
              <Pressable
                key={currency}
                accessibilityRole="button"
                onPress={() => handleSelectCurrency(currency)}
                style={[
                  styles.button,
                  {
                    backgroundColor:
                      baseCurrency === currency ? theme.colors.surfaceHigh : theme.colors.surface,
                  },
                ]}
              >
                <Text
                  variant="body"
                  tone={baseCurrency === currency ? 'textPrimary' : 'textSecondary'}
                >
                  {currency}
                </Text>
              </Pressable>
            ))}
          </Box>
        </Box>

        <Box gap={2}>
          <Text variant="heading">Accounts</Text>
          {accounts.map(account => {
            const accountHoldings = activeHoldings.filter(
              holding => holding.accountId === account.id,
            );
            const subtotal = guardedNetWorth(accountHoldings, baseCurrency, rateTable);
            return (
              <Pressable
                key={account.id}
                accessibilityRole="button"
                onPress={() => navigation.navigate('AccountDetail', { accountId: account.id })}
                style={[styles.row, { backgroundColor: theme.colors.surface }]}
              >
                <Text variant="body">{account.name}</Text>
                <MoneyText money={subtotal} />
              </Pressable>
            );
          })}
        </Box>

        <Box gap={2}>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handleSync()}
            disabled={syncing}
            style={[
              styles.button,
              { backgroundColor: theme.colors.accent, alignSelf: 'flex-start' },
            ]}
          >
            <Text variant="body">{syncing ? 'Syncing…' : 'Sync'}</Text>
          </Pressable>
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

const styles = StyleSheet.create(theme => ({
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
}));
