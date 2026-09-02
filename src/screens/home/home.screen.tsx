import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC, ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, SectionList } from 'react-native';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import GlassSurface from '../../design-system/components/glass-surface';
import MoneyText from '../../design-system/components/money-text';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import type { HomeStackParamList, TabParamList } from '../../navigation/types';
import { sumByCurrency } from '../../rates/currency-totals';
import { buildRateTable, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { categoriesRepo } from '../../repositories/categories.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { defaultTransactionDescription } from '../../transactions/default-description';
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

// A transaction stores a category as a stable key (the MCC category name,
// lowercased — see Task 13's slug convention). The categories table maps that
// key to the user-editable title + icon, so the display resolves through the
// table rather than any hard-coded map.
type CategoryDisplay = { title: string; icon: string };

// Shown when a category cannot be resolved and the table has no seeded `other`
// row (e.g. before the seed migration runs). A null/empty category also lands
// here so its label matches the filter bar's own "Uncategorized" chip.
const NEUTRAL_CATEGORY: CategoryDisplay = { title: 'Uncategorized', icon: 'creditcard' };

const resolveCategoryDisplay = (
  category: string | null,
  byKey: ReadonlyMap<string, CategoryDisplay>,
): CategoryDisplay => {
  const key = category?.toLowerCase();
  if (!key) {
    return NEUTRAL_CATEGORY;
  }

  return byKey.get(key) ?? byKey.get('other') ?? NEUTRAL_CATEGORY;
};

// A day's worth of transactions, headed by a human-readable label. The list is
// a SectionList of these — one section per calendar day, newest day first.
type DaySection<Row> = { title: string; data: Row[] };

// Midnight (local time) of the calendar day a timestamp falls on. Grouping and
// the Today/Yesterday comparison both key off this so they agree on day
// boundaries in the device's own timezone.
const startOfLocalDay = (time: number): number => {
  const date = new Date(time);

  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

// "Today"/"Yesterday" for the two most recent days, otherwise a locale-formatted
// date (e.g. "12 Aug 2026" — order follows the device locale). `now` is passed
// in rather than read here so the mapping stays pure and testable.
const dayHeader = (dayStart: number, now: number): string => {
  const today = startOfLocalDay(now);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  if (dayStart === today) {
    return 'Today';
  }
  if (dayStart === yesterdayDate.getTime()) {
    return 'Yesterday';
  }

  return new Date(dayStart).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

// Fold rows (already ordered newest-first by the query) into per-day sections,
// preserving that order: same-day rows are consecutive, so a section closes as
// soon as the day changes. Sections therefore come out newest-day-first with
// each day's rows newest-first.
const groupByDay = <Row extends { time: number }>(
  rows: readonly Row[],
  now: number,
): DaySection<Row>[] => {
  const sections: DaySection<Row>[] = [];

  for (const row of rows) {
    const dayStart = startOfLocalDay(row.time);
    const openSection = sections.at(-1);

    if (openSection && startOfLocalDay(openSection.data[0].time) === dayStart) {
      openSection.data.push(row);
    } else {
      sections.push({ title: dayHeader(dayStart, now), data: [row] });
    }
  }

  return sections;
};

const HomeScreen: FC<HomeScreenProps> = ({ navigation }) => {
  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllWithContextQuery(), [
    'transactions',
    'holdings',
    'accounts',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  type TransactionRow = (typeof transactions)[number];

  const categoryByKey: ReadonlyMap<string, CategoryDisplay> = new Map(
    categories.map((category) => [category.key, { title: category.title, icon: category.icon }]),
  );

  // Each dimension holds a set of selected values; an empty set means "all".
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  // The `FILTER_ALL` chip clears the dimension; any other value toggles in/out.
  // A fresh Set keeps the state update immutable.
  const toggleFilter =
    (setSelected: (updater: (previous: Set<string>) => Set<string>) => void) =>
    (value: string): void => {
      if (value === FILTER_ALL) {
        setSelected(() => new Set());

        return;
      }

      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }

        return next;
      });
    };

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);

  // A holding counts toward net worth only when it is open AND its parent
  // account is not archived — archived accounts are hidden but not deleted.
  const archivedAccountIds = new Set(
    accounts.filter((account) => account.archivedAt != null).map((account) => account.id),
  );
  const activeHoldings = holdings.filter(
    (holding) => holding.closedAt == null && !archivedAccountIds.has(holding.accountId),
  );
  const now = Date.now();
  const total = guardedNetWorth(activeHoldings, baseCurrency, rateTable, now);
  const breakdown = sumByCurrency(activeHoldings);

  const distinctAccountNames = Array.from(new Set(transactions.map((row) => row.accountName)));
  const distinctCategories = Array.from(
    new Set(transactions.map((row) => row.category ?? 'Uncategorized')),
  );
  const filteredTransactions = transactions.filter((row) => {
    const matchesAccount = selectedAccounts.size === 0 || selectedAccounts.has(row.accountName);
    const matchesCategory =
      selectedCategories.size === 0 || selectedCategories.has(row.category ?? 'Uncategorized');

    return matchesAccount && matchesCategory;
  });

  // Grouping/sorting happens after filtering, over the query's newest-first
  // order (transactionsRepo orders by time desc), so sections come out
  // newest-day-first with each day's rows newest-first.
  const sections = groupByDay(filteredTransactions, now);

  const renderTransaction = ({ item }: { item: TransactionRow }): ReactElement => {
    const category = resolveCategoryDisplay(item.category, categoryByKey);
    const description =
      item.description || defaultTransactionDescription(item.holdingName, item.amountMinorUnits);

    // Every row is tappable: it opens the shared Transaction form for this id.
    // A manual row edits; a synced (Monobank) row opens read-only — the form
    // resolves which from the transaction's own `source`, so the row only needs
    // to pass the id.
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('TransactionForm', { transactionId: item.id })}
      >
        <Box gap={2} style={styles.row}>
          <Box direction="row" style={styles.rowMain}>
            <Box direction="row" gap={2} style={styles.rowLead}>
              <SymbolIcon
                name={category.icon}
                size={18}
                tone="textSecondary"
                accessibilityLabel={category.title}
              />
              <Text variant="body">{description}</Text>
            </Box>
            <MoneyText
              money={Money.of(item.currency, item.amountMinorUnits)}
              context="transaction"
            />
          </Box>
          <Text variant="caption" tone="textSecondary">
            {`${item.accountName} · ${category.title}`}
          </Text>
        </Box>
      </Pressable>
    );
  };

  const renderDayHeader = ({ section }: { section: DaySection<TransactionRow> }): ReactElement => (
    <Box style={styles.sectionHeader}>
      <Text variant="caption" tone="textSecondary">
        {section.title}
      </Text>
    </Box>
  );

  return (
    <Screen>
      <Box gap={4} style={styles.content}>
        <GlassSurface padding={4} radius="lg">
          <Box gap={1} style={styles.header}>
            <Text variant="caption" tone="textSecondary">
              Net worth
            </Text>
            <MoneyText money={total} context="balance" style={styles.balance} />
            <Box style={styles.breakdown}>
              <CurrencyBreakdown items={breakdown} />
            </Box>
          </Box>
        </GlassSurface>

        <TransactionFilterBar
          accounts={distinctAccountNames}
          categories={distinctCategories}
          selectedAccount={selectedAccounts}
          selectedCategory={selectedCategories}
          onToggleAccount={toggleFilter(setSelectedAccounts)}
          onToggleCategory={toggleFilter(setSelectedCategories)}
        />

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          renderSectionHeader={renderDayHeader}
          stickySectionHeadersEnabled={false}
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
