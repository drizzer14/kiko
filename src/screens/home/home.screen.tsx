import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC, ReactElement } from 'react';
import { useState } from 'react';
import { FlatList } from 'react-native';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import MoneyText from '../../design-system/components/money-text';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { HomeStackParamList, TabParamList } from '../../navigation/types';
import { buildRateTable, canConvert, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { styles } from './home.styles';
import TransactionFilterBar, { FILTER_ALL } from './transaction-filter-bar.component';

// Home lives in its own tab; some of its future navigation targets belong to
// the Accounts tab's stack. Composing the Home stack props with the tab props
// keeps that cross-tab navigation type-safe even though this screen no longer
// issues those navigate() calls itself.
type HomeScreenProps = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  NativeBottomTabScreenProps<TabParamList, 'HomeTab'>
>;

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

  const [selectedAccount, setSelectedAccount] = useState<string>(FILTER_ALL);
  const [selectedCategory, setSelectedCategory] = useState<string>(FILTER_ALL);

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

  const distinctAccountNames = Array.from(new Set(transactions.map(row => row.accountName)));
  const distinctCategories = Array.from(
    new Set(transactions.map(row => row.category ?? 'Uncategorized')),
  );
  const filteredTransactions = transactions.filter(row => {
    const matchesAccount = selectedAccount === FILTER_ALL || row.accountName === selectedAccount;
    const matchesCategory =
      selectedCategory === FILTER_ALL || (row.category ?? 'Uncategorized') === selectedCategory;
    return matchesAccount && matchesCategory;
  });

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
      <Box gap={4} style={styles.content}>
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

        <TransactionFilterBar
          accounts={distinctAccountNames}
          categories={distinctCategories}
          selectedAccount={selectedAccount}
          selectedCategory={selectedCategory}
          onSelectAccount={setSelectedAccount}
          onSelectCategory={setSelectedCategory}
        />

        <FlatList
          data={filteredTransactions}
          keyExtractor={item => item.id}
          renderItem={renderTransaction}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Box style={styles.empty}>
              <Text tone="textSecondary">No transactions</Text>
            </Box>
          }
        />
      </Box>
    </Screen>
  );
};

export default HomeScreen;
