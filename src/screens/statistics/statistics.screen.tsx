import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { categoriesRepo } from '@kiko/categories/categories.repo';
import { holdingsRepo } from '@kiko/holdings/holdings.repo';
import { rateHistoryRepo } from '@kiko/rates/rate-history.repo';
import { ratesRepo } from '@kiko/rates/rates.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { transactionsRepo } from '@kiko/transactions/transactions.repo';
import { type FC, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScrollViewInstance } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';

import { buildCategoryDisplayMap, DEFAULT_CATEGORY_KEY } from '../../categories/category-display';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { defaultDateRange } from '../../dates/default-range';
import { endOfLocalDay, startOfLocalDay } from '../../dates/local-day';
import { useLiveQuery } from '../../db/use-live-query';
import BarChart from '../../design-system/components/bar-chart';
import Box from '../../design-system/components/box';
import CategoryTrendLine from '../../design-system/components/category-trend-line';
import GlassSurface from '../../design-system/components/glass-surface';
import NetWorthLine from '../../design-system/components/net-worth-line';
import PieChart from '../../design-system/components/pie-chart';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import { resolveEntityColor } from '../../design-system/entity-tint';
import { defaultAccountColor } from '../../holdings/entity-colors';
import { ibanOf } from '../../holdings/holding-metadata';
import { useScrollToTopOnTabPress } from '../../navigation/use-scroll-to-top-on-tab-press';
import {
  type BackfillStatus,
  deriveLastBackfilledDay,
  missingDays,
  runBackfill,
} from '../../rates/history-backfill';
import { buildRateTable } from '../../rates/net-worth-view';
import { type AccountSlice, buildAccountContribution } from '../../statistics/account-contribution';
import { bucketDaysForSpan } from '../../statistics/buckets';
import {
  type BreakdownTransaction,
  buildCategoryBreakdown,
  type CategorySlice,
} from '../../statistics/category-breakdown';
import {
  buildCategoryMeasures,
  buildCategoryTrend,
  type TrendTransaction,
} from '../../statistics/category-trend';
import { exchangeExcludedTxIds } from '../../statistics/exchange-exclusion';
import type { SeriesTransaction } from '../../statistics/holding-value-at';
import { internalTransferTxIds } from '../../statistics/internal-transfers';
import { buildNetWorthSeries } from '../../statistics/net-worth-series';
import {
  descriptionExcludedTransferTxIds,
  mccExcludedTransferTxIds,
} from '../../statistics/transfer-exclusion';
import {
  resolveTrendFilter,
  selectTopCategories,
  type TrendFilter,
} from '../../statistics/trend-filter';
import { buildTypeBreakdown } from '../../statistics/type-breakdown';
import { transactionSpan } from '../../transactions/transaction-span';
import DateRangeField from '../home/date-range-field';
import FilterMenu, { FILTER_ALL, type FilterOption } from '../home/filter-menu';

import { styles } from './statistics.styles';
import TrendFilterField from './trend-filter-field';

// Adapt a category spending slice onto the shared `PieChart` slice shape: the
// category KEY is the slice identity (its React key + testID suffix), its title
// the legend label. Same donut, a spending-by-category dimension instead of
// per-account contribution.
const toPieSlice = (slice: CategorySlice): AccountSlice => ({
  accountId: slice.key,
  name: slice.title,
  amount: slice.amount,
  share: slice.share,
  color: slice.color,
});

// A FilterMenu toggle for either dimension (accounts, categories): the
// `FILTER_ALL` row clears the dimension; any other value toggles in/out. A fresh
// Set keeps the state update immutable.
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

// Group the whole ledger by holding id so the net-worth series can reconstruct
// each holding's running balance over time. Keyed by holding, not account,
// because a holding's balance is what the series values at each day.
const groupByHolding = (
  transactions: { holdingId: string; time: number; amountMinorUnits: number }[],
): Map<string, SeriesTransaction[]> => {
  const byHolding = new Map<string, SeriesTransaction[]>();

  for (const transaction of transactions) {
    const list = byHolding.get(transaction.holdingId) ?? [];
    list.push({ time: transaction.time, amountMinorUnits: transaction.amountMinorUnits });
    byHolding.set(transaction.holdingId, list);
  }

  return byHolding;
};

// The category-spending donut's ring is thinner than the default (a higher
// hole-radius-to-outer-radius ratio) than PieChart's own default, opening
// enough center room for its total figure — see `centerTotal` below. The
// account-contribution pie keeps PieChart's default ring; its own total
// already reads elsewhere on this screen (the by-type bar / net-worth line),
// so it renders no center total and has no need to thin its ring for one.
const CATEGORY_DONUT_INNER_RATIO = 0.78;

// The category donut can have a long tail of tiny categories, so its legend
// crops to categories at 5% share or more by default, with a "Show all" toggle
// to reveal the rest. The ring still draws every category. The
// account-contribution pie passes no threshold, so its legend is uncropped.
const CATEGORY_LEGEND_MIN_SHARE = 0.05;

/**
 * The Statistics tab: four blocks, in order — a converted net-worth line over
 * time (historical rates), a by-type horizontal bar chart of current value, a
 * per-account pie of current net worth, and an "Expenses by Category" donut. A
 * shared account multi-select scopes all four blocks. The date range bounds
 * the net-worth line's window AND the category donut's transaction set; the
 * by-type bar and the account pie are "now" snapshots of current value and
 * read no range at all. The category donut additionally has its own,
 * separate category filter (title, then filter, then chart) and shows the
 * summed spend at its center. The bar and pies render immediately off the
 * current rate table; the line reads the historical rate-history table and
 * shows a loading state while an incremental, non-blocking backfill fills it
 * in. All the chart math lives in `src/statistics/`; this screen only shapes
 * repository rows, holds the filter state, and drives the backfill.
 */
const StatisticsScreen: FC = () => {
  const { t, i18n } = useTranslation();

  // Re-tapping the Statistics tab while already on it returns this scrolling
  // page to the top (the standard iOS active-tab re-tap), driven off the native
  // tab navigator's `tabPress`.
  const scrollRef = useAnimatedRef<ScrollViewInstance>();
  // The live `contentOffset.y`, so the hook can skip a redundant scroll.
  const scrollOffset = useScrollOffset(scrollRef);
  useScrollToTopOnTabPress(scrollRef, scrollOffset);

  const { data: accounts } = useLiveQuery(accountsRepo.listQuery(), ['accounts']);
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listAllQuery(), ['transactions']);
  const { data: historyRows } = useLiveQuery(rateHistoryRepo.historyRowsQuery(), [
    'currency_rate_history',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);

  // An empty set means "all accounts"; any names in it narrow all three charts.
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());

  // The spending pie's own category filter, in the SAME "empty means all" model
  // the account FilterMenu uses: an empty set includes every category; any
  // stable category KEYS in it narrow the pie to just those (never the
  // language-dependent display title — see categoryOptions below). Scoped to
  // that chart alone — the account filter and date range do not touch it, nor
  // it them.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());

  // `now` is fixed at mount: the default date-range seed below, the default
  // line window, the backfill's "today", and every memo below key on it, and a
  // fresh `Date.now()` each render would defeat that memoization.
  const now = useMemo(() => Date.now(), []);

  // The date-range bounds default to the last 30 days on mount; a user pick
  // can still set either to null (open-ended) via the date-range field.
  const [dateFrom, setDateFrom] = useState<Date | null>(() => defaultDateRange(now).from);
  const [dateTo, setDateTo] = useState<Date | null>(() => defaultDateRange(now).to);

  const applyDateRange = (from: Date | null, to: Date | null): void => {
    setDateFrom(from);
    setDateTo(to);
  };

  const clearDateRange = (): void => {
    const range = defaultDateRange();
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // The configurable catch-all: a null/empty category folds into this category's
  // slice. Read from settings (seeded to `other`), passed into the breakdown.
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const rateTable = useMemo(() => buildRateTable(rates), [rates]);

  // Only non-archived accounts are ever shown; the account filter narrows within
  // those, and a holding then feeds the charts only when it is open AND its
  // account survived that filter. Memoized so all three builders below key off a
  // stable collection instead of a fresh array on every render.
  const filtered = useMemo(() => {
    const visibleAccounts = accounts.filter((account) => account.archivedAt == null);
    const filteredAccounts = visibleAccounts.filter((account) => {
      return selectedAccounts.size === 0 || selectedAccounts.has(account.name);
    });
    const filteredAccountIds = new Set(filteredAccounts.map((account) => account.id));
    const visibleHoldings = holdings.filter((holding) => {
      return holding.closedAt == null && filteredAccountIds.has(holding.accountId);
    });

    return { visibleAccounts, filteredAccounts, visibleHoldings };
  }, [accounts, holdings, selectedAccounts]);

  // The full transaction span drives the date field's default display, the line's
  // default window, and the backfill's earliest day. With no transactions the
  // start falls back to now.
  // Earliest transaction time in ONE O(n) pass (see `transactionSpan`);
  // `Math.min(...times)` spread the whole array and overflowed the stack on a
  // long history. Memoized on `transactions` alone; the empty-list fallback to
  // `now` is applied outside so a per-render `now` never invalidates the memo.
  const earliestTime = useMemo(
    () =>
      transactions.length > 0
        ? transactionSpan(
            transactions.map((transaction) => transaction.time),
            0,
          ).start
        : null,
    [transactions],
  );
  const spanStart = earliestTime ?? now;

  // The line's effective window: the picked range when set, otherwise the full
  // transaction span (earliest transaction to now). Both bounds are TRUE local
  // midnight (`startOfLocalDay`/`endOfLocalDay`, same helpers Home uses), never
  // a UTC-anchored approximation — a Kyiv (UTC+2/+3) pick using `Date.UTC(y, m,
  // d)` instead used to exclude the first 2-3 local hours of every picked day
  // from this range, silently dropping them from the donut and the net-worth
  // line. `buildNetWorthSeries` (below) does its OWN UTC-day normalization per
  // bucket internally (`toUtcMidnight`, since `currency_rate_history.day` is
  // UTC-midnight) — that is a rate LOOKUP KEY concern, entirely separate from
  // these user-facing range bounds, and this screen has no other UTC-day-key
  // use, so no local `utcDayKey`-style helper is needed here. The `to` bound
  // extends to the end of its day so a same-day pick still captures that
  // day's buckets, DST-correct on a 23/25-hour local day.
  const rangeFrom = dateFrom !== null ? startOfLocalDay(dateFrom.getTime()) : spanStart;
  const rangeTo = dateTo !== null ? endOfLocalDay(dateTo.getTime()) : now;

  // The resume point for the backfill: the newest day already stored, derived
  // from the history table itself (no extra persistence). Null when empty.
  const lastBackfilledDay = useMemo(() => deriveLastBackfilledDay(historyRows), [historyRows]);

  // Drive the incremental, non-blocking backfill and surface its status to the
  // line. It runs at most once per mount, only when there is a bounded span
  // (transactions exist) with days still to fill; the ref guards against the
  // re-render the backfill's own writes trigger (which advance `lastBackfilledDay`
  // and would otherwise re-enter). The bar and pie never wait on this.
  const backfillStartedRef = useRef(false);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>({
    state: 'idle',
    lastDay: null,
  });

  useEffect(() => {
    if (backfillStartedRef.current || transactions.length === 0) {
      return;
    }
    if (missingDays(spanStart, lastBackfilledDay, now).length === 0) {
      setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });

      return;
    }

    backfillStartedRef.current = true;
    setBackfillStatus({ state: 'loading', lastDay: lastBackfilledDay });
    let cancelled = false;
    runBackfill({ earliestDay: spanStart, lastBackfilledDay, today: now })
      .then((status) => {
        if (!cancelled) {
          setBackfillStatus(status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackfillStatus({ state: 'complete', lastDay: lastBackfilledDay });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [transactions.length, spanStart, lastBackfilledDay, now]);

  // Bar + pie value "now" on the current rate table; the line values each day on
  // the historical table. All three are memoized on their real inputs so they no
  // longer run every render; the line coarsens its day bucket on a long window
  // (see `bucketDaysForSpan`) so the point count stays bounded on multi-year
  // spans.
  const typeSlices = useMemo(
    () =>
      buildTypeBreakdown({
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
      }),
    [filtered, rateTable, baseCurrency, now],
  );

  const netWorth = useMemo(
    () =>
      buildNetWorthSeries({
        holdings: filtered.visibleHoldings,
        txByHolding: groupByHolding(transactions),
        historyRows,
        baseCurrency,
        range: { from: rangeFrom, to: rangeTo },
        bucketDays: bucketDaysForSpan(rangeTo - rangeFrom),
        // Value today's rightmost point on the same live rates the bar/pie/
        // headline use, so the line's "now" reconciles with them instead of
        // sitting a few percent off on the day's NBU official rate.
        liveRateTable: rateTable,
        today: now,
      }),
    [filtered, transactions, historyRows, baseCurrency, rangeFrom, rangeTo, rateTable, now],
  );

  const slices = useMemo(
    () =>
      buildAccountContribution({
        accounts: filtered.filteredAccounts,
        holdings: filtered.visibleHoldings,
        rateTable,
        baseCurrency,
        now,
      }),
    [filtered, rateTable, baseCurrency, now],
  );

  // The spending pie sums EXPENSE transactions (negative amounts) by category, in
  // the base currency. A transaction has no currency of its own — its amount is
  // in its holding's currency — so join each transaction to its (account-scoped,
  // open) holding for the currency, dropping any whose holding is filtered out.
  // The category display map is built here so a rename flows straight through.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(language-dependent resolver) buildCategoryDisplayMap resolves each un-renamed default category's title through resolveDefaultCategoryTitle, which reads the active language off the global i18next singleton (see category-display.ts) rather than off anything in this closure — the callback body never references `i18n.language` directly, but the memo must still invalidate on it, or a live language switch would keep serving the stale, previously-built titles.
  const categoryByKey = useMemo(
    () => buildCategoryDisplayMap(categories),
    [categories, i18n.language],
  );

  // Join each transaction to its (account-scoped, open) holding for the currency
  // its amount is in — a transaction row has no currency of its own — dropping
  // any whose holding is filtered out. BOTH signs are kept so the internal-
  // transfer matcher below can see the credit legs.
  //
  // Deliberately NOT range-filtered: every exclusion rule below (the matched-
  // pair internal-transfer matcher especially) must see BOTH legs of a
  // transfer even when only one falls inside the active range, or a pair that
  // straddles `rangeFrom`/`rangeTo` gets only half-excluded and its in-range
  // leg wrongly counts as spending. The range is applied further down, only
  // to the rows that actually feed the breakdown (see
  // `rangeFilteredBreakdownTransactions`) — exclusion is by id, so an
  // out-of-range leg excluded here never reaches the breakdown anyway.
  const transactionsWithCurrency = useMemo(() => {
    const currencyByHolding = new Map(
      filtered.visibleHoldings.map((holding) => [holding.id, holding.currency]),
    );

    return transactions.flatMap((transaction) => {
      const currency = currencyByHolding.get(transaction.holdingId);
      if (currency === undefined) {
        return [];
      }

      return [{ ...transaction, currency }];
    });
  }, [transactions, filtered]);

  // INTERNAL TRANSFERS (a matched -X / +X pair across two of the user's own
  // holdings, same currency, near-simultaneous) are not spending. Their debit
  // legs are dropped from the category breakdown by id below; the credit legs
  // are already ignored as income. Scoped to THIS chart only — every other view
  // (net worth, by-type, account pie) still sees the full ledger.
  const internalTransferIds = useMemo(
    () => internalTransferTxIds(transactionsWithCurrency),
    [transactionsWithCurrency],
  );

  const breakdownTransactions = useMemo<BreakdownTransaction[]>(
    () =>
      transactionsWithCurrency.map((transaction) => ({
        id: transaction.id,
        category: transaction.category,
        amountMinorUnits: transaction.amountMinorUnits,
        mcc: transaction.mcc,
        counterIban: transaction.counterIban,
        description: transaction.description,
        exchangeCounterpartHoldingId: transaction.exchangeCounterpartHoldingId,
        currency: transaction.currency,
      })),
    [transactionsWithCurrency],
  );

  // The active-range slice of `transactionsWithCurrency`: this is what
  // actually feeds the breakdown drawn on screen (both the filter menu's
  // option list and the pie itself — see `allCategorySlices`/`categorySlices`
  // below), so the donut and its center total agree with the range field
  // rendered above them. The exclusion sets above are computed over the
  // FULL, unfiltered ledger (see `transactionsWithCurrency`'s comment); only
  // the rows actually SHOWN are scoped to the range here.
  const rangeFilteredBreakdownTransactions = useMemo<BreakdownTransaction[]>(
    () =>
      transactionsWithCurrency
        .filter((transaction) => transaction.time >= rangeFrom && transaction.time <= rangeTo)
        .map((transaction) => ({
          id: transaction.id,
          category: transaction.category,
          amountMinorUnits: transaction.amountMinorUnits,
          mcc: transaction.mcc,
          counterIban: transaction.counterIban,
          description: transaction.description,
          exchangeCounterpartHoldingId: transaction.exchangeCounterpartHoldingId,
          currency: transaction.currency,
        })),
    [transactionsWithCurrency, rangeFrom, rangeTo],
  );

  // The spending-trend builder needs everything the breakdown does PLUS each
  // row's `time`, so it can bucket the expense into its UTC-day within the last
  // 30 days. Built separately from `breakdownTransactions` (which carries no
  // time) so neither memo has to change shape for the other.
  const trendTransactions = useMemo<TrendTransaction[]>(
    () =>
      transactionsWithCurrency.map((transaction) => ({
        id: transaction.id,
        category: transaction.category,
        amountMinorUnits: transaction.amountMinorUnits,
        mcc: transaction.mcc,
        counterIban: transaction.counterIban,
        description: transaction.description,
        exchangeCounterpartHoldingId: transaction.exchangeCounterpartHoldingId,
        currency: transaction.currency,
        time: transaction.time,
      })),
    [transactionsWithCurrency],
  );

  // The user's OWN card IBANs, read from each holding's stored metadata. A 4829
  // bank transfer to one of these is an own-account transfer (excluded from the
  // spending pie); a 4829 to any other IBAN is a genuine P2P payment (kept).
  const ownIbans = useMemo(() => {
    const ibans = new Set<string>();
    for (const holding of holdings) {
      const iban = ibanOf(holding.metadata);
      if (iban !== undefined) {
        ibans.add(iban);
      }
    }

    return ibans;
  }, [holdings]);

  // Cash-outs and OWN-account transfers, classified by mcc (+ counterIban for
  // the ambiguous 4829). This catches the single-legged movements the matched-
  // pair matcher structurally cannot (a cash-out has no synced credit leg).
  const mccExcludedIds = useMemo(
    () => mccExcludedTransferTxIds(breakdownTransactions, ownIbans),
    [breakdownTransactions, ownIbans],
  );

  // Internal transfers that carry a plain description instead of a transfer MCC
  // (e.g. "Поповнення депозиту", "На чорну картку", the FOP top-up). The mcc
  // rule structurally cannot see these; the description rule catches them.
  const descriptionExcludedIds = useMemo(
    () => descriptionExcludedTransferTxIds(breakdownTransactions),
    [breakdownTransactions],
  );

  // Exchange/Convert legs: an internal movement between the user's own
  // holdings, structurally marked by `exchangeCounterpartHoldingId`. No other
  // rule can see them — null mcc, empty description, and a cross-currency
  // pair the matched-pair matcher rejects.
  const exchangeExcludedIds = useMemo(
    () => exchangeExcludedTxIds(breakdownTransactions),
    [breakdownTransactions],
  );

  // The union of every exclusion rule: the mcc/IBAN rule, the description rule,
  // the exchange-marker rule, and the cheap secondary matched-pair matcher. A
  // row is dropped from the spending pie if ANY rule catches it.
  const excludedTransactionIds = useMemo(
    () =>
      new Set([
        ...internalTransferIds,
        ...mccExcludedIds,
        ...descriptionExcludedIds,
        ...exchangeExcludedIds,
      ]),
    [internalTransferIds, mccExcludedIds, descriptionExcludedIds, exchangeExcludedIds],
  );

  // The active-range breakdown of every spending category (category-filter-
  // unaware): it feeds the filter menu's option list, and — translated below
  // — the exclusion the pie applies. Scoped to `rangeFilteredBreakdownTransactions`
  // (not the full `breakdownTransactions`) so the filter menu never offers a
  // category with zero spending IN the visible range.
  const allCategorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: rangeFilteredBreakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        excludedTransactionIds,
      }),
    [
      rangeFilteredBreakdownTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedTransactionIds,
    ],
  );

  // The FilterMenu matches/stores by the STABLE `categories.key` slug, never by
  // the resolved display title: the title is language-dependent (a default
  // category's title changes under a live language switch — see
  // resolveDefaultCategoryTitle), so keying selection on it would silently
  // desync the moment the app language changes, leaving a stale Set of
  // now-nonexistent title strings (the same bug the Home screen's category
  // filter had — see category-display.ts's resolveCategoryKey). The menu's
  // options are one per distinct slice KEY, each carrying the slice's own icon +
  // color and its current localized title as the row's `label`; a selection is
  // translated back into the set of KEYS to EXCLUDE from the pie: an empty
  // selection excludes nothing (all included), otherwise every category whose
  // KEY is not selected is excluded. De-duplicated by key, first-seen-wins.
  const categoryOptions = useMemo(() => {
    const byKey = new Map<string, FilterOption>();
    for (const slice of allCategorySlices) {
      if (byKey.has(slice.key)) {
        continue;
      }
      byKey.set(slice.key, {
        value: slice.key,
        label: slice.title,
        icon: slice.icon,
        color: slice.color,
      });
    }

    // Present the options in the user's CUSTOM category order — the live
    // `categories` query is already sorted `asc(sortOrder), asc(key)` (see
    // categories.repo's allQuery) — not in the spending-magnitude order the
    // breakdown happens to emit. Ranked by the STABLE lowercased slug (never
    // the localized title — see the block comment above about language
    // desync), so the ordering holds across a live language switch. An option
    // whose key has no matching category row (the synthetic default /
    // uncategorized catch-all keyed by DEFAULT_CATEGORY_KEY) sorts LAST.
    // Equal-rank options keep their first-seen (Map insertion) order, which
    // Array.prototype.sort preserves — it is a stable sort (ES2019+).
    const orderByKey = new Map<string, number>();
    categories.forEach((category, index) => {
      orderByKey.set(category.key.toLowerCase(), index);
    });
    const rank = (key: string): number => orderByKey.get(key.toLowerCase()) ?? categories.length;

    return Array.from(byKey.values()).sort((a, b) => rank(a.value) - rank(b.value));
  }, [allCategorySlices, categories]);

  const excludedCategoryKeys = useMemo(() => {
    if (selectedCategories.size === 0) {
      return new Set<string>();
    }

    return new Set(
      allCategorySlices
        .filter((slice) => !selectedCategories.has(slice.key))
        .map((slice) => slice.key),
    );
  }, [allCategorySlices, selectedCategories]);

  const categorySlices = useMemo(
    () =>
      buildCategoryBreakdown({
        transactions: rangeFilteredBreakdownTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        excludedCategories: excludedCategoryKeys,
        excludedTransactionIds,
      }),
    [
      rangeFilteredBreakdownTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      excludedCategoryKeys,
      excludedTransactionIds,
    ],
  );

  // The APPLIED trend filter: the saved config resolved against the categories
  // that still exist (manual keys pruned per D5; top amount clamped), falling
  // back to the default (top 3 by contribution) when nothing is saved. Save
  // persists it and the value flows back through the settings live query — there
  // is no seed effect any more.
  const appliedTrendFilter = useMemo(() => {
    const existingKeys = new Set(categories.map((category) => category.key.toLowerCase()));

    return resolveTrendFilter(settingsRows.at(0)?.trendFilter ?? null, existingKeys);
  }, [settingsRows, categories]);

  // The per-category ranking measures over the fixed 30-day trend window — the
  // universe both the Top-N ranking and the exclusion set below are computed
  // from (NOT the range-scoped `allCategorySlices`, whose window differs).
  const trendMeasures = useMemo(
    () =>
      buildCategoryMeasures({
        transactions: trendTransactions,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        now,
        excludedTransactionIds,
      }),
    [trendTransactions, rateTable, baseCurrency, defaultCategoryKey, now, excludedTransactionIds],
  );

  // The category keys the chart draws: the explicit manual keys, or the live
  // top-N picked from the measures by the chosen measure.
  const trendSelectedKeys = useMemo(
    () =>
      appliedTrendFilter.mode === 'manual'
        ? new Set(appliedTrendFilter.keys)
        : selectTopCategories({
            measures: trendMeasures,
            amount: appliedTrendFilter.amount,
            by: appliedTrendFilter.by,
          }),
    [appliedTrendFilter, trendMeasures],
  );

  // Feed the selection through the EXISTING exclusion path: exclude every
  // windowed category NOT selected, so `CategoryTrendLine` rendering is
  // unchanged. An empty selection (manual "all") excludes nothing.
  const excludedTrendCategoryKeys = useMemo(() => {
    if (trendSelectedKeys.size === 0) {
      return new Set<string>();
    }

    return new Set(
      trendMeasures.map((measure) => measure.key).filter((key) => !trendSelectedKeys.has(key)),
    );
  }, [trendMeasures, trendSelectedKeys]);

  const trendSeries = useMemo(
    () =>
      buildCategoryTrend({
        transactions: trendTransactions,
        categoryDisplay: categoryByKey,
        rateTable,
        baseCurrency,
        defaultCategoryKey,
        now,
        excludedCategories: excludedTrendCategoryKeys,
        excludedTransactionIds,
      }),
    [
      trendTransactions,
      categoryByKey,
      rateTable,
      baseCurrency,
      defaultCategoryKey,
      now,
      excludedTrendCategoryKeys,
      excludedTransactionIds,
    ],
  );

  // Save applies AND persists the whole filter; the applied config flows back
  // through the settings live query on the next render, so there is nothing to
  // hold in local state.
  const saveTrendFilter = (filter: TrendFilter): void => {
    settingsRepo.setTrendFilter(filter);
  };

  // The donut's own center figure: every VISIBLE slice's spend summed back
  // together, in the base currency — the total the ring's wedges add up to
  // right now, so it always reconciles with what is actually drawn (narrowed
  // by the category filter the same way the wedges are).
  const categoryTotal = useMemo(
    () =>
      Money.of(
        baseCurrency,
        categorySlices.reduce((sum, slice) => sum + slice.amount, 0),
      ),
    [categorySlices, baseCurrency],
  );

  // One option per visible account, each carrying its seeded icon + resolved
  // entity color for the menu row; matching still keys on `option.value` (the
  // account name, compared to `account.name` in the `filtered` memo above).
  const accountOptions: FilterOption[] = filtered.visibleAccounts.map((account) => ({
    value: account.name,
    icon: account.icon ?? undefined,
    color: resolveEntityColor(account.color, defaultAccountColor[account.kind]),
  }));

  return (
    <Screen scroll scrollableRef={scrollRef}>
      <Box gap={4} testID="statistics-blocks">
        <Box direction="row" gap={3} style={styles.filterBar}>
          <FilterMenu
            label={t('statistics.filterAccounts')}
            testID="statistics-account-filter"
            options={accountOptions}
            selected={selectedAccounts}
            onToggle={toggleFilter(setSelectedAccounts)}
          />

          <DateRangeField
            dateFrom={dateFrom}
            dateTo={dateTo}
            minDate={new Date(spanStart)}
            maxDate={new Date(now)}
            onApply={applyDateRange}
            onClear={clearDateRange}
          />
        </Box>

        <GlassSurface testID="statistics-block-line" transparent padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              {t('statistics.netWorthOverTime')}
            </Text>

            <NetWorthLine
              points={netWorth.points}
              startReference={netWorth.startReference}
              baseCurrency={baseCurrency}
              loading={backfillStatus.state === 'loading'}
            />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-bar" transparent padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              {t('statistics.byType')}
            </Text>

            <BarChart data={typeSlices} baseCurrency={baseCurrency} />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-pie" transparent padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              {t('statistics.accountContribution')}
            </Text>

            <PieChart slices={slices} baseCurrency={baseCurrency} />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-category" transparent padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              {t('statistics.expensesByCategory')}
            </Text>

            <Box direction="row" gap={3} style={styles.filterBar}>
              <FilterMenu
                label={t('statistics.filterCategories')}
                testID="statistics-category-filter"
                options={categoryOptions}
                selected={selectedCategories}
                onToggle={toggleFilter(setSelectedCategories)}
              />
            </Box>

            <PieChart
              slices={categorySlices.map(toPieSlice)}
              baseCurrency={baseCurrency}
              testID="category-pie"
              emptyLabel={t('statistics.noSpendingToShow')}
              innerRatio={CATEGORY_DONUT_INNER_RATIO}
              centerTotal={categoryTotal}
              legendMinShare={CATEGORY_LEGEND_MIN_SHARE}
            />
          </Box>
        </GlassSurface>

        <GlassSurface testID="statistics-block-trend" transparent padding={4} radius="lg">
          <Box gap={3}>
            <Text variant="heading" style={styles.cardTitle}>
              {t('statistics.spendingTrendByCategory')}
            </Text>

            <Box direction="row" style={styles.filterBar}>
              <TrendFilterField
                testID="statistics-trend-filter"
                filter={appliedTrendFilter}
                categoryOptions={categoryOptions}
                onSave={saveTrendFilter}
              />
            </Box>

            <CategoryTrendLine
              series={trendSeries}
              baseCurrency={baseCurrency}
              emptyLabel={t('statistics.noSpendingToShow')}
            />
          </Box>
        </GlassSurface>
      </Box>
    </Screen>
  );
};

export default StatisticsScreen;
