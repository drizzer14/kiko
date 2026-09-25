import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import { ratesRepo } from '@kiko/rates/repo';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { FlatList, Pressable } from 'react-native';
import { categoriesRepo } from '@kiko/categories/repo';
import { type FC, useLayoutEffect, useMemo } from 'react';
import { transactionsRepo } from '@kiko/transactions/repo';
import { accountsRepo } from '@kiko/accounts/accounts.repo';
import { settingsRepo } from '@kiko/settings/settings.repo';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { bondExpectedProfitMinor } from '@kiko/holdings/holding-descriptor/bond';

import {
  isLedgerlessHoldingType,
  isLotFormHoldingType,
  isTimeExemptHoldingType,
} from '../../holdings/holding-type';
import {
  loanInstallments,
  loanOutstandingMinorAt,
  type LoanInstallment,
} from '../../holdings/loan-schedule';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
} from '../../categories/category-display';
import { Money } from '../../currency/money';
import { formatMoney } from '../../currency/format';
import Box from '../../design-system/components/box';
import EntityHeaderIcon from '../entity-header-icon';
import { useLiveQuery } from '../../db/use-live-query';
import Card from '../../design-system/components/card';
import Text from '../../design-system/components/text';
import { startOfLocalDay } from '../../dates/local-day';
import { activeLocale } from '../../i18n/active-locale';
import type { Currency } from '../../currency/currency';
import EntityAmountHeader from '../entity-amount-header';
import type { PriceBook } from '../../prices/price-book';
import { usePriceBook } from '../../prices/use-price-book';
import Button from '../../design-system/components/button';
import { formatDate, formatTime } from '../../dates/format';
import { groupByDay } from '../../transactions/group-by-day';
import SymbolIcon from '../../design-system/components/symbol';
import { convert, type RateTable } from '../../rates/conversion';
import { isPricedHoldingType } from '../../holdings/priced-value';
import MoneyText from '../../design-system/components/money-text';
import { holdingTypeSymbol } from '../../holdings/entity-symbols';
import { defaultHoldingColor } from '../../holdings/entity-colors';
import { priceAsOfCaption } from '../../prices/price-as-of-caption';
import { resolveEntityColor } from '../../design-system/entity-tint';
import type { AccountsStackParamList } from '../../navigation/types';
import SummaryTable from '../../design-system/components/summary-table';
import { buildRateTable, canConvert } from '../../rates/net-worth-view';
import { asBondMeta, asLoanMeta } from '../../holdings/holding-metadata';
import { resolveCategoryColor } from '../../statistics/category-breakdown';
import type { AccountRow, HoldingRow, TransactionRow } from '../../db/schema';
import CardContextMenu from '../../design-system/components/card-context-menu';
import { transactionRowDescription } from '../../transactions/row-description';
import { isSyncedHolding, isSyncedTransaction } from '../../holdings/deletable';
import EditHeaderButton from '../../design-system/components/edit-header-button';
import Screen, { resolveBottomClearance } from '../../design-system/components/screen';
import type { MoneyTextTone } from '../../design-system/components/money-text/money-text.props';
import { type HoldingValueBreakdown, holdingValueBreakdown } from '../../holdings/holding-value';
import { type DerivedEntry, derivedEntries, type EntryTone } from '../../holdings/derived-entries';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

// The holding's display identity for the view-only header: its stored icon (or
// the type default), and its effective color resolved through the SAME
// `resolveEntityColor` the holding card uses — so the identity color on the card
// and on this header can never diverge. A bare `color ?? default` here let an
// empty-string stored color (neither null nor undefined) through, tinting the
// header with an invalid empty color while the card showed the type default.
// Extracted so the fallbacks don't count against the screen component's
// cognitive-complexity budget.
const holdingIdentity = (holding: HoldingRow): { icon: string; color: string } => ({
  icon: holding.icon ?? holdingTypeSymbol[holding.type],
  color: resolveEntityColor(holding.color, defaultHoldingColor[holding.type]),
});

const isZero = (minorUnits: number): boolean => minorUnits === 0;

// A ledger amount fixed to a color BY KIND (interest always green, tax always
// red) misleadingly implies a nonzero accrual/withholding when the amount
// itself is exactly zero (e.g. before a deposit's first interest period has
// elapsed) — override those two to the muted/gray tone instead. A `neutral`
// entry already resolves a zero amount to textPrimary/white via MoneyText's
// own sign-based fallback, so it is left untouched here. Shared by the
// breakdown summary and the transaction ledger below so the "zero reads gray"
// rule has one source of truth across both.
const ledgerTone = (tone: EntryTone, minorUnits: number): MoneyTextTone =>
  tone !== 'neutral' && isZero(minorUnits) ? 'muted' : tone;

// Rows that break the headline net value into its parts. Only the deposit and
// bond types accrue interest/tax, so the breakdown is meaningful there; other
// types render a flat value where gross == net and these would all read zero.
const breakdownRows = (
  breakdown: HoldingValueBreakdown,
  type: string,
  expectedProfit: Money | null,
  t: TFunction,
): { label: string; money: Money; tone?: MoneyTextTone }[] => [
  {
    label: type === 'bond' ? t('holdingDetail.cost') : t('holdingDetail.principal'),
    money: breakdown.principalOrCost,
  },
  { label: t('holdingDetail.grossValue'), money: breakdown.gross },
  // Interest and tax carry a fixed tone by KIND (interest always green, tax
  // always red), the same rule the derived ledger rows use — not the sign-only
  // balance coloring, which would leave a positive interest/tax magnitude
  // white — except when the amount is exactly zero, where `ledgerTone` mutes
  // it to gray instead.
  {
    label: t('holdingDetail.interestEarned'),
    money: breakdown.interest,
    tone: ledgerTone('positive', breakdown.interest.minorUnits),
  },
  {
    label: t('holdingDetail.taxWithheld'),
    money: breakdown.tax,
    tone: ledgerTone('negative', breakdown.tax.minorUnits),
  },
  // Bonds surface the whole-life expected profit: sum of net coupons + nominal
  // redeemed, less the price paid (the figure the bank statement shows). It
  // reads green as the holding's expected gain.
  ...(expectedProfit
    ? [
        {
          label: t('holdingDetail.expectedProfit'),
          money: expectedProfit,
          tone: 'positive' as const,
        },
      ]
    : []),
];

// The holding's Value converted into the user's main (base) currency, for the
// smaller caption beneath the amount — the same second line the holding card
// shows. Returns null when there is nothing to show: a holding already in the
// base currency, or one whose currency has no cached rate yet (a BTC holding
// before the first sync). The `canConvert` guard is load-bearing — `convert`
// throws on a missing rate pair. Extracted so the guard chain does not count
// against the screen component's cognitive-complexity budget.
const convertedBaseValue = (
  holding: HoldingRow | undefined,
  breakdown: HoldingValueBreakdown | null,
  baseCurrency: Currency,
  rateTable: RateTable,
): Money | null => {
  if (
    holding === undefined ||
    breakdown === null ||
    holding.currency === baseCurrency ||
    !canConvert(holding.currency, baseCurrency, rateTable)
  ) {
    return null;
  }

  return convert(breakdown.net, baseCurrency, rateTable);
};

// Which add action the screen's footer offers.
type FooterAction = 'contribution' | 'transaction' | 'updateValue' | 'addLot' | 'none';

// A term_deposit takes contributions (its own deposit lifecycle); a plain
// holding takes a manual transaction. A LOT-FORM-eligible type (`metal` as of
// T18 — `isLotFormHoldingType`) opens the dedicated Lot form to record a
// buy/sell instead — checked BEFORE the priced-value guard below, since
// `metal` is ALSO a priced type (`isPricedHoldingType`) but must never offer
// "Update value": a metal's price comes from the SHARED `metal:<XAU|...>`
// instrument (kiko-pricing), never a per-holding manual price point the way
// `property_item` uses. A priced type that is NOT lot-form-eligible
// (`property_item`) takes neither ledger action: it opens the price-point
// form instead. Every OTHER ledgerless type (bond — see
// `isLedgerlessHoldingType`) carries no manual ledger at all — its value
// derives from metadata (kiko-domain) — and a synced (Monobank) holding's
// ledger is owned by the sync, so neither offers an add action.
// `isSyncedHolding` requires BOTH a connected synced institution AND the sync
// key in metadata, so a disconnected former-Monobank holding counts as manual
// again and keeps its add action. Extracted to module scope so the branch
// chain does not count against the screen component's cognitive-complexity
// budget.
const footerActionFor = (
  holding: HoldingRow | undefined,
  account: AccountRow | undefined,
): FooterAction => {
  if (holding === undefined) {
    return 'none';
  }

  if (holding.type === 'term_deposit') {
    return 'contribution';
  }

  if (isLotFormHoldingType(holding.type)) {
    return 'addLot';
  }

  if (isPricedHoldingType(holding.type)) {
    return 'updateValue';
  }

  // A loan (T28) is ledgerless (checked below) but still takes the SAME
  // `'updateValue'` action as a priced holding — it reuses `PricePointForm`
  // to write a correction onto its own `holding:<id>` manual series
  // (`loanOutstandingMinorAt` — every schedule, not just `'none'`, reads a
  // correction there when one exists). The render below swaps the button's
  // OWN label to "Update outstanding" for this type; the navigation target
  // is identical. Checked before the ledgerless fallback so a loan does not
  // fall through to `'none'`.
  if (holding.type === 'loan') {
    return 'updateValue';
  }

  if (isLedgerlessHoldingType(holding.type) || isSyncedHolding(holding, account)) {
    return 'none';
  }

  return 'transaction';
};

// The next upcoming amortization row for an `'annuity'`/`'differentiated'`
// loan (T28) — the one this holding's next scheduled payment falls on,
// picked as the first installment whose due day is on or after `now`'s own
// LOCAL day (mirrors `priceAsOfCaption`'s day-key convention). `undefined`
// for every other holding, for an invalid/absent `LoanMeta`, for a `'none'`
// schedule (no installments at all — `loanInstallments` already returns
// `[]` for it), once every installment has already come due (a fully repaid
// loan), and once an overpaid correction has already clamped the
// outstanding to 0 (N10a), even while `loanInstallments` still has future
// rows on the ORIGINAL schedule.
// Extracted to module scope for the same cognitive-complexity reason
// `footerActionFor`/`priceAsOfCaption` are.
const nextLoanInstallment = (
  holding: HoldingRow | undefined,
  book: PriceBook,
  now: number,
): LoanInstallment | undefined => {
  if (holding === undefined || holding.type !== 'loan') {
    return undefined;
  }

  const meta = asLoanMeta(holding.metadata);

  if (meta === null || meta.schedule === 'none') {
    return undefined;
  }

  if (loanOutstandingMinorAt(meta, holding.id, book, now) <= 0) {
    return undefined;
  }

  const todayStart = startOfLocalDay(now);

  return loanInstallments(meta).find((row) => row.dueDate >= todayStart);
};

// The Value header's secondary caption slot (`EntityAmountHeader`'s
// `secondary` prop): the converted-to-base line, the "Value as of <date>"
// line, or both stacked — a module-scope component (mirroring `LedgerRowItem`
// below) so the conditional JSX does not count against the screen component's
// own cognitive-complexity budget. Renders nothing (null) when neither
// applies, the same as the screen previously passing `secondary={undefined}`.
const ValueHeaderSecondary: FC<{
  convertedToBase: Money | null;
  valueAsOf: string | undefined;
}> = ({ convertedToBase, valueAsOf }) => {
  if (!convertedToBase && !valueAsOf) {
    return null;
  }

  return (
    <Box gap={1}>
      {convertedToBase && (
        <Box testID="holding-detail-converted">
          <Text variant="caption" tone="textSecondary">
            {formatMoney(convertedToBase, activeLocale())}
          </Text>
        </Box>
      )}

      {valueAsOf && (
        <Box testID="holding-detail-value-as-of">
          <Text variant="caption" tone="textSecondary">
            {valueAsOf}
          </Text>
        </Box>
      )}
    </Box>
  );
};

// One merged ledger row — either a real stored transaction or a computed
// (derived) lifecycle entry. Shared by the FlatList's `data`, `keyExtractor`,
// and `renderItem` so all three agree on the row shape.
type LedgerRow =
  | { kind: 'transaction'; time: number; transaction: TransactionRow }
  | { kind: 'derived'; time: number; entry: DerivedEntry };

// A stable key per row, reusing the exact identity the eager `.map` keyed on: a
// derived entry's synthetic id, a stored row's transaction id.
const ledgerKey = (row: LedgerRow): string =>
  match(row)
    .with({ kind: 'derived' }, (derivedRow) => derivedRow.entry.id)
    .with({ kind: 'transaction' }, (transactionRow) => transactionRow.transaction.id)
    .exhaustive();

// A flattened ledger entry for the FlatList: the merged row plus, on the FIRST
// row of each calendar day, that day's header title ("Today"/"Yesterday"/
// DD.MM.YYYY). The day grouping reuses the Home transaction list's shared
// `groupByDay`; rendering each day header INSIDE its first row's cell (rather
// than as a separate SectionList header cell) keeps the list's virtualization
// cell-count equal to the row count, so a synced card's thousands of rows still
// mount only as they scroll into view — the same virtualization contract the
// ungrouped list had.
type LedgerListItem = { row: LedgerRow; dayTitle: string | null };

// The read context a ledger row needs to render, threaded in from the screen so
// the row component stays at module scope (keeping the screen's own
// cognitive-complexity budget clear, the same pattern the helpers above follow).
type LedgerRowContext = {
  currency: Currency;
  showTime: boolean;
  categoryByKey: ReturnType<typeof buildCategoryDisplayMap>;
  defaultCategoryKey: string;
  holdingName: string;
  holdingNameById: Map<string, string>;
  onPressTransaction: (transactionId: string) => void;
  // Duplicate this ledger row into a pre-filled create form (D2). Passed for
  // manual rows only (a synced row is not duplicable), stateless via the
  // `duplicateOfTransactionId` route param.
  onDuplicateTransaction: (transactionId: string) => void;
};

// A single ledger row, lifted verbatim out of the old eager `.map` so the
// FlatList mounts only the visible rows — a synced card can carry thousands.
// The row UI, props, spacing, and testIDs are unchanged. A derived (computed)
// entry is read-only; a stored transaction wraps in CardContextMenu (touch-and-
// hold to delete) and is tappable.
const LedgerRowItem: FC<{ row: LedgerRow; context: LedgerRowContext }> = ({ row, context }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const {
    currency,
    showTime,
    categoryByKey,
    defaultCategoryKey,
    holdingName,
    holdingNameById,
    onPressTransaction,
    onDuplicateTransaction,
  } = context;

  return match(row)
    .with({ kind: 'derived' }, (derivedRow) => (
      // A computed lifecycle entry (opening/top-up, interest accrual, the
      // 18%/5% withholding lines, capitalization, or a bond
      // purchase/coupon/redemption): read-only — no delete gesture, not
      // tappable — and marked "Computed" so it reads as derived, not a
      // stored transaction. A projected (future-dated) entry — an
      // upcoming accrual, coupon, or redemption — is dimmed and marked
      // "Projected". The amount reads in its kind-derived tone (tax red,
      // interest/coupon green, principal movements neutral/by-sign).
      <Card
        padding={3}
        testID="ledger-row"
        style={derivedRow.entry.isFuture ? styles.futureRow : undefined}
      >
        <Box gap={1}>
          <Box direction="row" style={styles.rowMain}>
            <Box style={styles.rowDescription}>
              <Text variant="body">{derivedRow.entry.label}</Text>
            </Box>
            <Box style={styles.rowAmount}>
              <MoneyText
                money={Money.of(currency, derivedRow.entry.amountMinorUnits)}
                tone={ledgerTone(derivedRow.entry.tone, derivedRow.entry.amountMinorUnits)}
              />
            </Box>
          </Box>
          <Box style={styles.rowFooter}>
            <Text variant="caption" tone="textSecondary">
              {derivedRow.entry.isFuture
                ? t('holdingDetail.projected')
                : t('holdingDetail.computed')}
              {showTime ? ` · ${formatTime(derivedRow.entry.time)}` : ''}
            </Text>
          </Box>
        </Box>
      </Card>
    ))
    .with({ kind: 'transaction' }, (transactionRow) => {
      // The row's stored category resolves to its icon + title through the
      // same shared mapping Home uses; a null/unknown category falls back
      // to the neutral display.
      const category = resolveCategoryDisplay(
        transactionRow.transaction.category,
        categoryByKey,
        defaultCategoryKey,
      );

      // The row's human-readable description, reused as both the row label and
      // the name the delete confirmation spells out ("Delete <description>").
      const description = transactionRowDescription({
        transaction: transactionRow.transaction,
        holdingName,
        holdingNameById,
        t,
      });

      // Every real row is tappable: it opens the shared Transaction form
      // for this id. A manual row edits; a synced (Monobank) row opens
      // read-only — the form resolves which from the transaction's own
      // `source`, so the row only needs to pass the id. Delete is a
      // touch-and-hold that opens the shared card context menu (see
      // `CardContextMenu`) with a single destructive Delete action — the
      // same long-press pattern the account/holding cards use. A synced
      // (Monobank) row is not deletable (its state is owned by the sync),
      // so `CardContextMenu` renders it with no gesture at all.
      return (
        <CardContextMenu
          name={description}
          deletable={!isSyncedTransaction(transactionRow.transaction)}
          onDelete={() => transactionsRepo.remove(transactionRow.transaction.id)}
          // A synced row is not duplicable — pass no handler so its long-press keeps
          // offering nothing (it already renders bare). A manual row's Duplicate
          // opens the create form pre-filled from this row (D2).
          onDuplicate={
            isSyncedTransaction(transactionRow.transaction)
              ? undefined
              : () => onDuplicateTransaction(transactionRow.transaction.id)
          }
          liftOnHold
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => onPressTransaction(transactionRow.transaction.id)}
          >
            <Card padding={3} testID="ledger-row">
              <Box gap={1}>
                <Box direction="row" style={styles.rowMain}>
                  <Box direction="row" gap={2} style={styles.rowLead}>
                    <SymbolIcon
                      name={category.icon}
                      size={theme.iconSizes.body}
                      tone="textSecondary"
                      color={resolveCategoryColor(
                        category.color,
                        transactionRow.transaction.category?.toLowerCase() || defaultCategoryKey,
                      )}
                      accessibilityLabel={category.title}
                    />
                    <Box style={styles.rowDescription}>
                      <Text variant="body">{description}</Text>
                    </Box>
                  </Box>
                  <Box style={styles.rowAmount}>
                    <MoneyText
                      money={Money.of(currency, transactionRow.transaction.amountMinorUnits)}
                      context="transaction"
                    />
                  </Box>
                </Box>
                {showTime && (
                  <Box style={styles.rowFooter}>
                    <Text variant="caption" tone="textSecondary">
                      {formatTime(transactionRow.transaction.time)}
                    </Text>
                  </Box>
                )}
              </Box>
            </Card>
          </Pressable>
        </CardContextMenu>
      );
    })
    .exhaustive();
};

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { holdingId, name: initialName } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listByHoldingQuery(holdingId), [
    'transactions',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);
  const { data: settingsRows } = useLiveQuery(settingsRepo.getQuery(), ['settings']);
  // The cached conversion rates, so the Value amount can carry a smaller
  // converted base-currency caption beneath it — the same second line the
  // holding card shows for a holding in a non-base currency.
  const { data: rates } = useLiveQuery(ratesRepo.allQuery(), ['currency_rates']);
  const priceBook = usePriceBook();

  // Resolve each transaction row's stored category to its display (icon + title)
  // through the same shared mapping Home uses, so a rename flows through here too.
  const categoryByKey = buildCategoryDisplayMap(categories);
  // The configurable catch-all: a null/empty category resolves to this category
  // (seeded to `other`), matching Home and the statistics breakdown.
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const now = Date.now();
  const breakdown = holding ? holdingValueBreakdown(holding, now, priceBook) : null;
  // The owning account, so the footer's sync gate can read its `institution`.
  // `isSyncedHolding` requires BOTH a connected synced institution AND a sync
  // key in metadata, so a disconnected former-Monobank holding counts as manual
  // again and keeps its add action.
  const { data: accounts } = useLiveQuery(accountsRepo.byIdQuery(holding?.accountId ?? ''), [
    'accounts',
  ]);
  const account = accounts.at(0);
  // Bonds show a whole-life expected profit line (net coupons + nominal - price).
  const bondMeta = holding?.type === 'bond' ? asBondMeta(holding.metadata) : null;
  const expectedProfit = bondMeta
    ? Money.of(currency, bondExpectedProfitMinor(bondMeta, currency))
    : null;
  // An annuity/differentiated loan's next upcoming installment (T28) — its
  // interest/principal split shown just below the Value header.
  const nextInstallment = nextLoanInstallment(holding, priceBook, now);

  // The user's main currency, and the rate table that converts into it. A
  // holding in a different currency shows a smaller converted base-currency
  // caption beneath its Value — the same second line the holding card renders.
  // `convert` throws on a missing rate pair, so the `canConvert` guard is
  // load-bearing: a BTC holding before the first rate sync shows no second line.
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  const convertedToBase = convertedBaseValue(holding, breakdown, baseCurrency, rateTable);
  // A priced holding's (property_item) "Value as of <date>" caption, from its
  // latest stored price point — undefined for every other type, or a priced
  // one with no point yet.
  const valueAsOf = priceAsOfCaption(holding, priceBook, t);

  // The transaction ledger merges the holding's real (stored) transactions with
  // the computed entries a deposit/bond accrues (contributions, interest, tax,
  // purchase, coupon — whatever `derivedEntries` yields for the type). Both
  // carry a `time`; the merged list is sorted newest-first to match the repo's
  // `desc(time)` ordering. Real rows stay interactive (swipe-to-delete, tap to
  // edit); derived rows are read-only and marked "Computed".
  const derived: DerivedEntry[] = useMemo(
    () => (holding ? derivedEntries(holding, now, t) : []),
    [holding, now, t],
  );
  const ledger = useMemo(
    () =>
      [
        ...transactions.map((transaction) => ({
          kind: 'transaction' as const,
          time: transaction.time,
          transaction,
        })),
        ...derived.map((entry) => ({ kind: 'derived' as const, time: entry.time, entry })),
      ].sort((first, second) => second.time - first.time),
    [transactions, derived],
  );
  // Group the merged ledger into per-day sections the SAME way the Home
  // transaction list does — one section per calendar day, newest day first,
  // headed by "Today"/"Yesterday"/DD.MM.YYYY — through the shared `groupByDay`,
  // then flatten back to one row per FlatList item, tagging each day's FIRST row
  // with that day's header title. Keyed on the local DAY (not the per-render
  // `now` millisecond) so it only recomputes when the ledger changes or the day
  // rolls over at midnight.
  const todayStart = startOfLocalDay(now);
  const listData = useMemo<LedgerListItem[]>(
    () =>
      groupByDay(ledger, todayStart, t).flatMap((section) =>
        section.data.map((row, index) => ({
          row,
          dayTitle: index === 0 ? section.title : null,
        })),
      ),
    [ledger, todayStart, t],
  );
  const showBreakdown = holding?.type === 'term_deposit' || holding?.type === 'bond';
  // Which add action the footer offers — or none, for a bond or a synced
  // holding (see `footerActionFor`).
  const footerAction = footerActionFor(holding, account);
  // The ledger FlatList is a direct child of `Screen`'s SafeAreaView under
  // `bleedTop` (no `content` wrapper — that is what lets iOS track it for the
  // large-title collapse), so this screen owns the FlatList's bottom padding
  // itself, the `bleedBottom` contract. When there IS a footer, the Screen
  // footer slot owns the floating tab-bar clearance and the list needs only a
  // plain gap above it; with NO footer (a bond or synced holding), the list is
  // the screen's true bottom edge and must clear the tab bar itself via the ONE
  // shared arithmetic (the same computation Home's list uses). `useSafeAreaInsets`
  // supplies the bottom inset the SafeAreaView already reserves, so the tab-bar
  // height is not double-counted.
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const listBottomClearance =
    footerAction === 'none' ? resolveBottomClearance(tabBarHeight, insets.bottom) : 0;
  // A term_deposit/bond event is day-granular (a contribution, coupon, or
  // redemption), so its ledger rows show the date only; every other holding
  // keeps the full date + HH:MM stamp.
  const showTime = holding ? !isTimeExemptHoldingType(holding.type) : true;

  // The nav title shows the holding NAME only — the native large title, the
  // standard iOS pattern (the identity icon now sits beside the Value amount
  // below, not in the title). The name is available from the route params at the
  // FIRST render, so the large title (and the back button on any screen pushed
  // from here) reads immediately; the live-queried name takes over once loaded so
  // a rename flows back through. This drops the old async `headerLargeTitle: false`
  // + custom `headerTitle` toggle, which briefly blanked the pushed screen's back
  // button and flashed the large title collapsing on load.
  const holdingName = holding?.name ?? initialName;
  // Counterpart holding names, so an Exchange/Convert leg on this holding reads
  // as "Exchange to/from <the OTHER holding's CURRENT name>" in the active
  // language — nothing is persisted (see transactions/row-description.ts).
  const holdingNameById = useMemo(
    () => new Map(holdings.map((candidate) => [candidate.id, candidate.name])),
    [holdings],
  );
  // The holding's effective icon + color, rendered as the identity glyph beside
  // the Value amount (via `EntityHeaderIcon` in the `EntityAmountHeader` icon slot
  // below) rather than in the nav title.
  const identity = holding ? holdingIdentity(holding) : undefined;
  // The holding's owning account, needed to open its edit form (the form reads
  // the account's kind to constrain the type chips). Always present on a real
  // row (accountId is NOT NULL); the header Edit action is gated on it.
  const holdingAccountId = holding?.accountId;

  // The header/summary block that scrolls above the ledger: the Value amount +
  // identity icon, the optional converted (main-currency) caption tucked
  // directly under that amount, the optional breakdown lines, the hairline
  // divider, and the Transactions heading. It sits in the FlatList's
  // `ListHeaderComponent` so the list owns the scrolling (an eager list nested
  // in a ScrollView breaks virtualization).
  const listHeader = (
    <Box gap={4}>
      {holding && breakdown && (
        <Box gap={1}>
          <EntityAmountHeader
            testID="holding-value-header"
            label={t('holdingDetail.valueLabel')}
            money={breakdown.net}
            icon={<EntityHeaderIcon identity={identity} />}
            // The main (base) currency restatement of the Value sits directly
            // UNDER the holding-currency amount, inside the shared header's tight
            // column — the same grouping the holding card uses (converted line
            // hugging the value) and consistent across every holding type. It
            // used to render as a disconnected caption at the BOTTOM of the whole
            // summary block, which on a deposit/bond floated below the whole
            // breakdown, detached from the value it converts (feedback round-2,
            // item 3).
            secondary={
              <ValueHeaderSecondary convertedToBase={convertedToBase} valueAsOf={valueAsOf} />
            }
          />
          {showBreakdown && (
            <Box style={styles.breakdown}>
              {/* The one shared "label left, value right" row layout
                  (`SummaryTable`, device-feedback-round-F1 item 3) — this is
                  the table the statement-import preview and column-mapping
                  result section now reuse the LAYOUT of, never these
                  value/percent/tax COLUMNS themselves. */}
              <SummaryTable
                rows={breakdownRows(breakdown, holding.type, expectedProfit, t).map((detail) => ({
                  key: detail.label,
                  label: detail.label,
                  value: <MoneyText money={detail.money} tone={detail.tone} />,
                }))}
              />
            </Box>
          )}
          {nextInstallment && (
            <Box style={styles.breakdown}>
              <SummaryTable
                title={t('holdingDetail.nextInstallment', {
                  date: formatDate(nextInstallment.dueDate),
                })}
                rows={[
                  {
                    key: 'principal',
                    label: t('holdingDetail.principal'),
                    // Scoped testID: a test can assert the principal/interest
                    // split per row, not just "both amounts appear somewhere",
                    // which would still pass if the two values were swapped.
                    testID: 'next-installment-principal',
                    value: (
                      <MoneyText money={Money.of(currency, nextInstallment.principalMinorUnits)} />
                    ),
                  },
                  {
                    key: 'interest',
                    label: t('holdingDetail.interest'),
                    testID: 'next-installment-interest',
                    value: (
                      <MoneyText money={Money.of(currency, nextInstallment.interestMinorUnits)} />
                    ),
                  },
                ]}
              />
            </Box>
          )}
        </Box>
      )}

      <Box style={styles.divider} />

      <Text variant="heading">{t('holdingDetail.transactionsHeading')}</Text>
    </Box>
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: holdingName,
      ...(holdingAccountId !== undefined && {
        headerRight: () => (
          <EditHeaderButton
            onPress={() =>
              navigation.navigate('HoldingForm', { accountId: holdingAccountId, holdingId })
            }
          />
        ),
      }),
    });
  }, [navigation, holdingName, holdingAccountId, holdingId]);

  // The per-row read context, threaded into each ledger row so the row
  // component stays at module scope. `holdingName` is always a string (the
  // route param seeds it), so the old `?? ''` fallback is no longer needed.
  const rowContext: LedgerRowContext = {
    currency,
    showTime,
    categoryByKey,
    defaultCategoryKey,
    holdingName,
    holdingNameById,
    onPressTransaction: (transactionId) =>
      navigation.navigate('TransactionForm', { transactionId }),
    onDuplicateTransaction: (transactionId) =>
      navigation.navigate('TransactionForm', { duplicateOfTransactionId: transactionId }),
  };

  return (
    <Screen
      // The FlatList below OWNS this screen's scrolling under the accounts
      // stack's native large title (`headerLargeTitle: true`). `bleedTop` makes
      // Screen render the FlatList as a DIRECT child of its SafeAreaView — with
      // NO intermediate `content` wrapper — so iOS tracks the FlatList as the
      // scroll view that drives the large-title COLLAPSE (an interposed wrapper
      // stops the collapse: the title stays stuck expanded — feedback round-3,
      // item 1). `bleedTop` also drops Screen's top safe-area edge so the list
      // reaches the top edge and iOS applies the large-title content inset to it
      // (via the FlatList's own `contentInsetAdjustmentBehavior="automatic"`
      // below) — keeping the no-float fix from feedback round-2, item 2. This
      // mirrors the working `account-detail` scroll ScrollView, a direct child
      // of its own SafeAreaView; this screen cannot use `scroll` because a
      // virtualized FlatList must not nest inside that branch's ScrollView.
      // Because there is no wrapper, the FlatList owns its own horizontal and
      // bottom padding (see `styles.listContent` / `listBottomClearance`).
      bleedTop
      footer={
        // A large, full-width primary action, shown for the holdings that take
        // one. A term_deposit opens the dedicated Contribution form ("Add
        // contribution"); a plain holding opens the shared Transaction form
        // ("Add transaction"); a priced holding (property_item) opens the
        // dedicated price-point form ("Update value") to record a
        // revaluation; a lot-form-eligible holding (`metal` as of T18) opens
        // the dedicated Lot form ("Add lot") to record a buy/sell instead. A
        // bond and a synced holding take no manual add action, so they
        // render no footer at all.
        match(footerAction)
          .with('contribution', () => (
            <Button onPress={() => navigation.navigate('ContributionForm', { holdingId })}>
              {t('forms.holding.addContribution')}
            </Button>
          ))
          .with('transaction', () => (
            <Button onPress={() => navigation.navigate('TransactionForm', { holdingId })}>
              {t('holdingDetail.addTransaction')}
            </Button>
          ))
          .with('updateValue', () => (
            <Button onPress={() => navigation.navigate('PricePointForm', { holdingId })}>
              {t(
                holding?.type === 'loan'
                  ? 'holdingDetail.updateOutstanding'
                  : 'holdingDetail.updateValue',
              )}
            </Button>
          ))
          .with('addLot', () => (
            <Button onPress={() => navigation.navigate('LotForm', { holdingId })}>
              {t('holdingDetail.addLot')}
            </Button>
          ))
          .with('none', () => undefined)
          .exhaustive()
      }
    >
      {/* The ledger is a virtualized FlatList that OWNS this screen's scrolling
          (under `bleedTop` Screen renders it directly inside its SafeAreaView,
          with no wrapper, so the FlatList supplies its own padding), so only the
          visible rows mount — a synced card can carry thousands. Its rows are
          grouped into per-day sections through the shared `groupByDay` — the
          SAME grouping the Home transaction list uses — so a day header
          ("Today"/"Yesterday"/DD.MM.YYYY) heads each calendar day, newest day
          first. The header renders INSIDE its day's first row cell (not as a
          separate SectionList header cell), which keeps the cell-count equal to
          the row count so virtualization is unchanged; Home's own day headers
          are non-sticky, so this reads identically on screen. The summary block
          + Transactions heading ride along in `ListHeaderComponent`; nesting an
          eager list inside a scrolling Screen would break virtualization and
          warn about a nested VirtualizedList. The `spacing(2)` row gap matches
          the old `<Box gap={2}>` — it lands between the header and the first row
          and between rows alike. */}
      <FlatList
        testID="ledger-list"
        data={listData}
        keyExtractor={(item) => ledgerKey(item.row)}
        renderItem={({ item }) => (
          <>
            {item.dayTitle !== null && (
              <Box testID="ledger-day-header" style={styles.sectionHeader}>
                <Text variant="caption" tone="textSecondary">
                  {item.dayTitle}
                </Text>
              </Box>
            )}

            <LedgerRowItem row={item.row} context={rowContext} />
          </>
        )}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <Box style={styles.empty}>
            <Text tone="textSecondary">{t('holdingDetail.emptyTransactions')}</Text>
          </Box>
        }
        // The list owns the scrolling under the native large title, so it — not
        // Screen's ScrollView — must carry the automatic content-inset
        // adjustment that seats content below the expanded large title (Screen
        // passes `bleedTop` above to drop the matching double top inset). Same
        // setting the shared `Screen` scroll branch applies to its ScrollView.
        contentInsetAdjustmentBehavior="automatic"
        style={styles.list}
        contentContainerStyle={styles.listContent(listBottomClearance)}
      />
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  // The ledger FlatList fills the Screen's SafeAreaView directly (under
  // `bleedTop` there is no `content` wrapper between them) and owns the
  // scrolling itself, so only visible rows mount. `flex: 1` makes it fill that
  // SafeAreaView so it is the scroll view iOS tracks for the large-title
  // collapse.
  list: {
    flex: 1,
  },
  // The scroll content. Under `bleedTop` the FlatList is a DIRECT child of
  // Screen's SafeAreaView (no `content` wrapper — that is what lets iOS track it
  // for the large-title collapse), so this content container owns ALL of the
  // padding the wrapper used to provide:
  //  - top: `spacing(4)` below the collapsed large title (matching
  //    account-detail's scroll content), living here so the FlatList itself
  //    still reaches the top edge for iOS's automatic large-title inset;
  //  - horizontal: `spacing(4)`, the screen's side gutter the wrapper used to
  //    apply;
  //  - bottom: a `spacing(4)` gap plus the caller's `bottomClearance` — 0 when a
  //    footer owns the floating tab-bar clearance, else `resolveBottomClearance`
  //    so the last row clears the bar exactly once (see the screen component).
  // The `spacing(2)` gap sits between every child — the header block and the
  // first row, and each row and the next — reproducing the old `<Box gap={2}>`
  // that wrapped the Transactions heading and its rows.
  listContent: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4) + bottomClearance,
    gap: theme.spacing(2),
  }),
  // A date separator heading each day group in the ledger, mirroring the Home
  // transaction list's day header (home.styles.ts `sectionHeader`): a generous
  // top pad gives each date label clear separation above it (stacked on the
  // content container's `spacing(2)` gap between cells), and a small bottom pad
  // seats the day's first row close beneath the label — the same "generous top,
  // tight bottom" rhythm Home uses.
  sectionHeader: {
    paddingTop: theme.spacing(3),
    paddingBottom: theme.spacing(1),
  },
  // The ledger's own empty state (F4 audit 14, `home.screen.tsx`'s
  // `ListEmptyComponent` pattern) — a plain centered caption below the
  // "Transactions" heading, replacing a bare heading with nothing beneath it
  // for a holding type (property_item, loan) with no real transactions yet.
  empty: {
    alignItems: 'center',
    paddingVertical: theme.spacing(6),
  },
  // A projected (post-`now`) lifecycle entry, dimmed so it reads as an estimate
  // rather than a settled statement line.
  futureRow: {
    opacity: 0.5,
  },
  // Extra space above the value breakdown so the headline number sits clearly
  // apart from the principal/gross/interest/tax rows beneath it — the row
  // layout itself now lives in the shared `SummaryTable`.
  breakdown: {
    marginTop: theme.spacing(3),
  },
  // A hairline rule separating the Value block from the Transactions list — the
  // same standard hairline treatment the account-detail sections use
  // (account-detail.styles.ts `divider`), drawn in the theme's separator color
  // with vertical margin so each section has room to breathe.
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: theme.spacing(2),
    backgroundColor: theme.colors.border,
  },
  // The primary line of a transaction row: description on the left, amount on
  // the right, split by space-between.
  rowMain: {
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // The leading cluster of a transaction row: category icon + description, kept
  // together on the left so the row's space-between only splits this cluster
  // from the amount. `flex: 1` bounds it to the space left of the amount; top-
  // aligned so the icon sticks to the first line of a wrapping title.
  rowLead: {
    flex: 1,
    alignItems: 'flex-start',
  },
  // The description cell: `flex: 1` lets a long title wrap onto multiple lines
  // within the bounded row instead of pushing the amount off-screen.
  rowDescription: {
    flex: 1,
    marginRight: theme.spacing(3),
  },
  // The trailing amount cell: never shrinks, so the amount stays fully visible
  // no matter how long the description grows.
  rowAmount: {
    flexShrink: 0,
  },
  // The row's secondary line: the timestamp caption pinned to the right so it
  // sits BELOW the value column instead of left-aligned under the description —
  // mirroring the Home row's `rowFooter` (home.styles.ts), where the time is
  // bottom-right of the row. Here the caption is the only footer content, so a
  // right-aligned self is enough (no space-between split needed).
  rowFooter: {
    alignSelf: 'flex-end',
  },
}));

export default HoldingDetailScreen;
