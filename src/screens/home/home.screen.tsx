import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC, ReactElement } from 'react';
import { FlatList } from 'react-native';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import type { CurrencyRateRow, HoldingRow } from '../../db/schema';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import MoneyText from '../../design-system/components/money-text';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { HomeStackParamList, TabParamList } from '../../navigation/types';
import { netWorth, type RateTable } from '../../rates/conversion';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { styles } from './home.styles';

// Home lives in its own tab; some of its future navigation targets belong to
// the Accounts tab's stack. Composing the Home stack props with the tab props
// keeps that cross-tab navigation type-safe even though this screen no longer
// issues those navigate() calls itself.
type HomeScreenProps = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  NativeBottomTabScreenProps<TabParamList, 'HomeTab'>
>;

type ConvertibleHolding = Pick<HoldingRow, 'accountId' | 'currency' | 'balanceMinorUnits'>;

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

const HomeScreen: FC<HomeScreenProps> = () => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllWithContextQuery(), [
    'transactions',
    'holdings',
    'accounts',
  ]);
  type TransactionRow = (typeof transactions)[number];

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);

  // A holding counts toward net worth only when it is open AND its parent
  // account is not archived — archived accounts are hidden but not deleted.
  const archivedAccountIds = new Set(
    accounts.filter(account => account.archivedAt != null).map(account => account.id),
  );
  const activeHoldings = holdings.filter(
    holding => holding.closedAt == null && !archivedAccountIds.has(holding.accountId),
  );
  const total = guardedNetWorth(activeHoldings, baseCurrency, rateTable);
  const hasUnconvertible = activeHoldings.some(
    holding => !canConvert(holding.currency, baseCurrency, rateTable),
  );

  const renderTransaction = ({ item }: { item: TransactionRow }): ReactElement => (
    <Box gap={1} style={styles.row}>
      <Box direction="row" style={styles.rowMain}>
        <Text variant="body">{item.description || '—'}</Text>
        <MoneyText money={Money.of(item.currency, item.amountMinorUnits)} />
      </Box>
      <Text variant="caption" tone="textSecondary">
        {`${item.accountName} · ${item.category ?? 'Uncategorized'}`}
      </Text>
    </Box>
  );

  return (
    <Screen>
      <Box gap={4}>
        <Box gap={1} style={styles.header}>
          <Text variant="caption" tone="textSecondary">
            Net worth
          </Text>
          <MoneyText money={total} style={styles.balance} />
          {hasUnconvertible && (
            <Text variant="caption" tone="textSecondary">
              Rates unavailable
            </Text>
          )}
        </Box>

        <FlatList
          data={transactions}
          keyExtractor={item => item.id}
          renderItem={renderTransaction}
        />
      </Box>
    </Screen>
  );
};

export default HomeScreen;
