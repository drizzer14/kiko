import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { TFunction } from 'i18next';
import type { FC, ReactElement } from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, SectionList } from 'react-native';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '../../categories/category-display';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { defaultDateRange } from '../../dates/default-range';
import { formatDate, formatTime } from '../../dates/format';
import { endOfLocalDay, startOfLocalDay } from '../../dates/local-day';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import CurrencyBreakdown from '../../design-system/components/currency-breakdown';
import GlassSurface from '../../design-system/components/glass-surface';
import MoneyText from '../../design-system/components/money-text';
import Screen, { resolveBottomClearance } from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import Text from '../../design-system/components/text';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { isTimeExemptHoldingType } from '../../holdings/holding-type';
import { useSyncStatus } from '../../monobank/sync-status';
import type { HomeStackParamList, TabParamList } from '../../navigation/types';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';
import { activeHoldings } from '../../rates/active-holdings';
import { buildRateTable, guardedBreakdown, guardedNetWorth } from '../../rates/net-worth-view';
import { accountsRepo } from '../../repositories/accounts.repo';
import { categoriesRepo } from '../../repositories/categories.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { ratesRepo } from '../../repositories/rates.repo';
import { settingsRepo } from '../../repositories/settings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import { transactionRowDescription } from '../../transactions/row-description';
import { transactionSpan } from '../../transactions/transaction-span';
import { useSyncAll } from '../use-sync-all';

import type { FilterOption } from './filter-menu';
import { styles } from './home.styles';
import TransactionFilterBar, { FILTER_ALL } from './transaction-filter-bar';
import { useRefreshControlSignal } from './use-refresh-control-signal';

// Home lives in its own tab; some of its future navigation targets belong to
// the Accounts tab's stack. Composing the Home stack props with the tab props
// keeps that cross-tab navigation type-safe even though this screen no longer
// issues those navigate() calls itself.
type HomeScreenProps = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  NativeBottomTabScreenProps<TabParamList, 'HomeTab'>
>;

// Whether a transaction time falls within the (inclusive) date range. A null
// bound is open-ended on that side. The `to` bound is pushed to the end of its
// calendar day — the last millisecond before the NEXT local midnight
// (DST-correct; see `endOfLocalDay`) — so a same-day transaction any time
// that day still matches, including on a 25-hour fall-back day.
const withinDateRange = (time: number, from: Date | null, to: Date | null): boolean => {
  if (from !== null && time < startOfLocalDay(from.getTime())) {
    return false;
  }

  if (to !== null && time > endOfLocalDay(to.getTime())) {
    return false;
  }

  return true;
};

// A day's worth of transactions, headed by a human-readable label. The list is
// a SectionList of these — one section per calendar day, newest day first.
type DaySection<Row> = { title: string; data: Row[] };

// "Today"/"Yesterday" for the two most recent days, otherwise the shared
// explicit DD.MM.YYYY format (locale-independent). `now` is passed in rather
// than read here so the mapping stays pure and testable; `t` is passed in for
// the same reason (a hook can only be called from the component itself).
const dayHeader = (dayStart: number, now: number, t: TFunction): string => {
  const today = startOfLocalDay(now);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  if (dayStart === today) {
    return t('home.today');
  }
  if (dayStart === yesterdayDate.getTime()) {
    return t('home.yesterday');
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
  t: TFunction,
): DaySection<Row>[] => {
  const sections: DaySection<Row>[] = [];

  for (const row of rows) {
    const dayStart = startOfLocalDay(row.time);
    const openSection = sections.at(-1);

    if (openSection && startOfLocalDay(openSection.data[0].time) === dayStart) {
      openSection.data.push(row);
    } else {
      sections.push({ title: dayHeader(dayStart, now, t), data: [row] });
    }
  }

  return sections;
};

const HomeScreen: FC<HomeScreenProps> = ({ navigation }) => {
  const { t, i18n } = useTranslation();

  // The floating native glass tab bar sits over this screen's bottom edge, so
  // this SectionList — which owns the true bottom edge, since Home passes
  // `bleedBottom` — reserves the clearance itself. It is the tab-bar height
  // MINUS the bottom safe-area inset, because Screen's plain-branch
  // `SafeAreaView` already reserves that inset natively around this content:
  // adding the full bar height on top of it double-counted the inset and left
  // 130pt of dead space under the last row, against 96pt everywhere else. One
  // shared computation, in `resolveBottomClearance`.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const listBottomClearance = resolveBottomClearance(tabBarHeight, insets.bottom);

  // Re-tapping the Home tab while already on it returns this transaction list to
  // the top (the standard iOS active-tab re-tap), driven off the native tab
  // navigator's `tabPress`.
  // The CONCRETE generic instance type, not the bare `SectionListInstance`
  // alias (which is `SectionList<any, DefaultSectionT>`): the rendered
  // `<SectionList>` below is inferred at `<TransactionRow, DaySection<...>>`,
  // and `DefaultSectionT` does not satisfy `DaySection`, so the alias would not
  // be assignable to this list's own `ref`.
  const listRef = useRef<SectionList<TransactionRow, DaySection<TransactionRow>>>(null);
  useScrollToTopOnTabPress(listRef);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(localized label) `buildCategoryDisplayMap` resolves each default category's title through i18n (`resolveDefaultCategoryTitle`) INTERNALLY, so `i18n.language` is a real dependency Biome cannot see — without it a live language switch leaves the resolved titles in the previous language.
  const categoryByKey = useMemo(
    () => buildCategoryDisplayMap(categories),
    [categories, i18n.language],
  );

  // Pull-to-refresh fans out a fresh sync over every syncable account (the
  // connected Monobank account plus each connected crypto account) at once,
  // bypassing the auto-sync throttle. `failures` names any account that failed
  // so a partial success can still surface which one(s) did not update.
  const { failures, syncAll } = useSyncAll(accounts);

  // The single native RefreshControl spinner is driven by the GLOBAL sync-status
  // signal, not a pull-local flag — so an auto-sync-on-open (which lights the
  // same signal via `runSync`) spins the pull spinner WITHOUT a user pull, and a
  // real pull spins it too. The signal tracks the WHOLE Monobank run (da40e69/R7,
  // reverting the earlier fast-phase-only split): it stays lit across the
  // per-card statement loop and clears only when the run settles, so the spinner
  // is still spinning when "Last sync" lands. Holdings and transactions update
  // incrementally through the reactive `useLiveQuery` consumers above. Known
  // limitation: the signal is Monobank-only, so a pull on a crypto-only account
  // shows little/no spinner.
  const isSyncing = useSyncStatus();

  // The native RefreshControl below binds to this LOCAL signal, not `isSyncing`
  // directly: iOS drops the spin when the list leaves the window on a tab blur,
  // so on refocus the hook re-issues a false->true edge to restart the spin
  // while a sync is still in flight. See `use-refresh-control-signal.ts`.
  const refreshing = useRefreshControlSignal(isSyncing);

  // Each dimension holds a set of selected values; an empty set means "all".
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  // Read once here (rather than where the net-worth total needs it below) so
  // the date-range state below can seed off this same instant instead of a
  // second, separately-timed `Date.now()` read.
  const now = Date.now();

  // The date-range bounds; a null bound is ignored so the range is open-ended
  // on that side. Both default to the last 30 days on mount — a user pick can
  // still set either to null (open-ended) via the date-range field.
  const [dateFrom, setDateFrom] = useState<Date | null>(() => defaultDateRange(now).from);
  const [dateTo, setDateTo] = useState<Date | null>(() => defaultDateRange(now).to);

  const clearDateRange = (): void => {
    const range = defaultDateRange();
    setDateFrom(range.from);
    setDateTo(range.to);
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
  // The configurable catch-all category: a null/empty transaction category folds
  // into it (its filter chip, its row label, its color) instead of a separate
  // "Uncategorized" bucket. Read from settings (seeded to `other`).
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;
  const rateTable = buildRateTable(rates);

  // Counterpart holding names, so an Exchange/Convert leg's label resolves to
  // the counterpart's CURRENT name in the ACTIVE language (nothing is
  // persisted — see transactions/row-description.ts).
  const holdingNameById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding.name])),
    [holdings],
  );

  const active = activeHoldings(holdings, accounts);
  const total = guardedNetWorth(active, baseCurrency, rateTable, now);
  const breakdown = guardedBreakdown(active, baseCurrency, rateTable, now);

  // The full span of transaction dates, shown as the date-range field's default
  // display when no range is active. It never filters — it only tells the user
  // the range their data covers. With no transactions both bounds fall back to
  // today so the field always has something to render.
  // The earliest/latest transaction time in ONE O(n) pass (see `transactionSpan`
  // — `Math.min(...times)` spread the whole array and overflowed the stack on a
  // long history, and re-ran on every reactive fire during a sync). Memoized on
  // `transactions` alone; the empty-list fallback to `now` is applied outside,
  // so a per-render `now` never invalidates the memo.
  const span = useMemo(
    () =>
      transactionSpan(
        transactions.map((row) => row.time),
        0,
      ),
    [transactions],
  );
  const spanStart = transactions.length > 0 ? span.start : now;
  const spanEnd = transactions.length > 0 ? span.end : now;

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
  // Each option carries its own seeded icon + resolved entity color for the
  // menu row; transaction matching still keys off `option.value` (the account
  // name, matched against `row.accountName` below). De-duplicated by name,
  // first-seen-wins, preserving the old `Set`-based distinctness.
  const accountOptions = useMemo(() => {
    const byName = new Map<string, FilterOption>();
    for (const account of accounts) {
      if (account.archivedAt != null || byName.has(account.name)) {
        continue;
      }
      byName.set(account.name, {
        value: account.name,
        icon: account.icon ?? undefined,
        color: resolveEntityColor(account.color, defaultAccountColor[account.kind]),
      });
    }
    return Array.from(byName.values());
  }, [accounts]);
  // Group and match the category filter by the STABLE `categories.key` slug,
  // never by the resolved display title: the title is language-dependent (a
  // default category's title changes under a live language switch — see
  // resolveDefaultCategoryTitle), so keying selection/matching on it would
  // silently desync the moment the app language changes, leaving a stale
  // Set of now-nonexistent title strings. An override stores the lowercase
  // slug key (`groceries`) while un-overridden synced rows still store the
  // capitalized MCC name (`Groceries`); both resolve to the same KEY (via
  // resolveCategoryKey), so keying on it still collapses them into one chip.
  // A null/empty category resolves to the DEFAULT category's key (not a
  // separate "Uncategorized" bucket), so uncategorized rows share the
  // default's filter chip. The visible row LABEL is still the resolved,
  // localized display title — only the identity is the key.
  const categoryKeyForRow = useCallback(
    (raw: string | null): string => resolveCategoryKey(raw, categoryByKey, defaultCategoryKey),
    [categoryByKey, defaultCategoryKey],
  );
  // One option per distinct resolved key, first-seen-wins (the same
  // distinctness the old `Set` gave), each carrying the category's resolved
  // icon, effective color, and localized label for the menu row. Matching
  // keys on `option.value` (the stable key, compared to
  // `categoryKeyForRow(row.category)` below); the row renders `option.label`.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(localized label) `resolveCategoryDisplay` resolves a default category's title through i18n INTERNALLY (not via a captured variable Biome can see), so `i18n.language` is a real dependency — without it a live language switch leaves the option labels in the previous language.
  const categoryOptions = useMemo(() => {
    const byKey = new Map<string, FilterOption>();
    for (const row of transactions) {
      const key = categoryKeyForRow(row.category);
      if (byKey.has(key)) {
        continue;
      }
      const display = resolveCategoryDisplay(row.category, categoryByKey, defaultCategoryKey);
      byKey.set(key, {
        value: key,
        label: display.title,
        icon: display.icon,
        color: resolveCategoryColor(display.color, key),
      });
    }
    // Order the filter options by each category's `sortOrder` (the user-defined
    // reorder), not the first-seen-in-transactions order the Map above yields.
    // `categories` already arrives ordered by `sortOrder` then `key`
    // (categoriesRepo.allQuery), so its index is the display order. A key absent
    // from `categories` (rare) sorts last, preserving the Map's stable order
    // among such keys via a stable sort.
    const orderByKey = new Map<string, number>();
    categories.forEach((category, index) => {
      orderByKey.set(category.key, index);
    });
    return Array.from(byKey.values()).sort((a, b) => {
      const orderA = orderByKey.get(a.value) ?? Number.POSITIVE_INFINITY;
      const orderB = orderByKey.get(b.value) ?? Number.POSITIVE_INFINITY;

      return orderA - orderB;
    });
  }, [
    transactions,
    categories,
    categoryByKey,
    defaultCategoryKey,
    categoryKeyForRow,
    i18n.language,
  ]);
  const filteredTransactions = useMemo(
    () =>
      transactions.filter((row) => {
        const matchesAccount = selectedAccounts.size === 0 || selectedAccounts.has(row.accountName);
        const matchesCategory =
          selectedCategories.size === 0 || selectedCategories.has(categoryKeyForRow(row.category));
        const matchesDate = withinDateRange(row.time, dateFrom, dateTo);

        return matchesAccount && matchesCategory && matchesDate;
      }),
    [transactions, selectedAccounts, selectedCategories, dateFrom, dateTo, categoryKeyForRow],
  );

  // Grouping/sorting happens after filtering, over the query's newest-first
  // order (transactionsRepo orders by time desc), so sections come out
  // newest-day-first with each day's rows newest-first. Keyed on the local DAY
  // (not the per-render `now` millisecond): the day headers only change at
  // midnight, so this recomputes when the filtered rows change or the day rolls,
  // not on every reactive fire during a sync.
  const todayStart = startOfLocalDay(now);
  const sections = useMemo(
    () => groupByDay(filteredTransactions, todayStart, t),
    [filteredTransactions, todayStart, t],
  );

  const renderTransaction = ({ item }: { item: TransactionRow }): ReactElement => {
    const category = resolveCategoryDisplay(item.category, categoryByKey, defaultCategoryKey);
    const description = transactionRowDescription({
      transaction: item,
      holdingName: item.holdingName,
      holdingNameById,
      t,
    });

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
                // The row icon and this category's filter chip must hash on the
                // SAME resolved key (`categoryKeyForRow`, above): hashing here
                // on the raw lowercased slug renders one category in two hues
                // whenever that slug is absent from the categories table, since
                // the chip has already folded it onto the default key.
                color={resolveCategoryColor(category.color, categoryKeyForRow(item.category))}
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
          <Box direction="row" gap={2} style={styles.rowFooter}>
            <Box style={styles.rowFooterMeta}>
              <Text variant="caption" tone="textSecondary">
                {`${item.accountName} · ${category.title}`}
              </Text>
            </Box>
            {!isTimeExemptHoldingType(item.holdingType) && (
              <Text variant="caption" tone="textSecondary">
                {formatTime(item.time)}
              </Text>
            )}
          </Box>
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
              {t('home.netWorth')}
            </Text>
            <MoneyText money={total} context="balance" style={styles.balance} />
            <Box style={styles.breakdown}>
              <CurrencyBreakdown items={breakdown} />
            </Box>
          </Box>
        </GlassSurface>

        {failures.length > 0 && (
          <Text variant="body" tone="negative">
            {t('home.syncFailedMessage', { accounts: failures.join(', ') })}
          </Text>
        )}

        {/* The divider and the filter row are grouped so the content column's
            `gap(4)` lands only above the divider (net-worth card → divider). The
            filter row keeps its own `marginTop(4)`, which now serves as the
            divider → filters spacing — splitting the existing card-to-filter band
            evenly around the rule instead of stacking a second, doubled gap. */}
        <Box>
          <Box style={styles.divider} />
          <Box style={styles.filterBar}>
            <TransactionFilterBar
              accounts={accountOptions}
              categories={categoryOptions}
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
          ref={listRef}
          testID="home-transactions"
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          renderSectionHeader={renderDayHeader}
          stickySectionHeadersEnabled={false}
          style={styles.list}
          contentContainerStyle={styles.listContent(listBottomClearance)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncAll} />}
          ListEmptyComponent={
            <Box style={styles.empty}>
              <Text tone="textSecondary">{t('home.emptyTransactions')}</Text>
            </Box>
          }
        />
      </Box>
    </Screen>
  );
};

export default HomeScreen;
