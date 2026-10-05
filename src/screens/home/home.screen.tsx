import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { useSyncAll } from '@kiko/sync/use-sync-all';
import Box from '@kiko/design-system/components/box';
import { useDataReady, useLiveQuery } from '@kiko/db';
import { categoriesRepo } from '@kiko/categories/repo';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { activeHoldings } from '@kiko/rates/active-holdings';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import MoneyText from '@kiko/design-system/components/money-text';
import { accountIdentity } from '@kiko/holdings/account-identity';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshControl, ScrollView, SectionList } from 'react-native';
import LoadingState from '@kiko/design-system/components/loading-state';
import { visibleSelection } from '@kiko/design-system/visible-selection';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type DaySection, groupByDay } from '@kiko/transactions/group-by-day';
import { defaultDateRange, endOfLocalDay, startOfLocalDay } from '@kiko/dates';
import type { FilterOption } from '@kiko/design-system/components/filter-menu';
import type { HomeStackParamList, TabParamList } from '@kiko/navigation/types';
import type { NativeBottomTabScreenProps } from '@bottom-tabs/react-navigation';
import CurrencyBreakdown from '@kiko/design-system/components/currency-breakdown';
import { type CompositeScreenProps, useIsFocused } from '@react-navigation/native';
import Screen, { resolveBottomClearance } from '@kiko/design-system/components/screen';
import { accountDisplayName, accountsForFilter } from '@kiko/holdings/implicit-account';
import { type FC, type ReactElement, useCallback, useMemo, useRef, useState } from 'react';
import { useScrollToTopOnTabPress } from '@kiko/navigation/use-scroll-to-top-on-tab-press';
import { buildRateTable, guardedBreakdown, guardedNetWorth } from '@kiko/rates/net-worth-view';

import { styles } from './home.styles';
import TransactionRow from './transaction-row';
import SyncProgressBar from './sync-progress-bar';
import AddTransactionFab from './add-transaction-fab';
import { useRefreshControlSignal } from './use-refresh-control-signal';
import TransactionFilterBar, { FILTER_ALL } from './transaction-filter-bar';
import type { HomeTransactionRow } from './transaction-row/transaction-row.props';

// Home lives in its own tab; some of its future navigation targets belong to
// the Accounts tab's stack. Composing the Home stack props with the tab props
// keeps that cross-tab navigation type-safe even though this screen no longer
// issues those navigate() calls itself.
type HomeScreenProps = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  NativeBottomTabScreenProps<TabParamList, 'HomeTab'>
>;

type DateRangeBounds = { from: number | undefined; to: number | undefined };

const NO_SECTIONS: DaySection<HomeTransactionRow>[] = [];

/**
 * The (inclusive) date-range bounds as raw instants, resolved ONCE per range
 * rather than once per transaction: `startOfLocalDay`/`endOfLocalDay` are
 * loop-invariant for every row the filter below checks against the SAME
 * `from`/`to`, so recomputing them per row was pure waste on a long list. The
 * `to` bound is pushed to the end of its calendar day — the last millisecond
 * before the NEXT local midnight (DST-correct; see `endOfLocalDay`) — so a
 * same-day transaction any time that day still matches, including on a
 * 25-hour fall-back day. A `null` side stays open-ended.
 */
const dateRangeBounds = (from: Date | null, to: Date | null): DateRangeBounds => ({
  from: foldMap(maybe(from), (date) => startOfLocalDay(date.getTime())),
  to: foldMap(maybe(to), (date) => endOfLocalDay(date.getTime())),
});

// Whether `time` falls within already-resolved (inclusive) bounds — a plain
// numeric comparison, so the filter that calls this per row never re-derives
// a local-day boundary from `from`/`to` for every transaction.
const withinBounds = (time: number, bounds: DateRangeBounds): boolean => {
  if (bounds.from !== undefined && time < bounds.from) {
    return false;
  }

  if (bounds.to !== undefined && time > bounds.to) {
    return false;
  }

  return true;
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
  const listRef = useRef<SectionList<HomeTransactionRow, DaySection<HomeTransactionRow>>>(null);
  useScrollToTopOnTabPress(listRef);

  // Read once here (rather than where the net-worth total needs it below) so
  // the date-range state below can seed off this same instant instead of a
  // second, separately-timed `Date.now()` read. The ledger query below needs
  // the range's bounds, so this block sits above the reads.
  const now = Date.now();

  // `customRange` holds an explicit user pick; `null` means "show the default
  // (last-30-days) range". The default is derived FRESH from `now` on every
  // render instead of being frozen once in a `useState` initializer — this
  // tab stays mounted after it is left, so a range seeded only at mount (or
  // at the last Clear) silently stopped including "today" once a calendar day
  // had passed. A user pick still stays exactly as given, even one side left
  // null (open-ended) via the date-range field.
  const [customRange, setCustomRange] = useState<{ from: Date | null; to: Date | null } | null>(
    null,
  );
  const defaultRange = defaultDateRange(now);
  const dateFrom = customRange !== null ? customRange.from : defaultRange.from;
  const dateTo = customRange !== null ? customRange.to : defaultRange.to;
  // Computed every render (cheap — two Date constructions, not the filter
  // below), but its VALUES are what the ledger read and `filteredTransactions`
  // key on: `bounds.from`/`bounds.to` are day-aligned numbers
  // (`startOfLocalDay`/`endOfLocalDay`), so they only change once per calendar
  // day even on the DEFAULT range, where `dateFrom`/`dateTo` are fresh `Date`
  // objects on every render (see `defaultDateRange`) — keying on those raw
  // `Date` objects would re-run the read, the filter (and the section
  // grouping, and the SectionList it feeds) on every single render instead of
  // once per day.
  const { from: boundsFrom, to: boundsTo } = dateRangeBounds(dateFrom, dateTo);

  // Deliberately `paused` (not `enabled`) while another tab or a form shows:
  // this screen stays mounted, so its subscriptions stay and a write elsewhere
  // only marks each query dirty — hiding Home costs no read and no re-render,
  // and returning to it runs one read per dirty query (`enabled: false` would
  // unsubscribe and drop every list to empty; see kiko-architecture's
  // `paused` vs `enabled`).
  const isFocused = useIsFocused();
  const liveOptions = { cached: true, paused: !isFocused } as const;

  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.listQuery(),
    ['accounts'],
    true,
    liveOptions,
  );
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    true,
    liveOptions,
  );
  const { data: rates, isLoading: ratesLoading } = useLiveQuery(
    ratesRepo.allQuery(),
    ['currency_rates'],
    true,
    liveOptions,
  );
  // kiko-architecture: skip the price_points read while nothing rendered on
  // this screen ever reads it — a holding whose type carries no priced spec
  // and is not a loan (`needsPriceBook`) never touches `price_points`. It
  // stays enabled while holdings are still on their first load, so the two
  // reads run in parallel instead of price_points waiting on holdings. Only a
  // loan reads the linked-payments half of the book.
  const { book: priceBook, isLoading: priceBookLoading } = useCurrentPriceBook(
    holdingsLoading || holdings.some((holding) => needsPriceBook(holding.type)),
    liveOptions,
    holdingsLoading || holdings.some((holding) => holding.type === 'loan'),
    now,
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  // The ledger rows of the picked date range only, not the whole ledger: it
  // grows with every transaction ever synced and re-reads on every write. The
  // range filter below still applies; the two reads after it carry what the
  // screen shows of the rows OUTSIDE the range (their span and categories).
  const { data: transactions, isLoading: transactionsLoading } = useLiveQuery(
    transactionsRepo.listWithContextBetweenQuery(boundsFrom, boundsTo),
    ['transactions', 'holdings', 'accounts'],
    true,
    liveOptions,
  );
  const { data: spanRows, isLoading: spanLoading } = useLiveQuery(
    transactionsRepo.contextSpanQuery(),
    ['transactions', 'holdings', 'accounts'],
    true,
    liveOptions,
  );
  const { data: categoryRows, isLoading: categoryRowsLoading } = useLiveQuery(
    transactionsRepo.contextCategoriesQuery(),
    ['transactions', 'holdings', 'accounts'],
    true,
    liveOptions,
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    liveOptions,
  );
  // The net-worth headline (it would otherwise read 0 while still loading)
  // and the empty-transactions text must never render while any of this
  // screen's own queries is still on its first load (kiko-architecture's
  // useLiveQuery consumer rule) — gated below, right at the return.
  const isReady = useDataReady(
    accountsLoading,
    holdingsLoading,
    ratesLoading,
    priceBookLoading,
    settingsLoading,
    transactionsLoading,
    spanLoading,
    categoryRowsLoading,
    categoriesLoading,
  );
  // `useDataReady` is true only until a query re-keys: the window read does on
  // every date-range pick and clear and when the local day rolls over, and the
  // price book does when a holding turns it on and on a day roll; each re-key
  // reads loading again. Swapping the whole screen for the spinner then would
  // drop the filter bar and its open sheet for a read that only affects one
  // part, so only the FIRST ready gates the whole screen. Each re-keyable read
  // is gated where it is shown: the list on `transactionsLoading`, the net-worth
  // card on `priceBookLoading`.
  const hasBeenReady = useRef(false);
  hasBeenReady.current ||= isReady;

  // `buildCategoryDisplayMap` resolves each default category's title through i18n
  // (`resolveDefaultCategoryTitle`) INTERNALLY, so `i18n.language` is a real dependency Biome
  // cannot see — without it a live language switch leaves the resolved titles in the previous
  // language.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(localized label)
  const categoryByKey = useMemo(
    () => buildCategoryDisplayMap(categories),
    [categories, i18n.language],
  );

  // Pull-to-refresh fans out a fresh sync over every syncable account (the
  // connected Monobank account plus each connected crypto account) at once,
  // bypassing the auto-sync throttle. `failures` names any account that failed
  // so a partial success can still surface which one(s) did not update.
  const { failures, syncAll } = useSyncAll(accounts);

  // The native RefreshControl below is the PULL GESTURE indicator ALONE, DECOUPLED
  // from the whole sync run: the hook wraps `syncAll`, sets a local flag
  // synchronously on the pull so the spinner is already on in the commit right
  // after it, and ends the spinner when the FAST balance phase resolves (not on
  // the whole run, which fought iOS across navigation/detach/scroll). The
  // whole-run indicator is the determinate `SyncProgressBar` below. See
  // `use-refresh-control-signal.ts`.
  const { refreshing, onRefresh } = useRefreshControlSignal(syncAll);

  // Each dimension holds a set of selected values; an empty set means "all".
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  const clearDateRange = (): void => {
    setCustomRange(null);
  };

  // The date-range modal commits both bounds at once on Apply; either may be
  // null when that side of the range is left open-ended.
  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setCustomRange({ from, to });
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
  const total = guardedNetWorth(active, baseCurrency, rateTable, now, priceBook);
  const breakdown = guardedBreakdown(active, baseCurrency, rateTable, now, priceBook);

  // The full span of transaction dates, shown as the date-range field's default
  // display when no range is active. It never filters — it only tells the user
  // the range their data covers. With no transactions both bounds fall back to
  // today so the field always has something to render.
  // The earliest/latest time come from the database in one aggregate row (null
  // for an empty ledger), not from the rows this screen holds: those are only
  // the picked range's, so they would shrink the span to the range itself.
  const ledgerSpan = spanRows.at(0);
  const spanStart = ledgerSpan?.earliest ?? now;
  const spanEnd = ledgerSpan?.latest ?? now;

  // The date-range field's *selectable* bounds are distinct from the display
  // span above: the earliest a user may pick is the earliest transaction's day
  // (`spanStart`, falling back to today when there are no transactions, and
  // passed through as `minDate`), and the latest is today — future dates are
  // never selectable. The field derives its selectable floor from `minDate`
  // (= `spanStart`) and its ceiling from today itself, so the display span
  // (earliest–latest transaction) stays independent of the selectable range.

  // Every active (non-archived) account, so a newly-added account with no
  // transactions yet still appears in the Accounts filter, except an implicit
  // account with no holding left (`accountsForFilter`). Sourced from the
  // accounts live query rather than from the transactions, which would omit it.
  // Each option carries the account's own identity icon + color for the
  // menu row; transaction matching keys off `option.value` (the account ID,
  // matched against `row.accountId` below), never a name: two accounts may share
  // a name (a renamed implicit account, two banks), a rename must keep the
  // selection, and a name may equal the "All" option's value. The id is also
  // language-independent, so a selection survives a language switch; only the
  // option's `label` is the display name.
  const accountOptions = useMemo(
    () =>
      accountsForFilter(accounts, holdings).map((account) => ({
        value: account.id,
        label: accountDisplayName(account, t),
        ...accountIdentity(account),
      })),
    [accounts, holdings, t],
  );
  // The stored selection can name an account that was archived or deleted since,
  // with no checked row left to clear it, so only the ids still among the options
  // filter and count; an empty result is "All".
  const visibleSelectedAccounts = useMemo(
    () =>
      visibleSelection(
        selectedAccounts,
        accountOptions.map((option) => option.value),
      ),
    [selectedAccounts, accountOptions],
  );
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
  // `resolveCategoryDisplay` resolves a default category's title through i18n INTERNALLY (not via
  // a captured variable Biome can see), so `i18n.language` is a real dependency — without it a
  // live language switch leaves the option labels in the previous language.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(localized label)
  const categoryOptions = useMemo(() => {
    const byKey = new Map<string, FilterOption>();

    // Every category the ledger holds, not only the picked range's: each
    // stored category once, in the order the newest-first ledger meets it.
    for (const row of categoryRows) {
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
    categoryRows,
    categories,
    categoryByKey,
    defaultCategoryKey,
    categoryKeyForRow,
    i18n.language,
  ]);
  const filteredTransactions = useMemo(() => {
    return transactions.filter((row) => {
      const matchesAccount =
        visibleSelectedAccounts.size === 0 || visibleSelectedAccounts.has(row.accountId);
      const matchesCategory =
        selectedCategories.size === 0 || selectedCategories.has(categoryKeyForRow(row.category));
      const matchesDate = withinBounds(row.time, { from: boundsFrom, to: boundsTo });

      return matchesAccount && matchesCategory && matchesDate;
    });
  }, [
    transactions,
    visibleSelectedAccounts,
    selectedCategories,
    boundsFrom,
    boundsTo,
    categoryKeyForRow,
  ]);

  // Grouping/sorting happens after filtering, over the query's newest-first
  // order (transactionsRepo orders by time desc), so sections come out
  // newest-day-first with each day's rows newest-first. Keyed on the local DAY
  // (not the per-render `now` millisecond): the day headers only change at
  // midnight, so this recomputes when the filtered rows change or the day rolls,
  // not on every reactive fire during a sync.
  const todayStart = startOfLocalDay(now);
  // The rows RENDER the account's display name (an implicit account's stored
  // name is an English sentinel); the filter above matched the stored one.
  const sections = useMemo(
    () =>
      groupByDay(
        filteredTransactions.map((row) => ({
          ...row,
          accountName: accountDisplayName(
            { kind: row.accountKind, name: row.accountName, archivedAt: row.accountArchivedAt },
            t,
          ),
        })),
        todayStart,
        t,
      ),
    [filteredTransactions, todayStart, t],
  );

  // Navigating to the shared Transaction form is stable across renders (it
  // closes over `navigation` alone), so the memoized rows below never re-render
  // just because a new press handler identity was created.
  const handleRowPress = useCallback(
    (transactionId: string): void => {
      navigation.navigate('TransactionForm', { transactionId });
    },
    [navigation],
  );

  // Duplicating a row opens the create form pre-filled from it, stateless
  // via the `duplicateOfTransactionId` route param. Stable across renders (it
  // closes over `navigation` alone), like `handleRowPress`, so the memoized
  // rows never re-render on a new handler identity.
  const handleRowDuplicate = useCallback(
    (transactionId: string): void => {
      navigation.navigate('TransactionForm', { duplicateOfTransactionId: transactionId });
    },
    [navigation],
  );

  // The global-add FAB (B) opens the create form with EMPTY params — no holding
  // fixed by navigation — so the form renders its own primary-leg holding
  // picker. Stable across renders (closes over `navigation` alone).
  const handleAddTransaction = useCallback((): void => {
    navigation.navigate('TransactionForm', {});
  }, [navigation]);

  // A stable `renderItem` identity is what lets the SectionList row bail-out
  // engage: the row body now lives in the memoized `TransactionRow` component,
  // so an unchanged row skips re-rendering when the screen re-renders (e.g. a
  // reactive fire during a sync) as long as its props are unchanged.
  const renderTransaction = useCallback(
    ({ item }: { item: HomeTransactionRow }): ReactElement => {
      return (
        <TransactionRow
          item={item}
          categoryByKey={categoryByKey}
          defaultCategoryKey={defaultCategoryKey}
          holdingNameById={holdingNameById}
          categoryKeyForRow={categoryKeyForRow}
          onPress={handleRowPress}
          onDuplicate={handleRowDuplicate}
        />
      );
    },
    [
      categoryByKey,
      defaultCategoryKey,
      holdingNameById,
      categoryKeyForRow,
      handleRowPress,
      handleRowDuplicate,
    ],
  );

  const renderDayHeader = useCallback(
    ({ section }: { section: DaySection<HomeTransactionRow> }): ReactElement => {
      // The content column already spaces the list one `gap` below the pinned
      // filter/sync band, so the FIRST day header drops its day-separator top pad
      // — otherwise the gap above the list would read larger than the equal gaps
      // between the filters row, the sync-progress bar, and the list. Later
      // headers keep the pad to separate day groups within the list.
      const isFirstSection = sections[0] === section;

      return (
        <Box
          testID="home-day-header"
          style={[styles.sectionHeader, isFirstSection && styles.firstSectionHeader]}
        >
          <Text variant="caption" tone="textSecondary">
            {section.title}
          </Text>
        </Box>
      );
    },
    [sections],
  );

  if (!hasBeenReady.current) {
    return (
      // The SAME Screen mode as the ready branch below (`bleedBottom`), the
      // determinate sync progress bar (it shows the sync this screen's own
      // first read is queued behind — see kiko-architecture's op-sqlite
      // one-worker-thread section), and pull-to-refresh on the same scroll
      // view the ready branch offers, once the accounts query has loaded, so
      // a user can still trigger a fresh sync while this screen's own
      // queries are still loading.
      <Screen bleedBottom>
        <Box gap={4} style={styles.content}>
          <SyncProgressBar />
          <ScrollView
            testID="home-loading-scroll"
            style={styles.list}
            contentContainerStyle={styles.listContent(listBottomClearance)}
            // `syncAll` fans a job out over the `accounts` query's own data
            // (`useSyncAll(accounts)` above) — pulling before that query has
            // loaded would fan out over an empty list, syncing nothing while
            // still holding the fan-out's single-flight lock.
            refreshControl={
              accountsLoading ? undefined : (
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              )
            }
          >
            <LoadingState testID="home-loading" />
          </ScrollView>
        </Box>
      </Screen>
    );
  }

  return (
    // The SectionList below is this screen's own scrollable surface and applies
    // the tab-bar clearance to its own content (`listContent`), so Screen must
    // not also reserve it — `bleedBottom` drops Screen's own content clearance
    // to avoid double-counting the gap below the last transaction row.
    <Screen bleedBottom>
      <Box gap={4} testID="home-content" style={styles.content}>
        <Card padding={4} radius="lg">
          {/* The price book changes after the first ready: the first metal,
              share, property or loan holding turns its read on, and a day roll
              re-keys it. Until the read lands the book is empty (turned on
              again) or holds the earlier day's rows (a day roll), so a metal
              would drop to its cost or an old price and a loan would be valued
              without its payments: the headline and the breakdown wait for it,
              nothing else does. */}
          {priceBookLoading ? (
            <LoadingState testID="home-net-worth-loading" />
          ) : (
            <Box gap={1} style={styles.header}>
              <Text variant="caption" tone="textSecondary">
                {t('home.netWorth')}
              </Text>

              <MoneyText money={total} context="balance" style={styles.balance} />

              <Box style={styles.breakdown}>
                <CurrencyBreakdown items={breakdown} />
              </Box>
            </Box>
          )}
        </Card>

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
          <Divider />
          <Box style={styles.filterBar}>
            <TransactionFilterBar
              accounts={accountOptions}
              categories={categoryOptions}
              selectedAccount={visibleSelectedAccounts}
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

        {/* The determinate whole-run sync progress bar is PINNED here, above the
            SectionList and OUTSIDE its scroll content — never a
            `ListHeaderComponent`. As the list header it scrolled away with the
            content and drew behind the cells; pinning it above the list keeps it
            in view for the whole run and removes the z-index symptom by
            construction. It hides itself when no sync is fetching. The content
            column's `gap(4)` sits between it and the list. */}
        <SyncProgressBar />

        {/* While a new range's window read loads, `transactions` still holds the
            previous range's rows and the empty text would be a lie, so the list
            shows no section and the loading state in the empty slot. The list
            stays mounted: it is the scroll view that carries pull-to-refresh and
            the large-title collapse. */}
        <SectionList
          ref={listRef}
          testID="home-transactions"
          sections={transactionsLoading ? NO_SECTIONS : sections}
          keyExtractor={(item) => item.id}
          renderItem={renderTransaction}
          renderSectionHeader={renderDayHeader}
          stickySectionHeadersEnabled={false}
          style={styles.list}
          contentContainerStyle={styles.listContent(listBottomClearance)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            transactionsLoading ? (
              <LoadingState testID="home-transactions-loading" />
            ) : (
              <Box style={styles.empty}>
                <Text tone="textSecondary">{t('home.emptyTransactions')}</Text>
              </Box>
            )
          }
        />

        {/* The global-add FAB is an ADDITIVE sibling of the SectionList, OUTSIDE
            its scroll content, pinned bottom-right and lifted clear of the
            floating tab bar by the same `listBottomClearance` the list uses. */}
        <AddTransactionFab onPress={handleAddTransaction} bottomOffset={listBottomClearance} />
      </Box>
    </Screen>
  );
};

export default HomeScreen;
