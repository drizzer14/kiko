import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { FC, ReactElement } from 'react';
import { useState } from 'react';
import { Pressable, SectionList } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { buildCategoryDisplayMap, resolveCategoryDisplay } from '../../categories/category-display';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { formatDate } from '../../dates/format';
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

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Whether a transaction time falls within the (inclusive) date range. A null
// bound is open-ended on that side. The `to` bound is pushed to the end of its
// calendar day so a same-day transaction any time that day still matches.
const withinDateRange = (time: number, from: Date | null, to: Date | null): boolean => {
  if (from !== null && time < startOfLocalDay(from.getTime())) {
    return false;
  }

  if (to !== null && time > startOfLocalDay(to.getTime()) + DAY_IN_MS - 1) {
    return false;
  }

  return true;
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

// "Today"/"Yesterday" for the two most recent days, otherwise the shared
// explicit DD.MM.YYYY format (locale-independent). `now` is passed in rather
// than read here so the mapping stays pure and testable.
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

  return formatDate(dayStart);
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
  // The floating native glass tab bar sits over this screen's bottom edge, so
  // the SectionList needs bottom clearance beyond it or the last transaction
  // row is left partially covered. Unlike the Screen primitive's own
  // footer/content clearance (see `screen.component.tsx`), this omits the
  // bottom safe-area inset: Screen's plain-branch `SafeAreaView` already
  // reserves that inset natively around this screen's content (it keeps the
  // default 'bottom' edge), so adding it again here would double-count it and
  // leave too much space below the last row. The measured tab-bar height
  // alone is the only clearance this list needs to add itself.
  const tabBarHeight = useBottomTabBarHeight();
  const listBottomClearance = tabBarHeight;

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

  const categoryByKey = buildCategoryDisplayMap(categories);

  // Each dimension holds a set of selected values; an empty set means "all".
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  // The date-range bounds; a null bound is ignored so the range is open-ended
  // on that side. Both null means no date filtering at all.
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);

  const clearDateRange = (): void => {
    setDateFrom(null);
    setDateTo(null);
  };

  // The date-range modal commits both bounds at once on Apply; either may be
  // null when that side of the range is left open-ended.
  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setDateFrom(from);
    setDateTo(to);
  };

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

  // The full span of transaction dates, shown as the date-range field's default
  // display when no range is active. It never filters — it only tells the user
  // the range their data covers. With no transactions both bounds fall back to
  // today so the field always has something to render.
  const transactionTimes = transactions.map((row) => row.time);
  const spanStart = transactionTimes.length > 0 ? Math.min(...transactionTimes) : now;
  const spanEnd = transactionTimes.length > 0 ? Math.max(...transactionTimes) : now;

  // The date-range field's *selectable* bounds are distinct from the display
  // span above: the earliest a user may pick is the earliest transaction's day
  // (`spanStart`, falling back to today when there are no transactions, and
  // passed through as `minDate`), and the latest is today — future dates are
  // never selectable. The field derives its selectable floor from `minDate`
  // (= `spanStart`) and its ceiling from today itself, so the display span
  // (earliest–latest transaction) stays independent of the selectable range.

  // Every active (non-archived) account, so a newly-added account with no
  // transactions yet still appears in the Accounts filter. Sourced from the
  // accounts live query rather than from the transactions, which would omit it.
  // Transaction matching still keys off `row.accountName` below.
  const distinctAccountNames = Array.from(
    new Set(
      accounts.filter((account) => account.archivedAt == null).map((account) => account.name),
    ),
  );
  const distinctCategories = Array.from(
    new Set(transactions.map((row) => row.category ?? 'Uncategorized')),
  );
  const filteredTransactions = transactions.filter((row) => {
    const matchesAccount = selectedAccounts.size === 0 || selectedAccounts.has(row.accountName);
    const matchesCategory =
      selectedCategories.size === 0 || selectedCategories.has(row.category ?? 'Uncategorized');
    const matchesDate = withinDateRange(row.time, dateFrom, dateTo);

    return matchesAccount && matchesCategory && matchesDate;
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
              <Box style={styles.rowDescription}>
                <Text variant="body">{description}</Text>
              </Box>
            </Box>
            <Box style={styles.rowAmount}>
              <MoneyText
                money={Money.of(item.currency, item.amountMinorUnits)}
                context="transaction"
              />
            </Box>
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
    // The SectionList below is this screen's own scrollable surface and applies
    // the tab-bar clearance to its own content (`listContent`), so Screen must
    // not also reserve it — `bleedBottom` drops Screen's own content clearance
    // to avoid double-counting the gap below the last transaction row.
    <Screen bleedBottom>
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

        {/* The divider and the filter row are grouped so the content column's
            `gap(4)` lands only above the divider (net-worth card → divider). The
            filter row keeps its own `marginTop(4)`, which now serves as the
            divider → filters spacing — splitting the existing card-to-filter band
            evenly around the rule instead of stacking a second, doubled gap. */}
        <Box>
          <Box style={styles.divider} />
          <Box style={styles.filterBar}>
            <TransactionFilterBar
              accounts={distinctAccountNames}
              categories={distinctCategories}
              selectedAccount={selectedAccounts}
              selectedCategory={selectedCategories}
              onToggleAccount={toggleFilter(setSelectedAccounts)}
              onToggleCategory={toggleFilter(setSelectedCategories)}
              dateFrom={dateFrom}
              dateTo={dateTo}
              minDate={new Date(spanStart)}
              maxDate={new Date(spanEnd)}
              onApplyDates={applyDateRange}
              onClearDates={clearDateRange}
            />
          </Box>
        </Box>

        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          renderSectionHeader={renderDayHeader}
          stickySectionHeadersEnabled={false}
          style={styles.list}
          contentContainerStyle={styles.listContent(listBottomClearance)}
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
