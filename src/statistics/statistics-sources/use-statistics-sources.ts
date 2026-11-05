import { useMemo } from 'react';
import { minOf } from '@kiko/numbers';
import { ratesRepo } from '@kiko/rates/repo';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { categoriesRepo } from '@kiko/categories/repo';
import type { Currency } from '@kiko/currency/currency';
import { transactionsRepo } from '@kiko/transactions/repo';
import { usePriceBook } from '@kiko/prices/use-price-book';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import { localMidnightOfDayKey } from '@kiko/prices/price-book';
import { rateHistoryRepo } from '@kiko/rates/rate-history-repo';
import { transactionSpan } from '@kiko/transactions/transaction-span';
import { type HoldingRow, useDataReady, useLiveQuery } from '@kiko/db';
import { holdingDescriptorOrUndefined } from '@kiko/holdings/holding-descriptor';
import { buildCategoryDisplayMap, DEFAULT_CATEGORY_KEY } from '@kiko/categories/category-display';

import { buildFilterScope } from '../statistics-filter-scope';

// A share, metal, or property records its purchases as lots, never as ledger
// rows, so its earliest lot bounds the span the rate history must cover too.
// The span is made of instants, so a lot's day key becomes its local midnight.
const earliestLotDay = (
  holdings: readonly Pick<HoldingRow, 'type' | 'metadata'>[],
): number | null => {
  const days = holdings.flatMap((holding) =>
    (holdingDescriptorOrUndefined(holding.type)?.priced?.lots(holding.metadata) ?? []).map((lot) =>
      localMidnightOfDayKey(lot.day),
    ),
  );

  return days.length > 0 ? minOf(days) : null;
};

/**
 * The reads every Statistics-family screen shares, and the values derived from them: the seven
 * live queries, the price book, the base currency, the rate table, the category display map, the
 * account filter's scope and the span the rate history must cover. `now` and the account pick
 * come from the caller, which owns them.
 */
export const useStatisticsSources = (input: {
  isVisible: boolean;
  now: number;
  selectedAccounts: Set<string>;
}) => {
  const { isVisible, now, selectedAccounts } = input;
  const { i18n } = useTranslation();

  // Deliberately `paused` (not `enabled`) while another tab shows: the
  // subscription stays and a write elsewhere only marks each query dirty, so
  // hiding this tab causes no read, no state change, and no memo recompute —
  // `enabled: false` would instead unsubscribe and drop every chart to empty
  // (see kiko-architecture's `useLiveQuery` pattern section for the design).
  // Visibility, not focus: a screen shown as the Home tab's companion default is on screen and
  // never the focused route.
  const liveOptions = { cached: true, paused: !isVisible } as const;

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
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    liveOptions,
  );
  const {
    data: transactions,
    isLoading: transactionsLoading,
    isFresh: transactionsFresh,
  } = useLiveQuery(transactionsRepo.listAllQuery(), ['transactions'], true, liveOptions);
  const {
    data: historyRows,
    isLoading: historyLoading,
    isFresh: historyFresh,
  } = useLiveQuery(
    rateHistoryRepo.historyRowsQuery(),
    ['currency_rate_history'],
    true,
    liveOptions,
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    liveOptions,
  );

  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  // The configurable catch-all: a null/empty category folds into this category's
  // slice. Read from settings (seeded to `other`), passed into the breakdown.
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const rateTable = useMemo(() => buildRateTable(rates), [rates]);
  // kiko-architecture: skip the price_points read while nothing rendered from
  // these sources ever reads it — a holding whose type carries no priced spec
  // and is not a loan (`needsPriceBook`) never touches `price_points`. It
  // stays enabled while holdings are still on their first load, so the two
  // reads run in parallel instead of price_points waiting on holdings. Only a
  // loan reads the linked-payments half of the book.
  // The net-worth line values every past day, so it reads every stored close.
  // nosemgrep: kiko-no-whole-price-points-read OVERRIDE(history valuation)
  const { book: priceBook, isLoading: priceBookLoading } = usePriceBook(
    holdingsLoading || holdings.some((holding) => needsPriceBook(holding.type)),
    liveOptions,
    holdingsLoading || holdings.some((holding) => holding.type === 'loan'),
  );
  // Every chart (bar/pie/trend) must never render an empty state while any of
  // this hook's own queries is still on its first load (kiko-architecture's
  // useLiveQuery consumer rule) — gated by the caller, right at its return. This is
  // SEPARATE from the net-worth line's own `loading` prop, which tracks
  // the incremental rate-history backfill (a later, non-blocking concern once
  // this base data has already loaded).
  const isReady = useDataReady(
    accountsLoading,
    holdingsLoading,
    ratesLoading,
    settingsLoading,
    transactionsLoading,
    historyLoading,
    categoriesLoading,
    priceBookLoading,
  );

  const filtered = useMemo(
    () => buildFilterScope({ accounts, holdings, selectedAccounts }),
    [accounts, holdings, selectedAccounts],
  );

  // The category display map is built here so a rename flows straight through.
  // buildCategoryDisplayMap resolves each un-renamed default category's title through
  // resolveDefaultCategoryTitle, which reads the active language off the global i18next singleton
  // (see category-display.ts) rather than off anything in this closure — the callback body never
  // references `i18n.language` directly, but the memo must still invalidate on it, or a live
  // language switch would keep serving the stale titles built for the earlier language.
  // biome-ignore lint/correctness/useExhaustiveDependencies: OVERRIDE(language-dependent resolver)
  const categoryByKey = useMemo(
    () => buildCategoryDisplayMap(categories),
    [categories, i18n.language],
  );

  // The full transaction and lot span drives the date field's default display,
  // the line's default window, and the backfill's earliest day. With neither the
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
  const lotStart = useMemo(() => earliestLotDay(holdings), [holdings]);
  const spanStart = Math.min(earliestTime ?? now, lotStart ?? now);

  return {
    accounts,
    holdings,
    settingsRows,
    transactions,
    transactionsFresh,
    historyRows,
    historyFresh,
    categories,
    priceBook,
    isReady,
    baseCurrency,
    defaultCategoryKey,
    rateTable,
    categoryByKey,
    filtered,
    spanStart,
  };
};
