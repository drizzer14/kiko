import { match } from 'ts-pattern';
import {
  defaultHoldingSymbol,
  genericEntitySymbol,
  holdingTypeSymbol,
} from '@kiko/holdings/entity-symbols';
import type { TFunction } from 'i18next';
import {
  holdsOnlyDebts,
  holdingDescriptorOrUndefined,
  isTimeExemptHoldingType,
  propertyOwnershipView,
  type PropertyOwnershipView,
} from '@kiko/holdings/holding-descriptor';
import {
  buildCategoryDisplayMap,
  DEFAULT_CATEGORY_KEY,
  resolveCategoryDisplay,
  resolveCategoryKey,
} from '@kiko/categories/category-display';
import maybe, { foldMap } from 'fnts/maybe';
import { ratesRepo } from '@kiko/rates/repo';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { FlatList, Pressable } from 'react-native';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { categoriesRepo } from '@kiko/categories/repo';
import Card from '@kiko/design-system/components/card';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import type { PriceBook } from '@kiko/prices/price-book';
import { transactionsRepo } from '@kiko/transactions/repo';
import { usePriceBook } from '@kiko/prices/use-price-book';
import Button from '@kiko/design-system/components/button';
import { asLoanMeta } from '@kiko/holdings/holding-metadata';
import { groupByDay } from '@kiko/transactions/group-by-day';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import { loanLedgerSummary } from '@kiko/holdings/loan-ledger';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import { useBottomTabBarHeight } from 'react-native-bottom-tabs';
import { convert, type RateTable } from '@kiko/rates/conversion';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultHoldingColor } from '@kiko/holdings/entity-colors';
import { ownershipShareDetailText } from '@kiko/holdings/ownership';
import { yieldToMaturityText } from '@kiko/bonds/yield-to-maturity';
import { resolveEntityColor } from '@kiko/design-system/entity-tint';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { startOfLocalDay, formatDate, formatTime } from '@kiko/dates';
import { buildRateTable, canConvert } from '@kiko/rates/net-worth-view';
import SummaryTable from '@kiko/design-system/components/summary-table';
import LoadingState from '@kiko/design-system/components/loading-state';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import { isSyncedHolding, isSyncedTransaction } from '@kiko/holdings/deletable';
import EntityHeaderIcon from '@kiko/design-system/components/entity-header-icon';
import { type BondTerms, holdingRegisterCoupons } from '@kiko/bonds/nbu-register';
import EntityAmountHeader from '@kiko/design-system/components/entity-amount-header';
import Screen, { resolveBottomClearance } from '@kiko/design-system/components/screen';
import MoneyText, { type MoneyTextTone } from '@kiko/design-system/components/money-text';
import { useDataReady, useLiveQuery, type HoldingRow, type TransactionRow } from '@kiko/db';
import { type FC, type ReactElement, type ReactNode, useLayoutEffect, useMemo } from 'react';
import { type HoldingValueBreakdown, holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { type DerivedEntry, derivedEntries, type EntryTone } from '@kiko/holdings/derived-entries';

import {
  type FooterAction,
  type HoldingBreakdownSpec,
  holdingDetailSpecFor,
} from './holding-detail-spec';
import ShareChanges from './share-changes';
import UpcomingPayments from './upcoming-payments';
import { useBondRegisterTerms } from './use-bond-register-terms';

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
  icon: holding.icon ?? defaultHoldingSymbol(holding),
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

// A row reads an amount, or (a property's share) a plain text value.
type BreakdownRow =
  | { label: string; money: Money; tone?: MoneyTextTone; testID?: string }
  | { label: string; text: string; testID?: string };

const BreakdownValue: FC<{ row: BreakdownRow }> = ({ row }) => {
  if ('text' in row) {
    return <Text variant="body">{row.text}</Text>;
  }

  return <MoneyText money={row.money} tone={row.tone} />;
};

// The deposit/bond breakdown: principal-or-cost, gross, interest, tax, and a
// bond's own whole-life expected profit and yield to maturity. Only these two
// types accrue interest/withhold tax, so this table is meaningful there.
const interestBreakdownRows = (
  breakdown: HoldingValueBreakdown,
  spec: Extract<HoldingBreakdownSpec, { kind: 'interest' }>,
  holding: HoldingRow,
  registerTerms: BondTerms | null,
  t: TFunction,
): BreakdownRow[] => {
  const expectedProfit = spec.expectedProfit(holding, registerTerms);
  const yieldRows =
    foldMap(maybe(spec.yieldToMaturity(holding, registerTerms)), (rate) => [
      {
        label: t('holdingDetail.yieldToMaturity'),
        text: yieldToMaturityText(rate),
        testID: 'bond-yield-to-maturity',
      },
    ]) ?? [];

  return [
    {
      label: t(spec.principalLabelKey),
      money: breakdown.principalOrCost,
    },
    { label: t('holdingDetail.grossValue'), money: breakdown.gross },
    // Interest and tax carry a fixed tone by KIND (interest always green, tax
    // always red), the same rule the derived ledger rows use — not the
    // sign-only balance coloring, which would leave a positive interest/tax
    // magnitude white — except when the amount is exactly zero, where
    // `ledgerTone` mutes it to gray instead.
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
    // Bonds surface the whole-life expected profit: sum of net coupons +
    // nominal redeemed, less the price paid (the figure the bank statement
    // shows). It reads green as the holding's expected gain.
    ...(expectedProfit
      ? [
          {
            label: t('holdingDetail.expectedProfit'),
            money: expectedProfit,
            tone: 'positive' as const,
          },
        ]
      : []),
    ...yieldRows,
  ];
};

// A priced type's (`property_item`, `metal`, `share`) breakdown: its cost basis, its
// current priced value, and the gain between them. No interest/tax rows — a
// priced type accrues neither, so those would only ever read a misleading
// zero. Gain carries no explicit tone: MoneyText's own sign-based fallback
// already reads a loss red and a gain green, the same as every other bare
// signed amount in this screen.
const pricedBreakdownRows = (breakdown: HoldingValueBreakdown, t: TFunction): BreakdownRow[] => [
  { label: t('holdingDetail.cost'), money: breakdown.principalOrCost },
  { label: t('holdingDetail.value'), money: breakdown.gross },
  { label: t('holdingDetail.gain'), money: breakdown.gross.subtract(breakdown.principalOrCost) },
];

// A property owned in part: the whole asset's value, the share (in the form
// the user typed it) and the day it took effect, then the owned value, the
// owned cost, and the owned gain — the same amounts the breakdown values it at.
const sharedPropertyBreakdownRows = (
  breakdown: HoldingValueBreakdown,
  ownership: PropertyOwnershipView,
  t: TFunction,
): BreakdownRow[] => {
  const shareText = ownershipShareDetailText(ownership.share, ownership.input, activeLocale());
  const since = t('holdingDetail.shareSince', {
    date: formatDate(ownership.since, { timeZone: 'UTC' }),
  });

  return [
    {
      label: t('holdingDetail.wholeValue'),
      money: ownership.whole,
      testID: 'ownership-whole-value',
    },
    {
      label: t('holdingDetail.yourShare'),
      text: `${shareText} ${since}`,
      testID: 'ownership-share',
    },
    {
      label: t('holdingDetail.ownedValue'),
      money: breakdown.gross,
      testID: 'ownership-owned-value',
    },
    {
      label: t('holdingDetail.ownedCost'),
      money: breakdown.principalOrCost,
      testID: 'ownership-owned-cost',
    },
    {
      label: t('holdingDetail.gain'),
      money: breakdown.gross.subtract(breakdown.principalOrCost),
      testID: 'ownership-gain',
    },
  ];
};

// A loan's breakdown: its principal and what its linked payments paid, split
// into interest and principal (`loanLedgerSummary`), ending on the SAME
// outstanding the Value header shows. Every amount is a positive magnitude,
// so no row carries a tone. Unparsable metadata shows no rows, the same way
// the descriptor values such a loan at 0.
const loanBreakdownRows = (
  holding: HoldingRow,
  book: PriceBook,
  now: number,
  t: TFunction,
): BreakdownRow[] =>
  foldMap(maybe(asLoanMeta(holding.metadata)), (meta) => {
    const summary = loanLedgerSummary(meta, holding, book, now);
    const money = (minorUnits: number): Money => Money.of(holding.currency, minorUnits);

    return [
      {
        label: t('holdingDetail.principal'),
        money: money(summary.principalMinorUnits),
        testID: 'loan-ledger-principal',
      },
      {
        label: t('holdingDetail.paidSoFar'),
        money: money(summary.paidSoFarMinorUnits),
        testID: 'loan-ledger-paid-so-far',
      },
      {
        label: t('holdingDetail.interestPaid'),
        money: money(summary.interestPaidMinorUnits),
        testID: 'loan-ledger-interest-paid',
      },
      {
        label: t('holdingDetail.principalRepaid'),
        money: money(summary.principalRepaidMinorUnits),
        testID: 'loan-ledger-principal-repaid',
      },
      {
        label: t('holdingDetail.outstanding'),
        money: money(summary.outstandingMinorUnits),
        testID: 'loan-ledger-outstanding',
      },
    ];
  }) ?? [];

// Rows that break the headline net value into its parts, dispatched off the
// holding type's own breakdown spec (kiko-code-style: ts-pattern for a closed
// set constructed locally, never a switch).
const breakdownRows = (
  breakdown: HoldingValueBreakdown,
  spec: HoldingBreakdownSpec,
  holding: HoldingRow,
  book: PriceBook,
  registerTerms: BondTerms | null,
  now: number,
  t: TFunction,
): BreakdownRow[] =>
  match(spec)
    .with({ kind: 'interest' }, (interestSpec) =>
      interestBreakdownRows(breakdown, interestSpec, holding, registerTerms, t),
    )
    .with(
      { kind: 'priced' },
      () =>
        foldMap(maybe(propertyOwnershipView(holding, now, book)), (ownership) =>
          sharedPropertyBreakdownRows(breakdown, ownership, t),
        ) ?? pricedBreakdownRows(breakdown, t),
    )
    .with({ kind: 'loan' }, () => loanBreakdownRows(holding, book, now, t))
    .exhaustive();

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

// The Value header's secondary caption slot (`EntityAmountHeader`'s
// `secondary` prop): the converted-to-base line — a module-scope component
// (mirroring `LedgerRowItem` below) so the conditional JSX does not count
// against the screen component's own cognitive-complexity budget. Renders
// nothing (null) without a converted value, the same as the screen
// previously passing `secondary={undefined}`.
const ValueHeaderSecondary: FC<{
  convertedToBase: Money | null;
}> = ({ convertedToBase }) => {
  if (!convertedToBase) {
    return null;
  }

  return (
    <Box testID="holding-detail-converted">
      <Text variant="caption" tone="textSecondary">
        {formatMoney(convertedToBase, activeLocale())}
      </Text>
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
  // Duplicate this ledger row into a pre-filled create form. Passed for
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
  const clock = useTimeClock();
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
              {showTime ? ` · ${formatTime(derivedRow.entry.time, clock)}` : ''}
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
      const categoryKey = resolveCategoryKey(
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
          // opens the create form pre-filled from this row.
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
                      color={resolveCategoryColor(category.color, categoryKey)}
                      accessibilityLabel={category.title}
                    />
                    {/* A small "loan payment" marker, uniform with Home's
                      list row — shown regardless of `loanLinkSource` ('auto'
                      or 'manual' read the same marker). No accessibility
                      label: decorative, mirroring `SelectableRow`'s own
                      checkmark glyph — the row's own accessible content
                      already fully describes the transaction. */}
                    {transactionRow.transaction.loanHoldingId != null && (
                      <SymbolIcon
                        name="link"
                        size={theme.iconSizes.caption}
                        tone="textSecondary"
                        testID="ledger-row-loan-link-marker"
                      />
                    )}
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
                      {formatTime(transactionRow.transaction.time, clock)}
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

// The loan detail's own "Linked payments" section — every transaction the
// matcher (or a manual pick) linked to THIS loan, in the order the query
// hands them (newest first). Hidden entirely (returns null) once there are
// none, rather than an empty heading with nothing beneath it. Reuses the
// shared `LedgerRowItem` (and its own loan-link marker) exactly as the
// ledger FlatList does, but as a plain `.map` here rather than a second
// FlatList — this list is always small (one loan's own payments), never a
// synced card's thousands of rows. Each row's OWN `holdingName` is
// resolved from the PAYER holding it actually belongs to (never the loan
// being viewed), matching `transactionRowDescription`'s own blank-description
// fallback convention.
const LinkedPaymentsSection: FC<{
  title: string;
  payments: readonly TransactionRow[];
  holdingNameById: ReadonlyMap<string, string>;
  context: LedgerRowContext;
}> = ({ title, payments, holdingNameById, context }) => {
  if (payments.length === 0) {
    return null;
  }

  return (
    <Box gap={2}>
      <Text variant="heading">{title}</Text>
      {payments.map((transaction) => (
        <LedgerRowItem
          key={transaction.id}
          row={{ kind: 'transaction', time: transaction.time, transaction }}
          context={{ ...context, holdingName: holdingNameById.get(transaction.holdingId) ?? '' }}
        />
      ))}
    </Box>
  );
};

// The footer's per-type primary action, extracted to module scope (mirroring
// `resolveLedgerReadyView` below) so the `match` branching does not count
// against the screen component's own cognitive-complexity budget. `undefined`
// while `!isReady` (overriding every case) — a synced holding must never show
// the "Add transaction" action before its own account row has loaded
// (kiko-architecture's useLiveQuery consumer rule) — and for every type that
// takes no footer action of its own (a bond, a synced holding). `lotSymbol`
// is the holding's own type glyph, which leads "Add lot". Two actions follow
// account detail's footer: the lower-emphasis one as a tonal button above the
// primary "Add …" action.
const holdingDetailFooterAction = (
  isReady: boolean,
  footerAction: FooterAction,
  holdingId: string,
  isDebtHolding: boolean,
  lotSymbol: string | undefined,
  navigation: HoldingDetailScreenProps['navigation'],
  t: TFunction,
): ReactNode => {
  if (!isReady) {
    return undefined;
  }

  const addLotButton = (
    <Button onPress={() => navigation.navigate('LotForm', { holdingId })} icon={lotSymbol}>
      {t('holdingDetail.addLot')}
    </Button>
  );

  return match(footerAction)
    .with('contribution', () => (
      <Button
        onPress={() => navigation.navigate('ContributionForm', { holdingId })}
        icon="calendar.badge.plus"
      >
        {t('forms.holding.addContribution')}
      </Button>
    ))
    .with('transaction', () => (
      <Button
        onPress={() => navigation.navigate('TransactionForm', { holdingId })}
        icon={genericEntitySymbol.transaction}
      >
        {t('holdingDetail.addTransaction')}
      </Button>
    ))
    .with('updateValue', () => (
      <Button onPress={() => navigation.navigate('PricePointForm', { holdingId })}>
        {t(isDebtHolding ? 'holdingDetail.updateOutstanding' : 'holdingDetail.updateValue')}
      </Button>
    ))
    .with('addLot', () => addLotButton)
    .with('addLotAndUpdatePrice', () => (
      <Box gap={2}>
        <Button
          variant="secondaryTonal"
          onPress={() => navigation.navigate('PricePointForm', { holdingId })}
        >
          {t('holdingDetail.updatePrice')}
        </Button>

        {addLotButton}
      </Box>
    ))
    .with('none', () => undefined)
    .exhaustive();
};

type LedgerReadyView = {
  data: LedgerListItem[];
  headerComponent: ReactElement;
  emptyComponent: ReactElement | undefined;
};

// Resolves the ledger FlatList's own loading-vs-ready content in one place —
// module scope, mirroring `ValueHeaderSecondary`/`breakdownRows` above — so
// branching on `isReady` does not count against the screen component's own
// cognitive-complexity budget. The FlatList itself stays MOUNTED either way
// (`bleedTop` + `contentInsetAdjustmentBehavior` must apply from the very
// first render — kiko-architecture's useLiveQuery consumer rule): while
// `!isReady` it shows no ledger rows, no "no transactions" empty text, and no
// loaded summary header — only the shared `LoadingState` in the header slot,
// so nothing renders as a final (empty or partial) state while this screen's
// own queries are still loading.
const resolveLedgerReadyView = (
  isReady: boolean,
  listData: LedgerListItem[],
  listHeader: ReactElement,
  emptyText: string,
): LedgerReadyView => {
  if (!isReady) {
    return {
      data: [],
      headerComponent: <LoadingState testID="holding-detail-loading" />,
      emptyComponent: undefined,
    };
  }

  return {
    data: listData,
    headerComponent: listHeader,
    emptyComponent: (
      <Box style={styles.empty}>
        <Text tone="textSecondary">{emptyText}</Text>
      </Box>
    ),
  };
};

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { holdingId, name: initialName } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings, isLoading: holdingsLoading } = useLiveQuery(
    holdingsRepo.allQuery(),
    ['holdings'],
    true,
    { cached: true },
  );
  const { data: transactions, isLoading: transactionsLoading } = useLiveQuery(
    transactionsRepo.listByHoldingQuery(holdingId),
    ['transactions'],
    true,
    { cached: true },
  );
  const { data: categories, isLoading: categoriesLoading } = useLiveQuery(
    categoriesRepo.allQuery(),
    ['categories'],
    true,
    { cached: true },
  );
  const { data: settingsRows, isLoading: settingsLoading } = useLiveQuery(
    settingsRepo.getQuery(),
    ['settings'],
    true,
    { cached: true },
  );
  // The cached conversion rates, so the Value amount can carry a smaller
  // converted base-currency caption beneath it — the same second line the
  // holding card shows for a holding in a non-base currency.
  const { data: rates, isLoading: ratesLoading } = useLiveQuery(
    ratesRepo.allQuery(),
    ['currency_rates'],
    true,
    { cached: true },
  );
  // kiko-architecture: skip the price_points read while this specific
  // holding's type never reads it — a type carrying no priced spec and not
  // a loan (`needsPriceBook`) never touches `price_points`. It stays enabled
  // while holdings are still on their first load, so the two reads run in
  // parallel instead of price_points waiting on holdings. Only a loan reads
  // the linked-payments half of the book.
  const { book: priceBook, isLoading: priceBookLoading } = usePriceBook(
    holdingsLoading ||
      holdings.some((candidate) => candidate.id === holdingId && needsPriceBook(candidate.type)),
    { cached: true },
    holdingsLoading ||
      holdings.some((candidate) => candidate.id === holdingId && candidate.type === 'loan'),
  );

  // Resolve each transaction row's stored category to its display (icon + title)
  // through the same shared mapping Home uses, so a rename flows through here too.
  const categoryByKey = buildCategoryDisplayMap(categories);
  // The configurable catch-all: a null/empty category resolves to this category
  // (seeded to `other`), matching Home and the statistics breakdown.
  const defaultCategoryKey = settingsRows.at(0)?.defaultCategoryKey ?? DEFAULT_CATEGORY_KEY;

  const holding = holdings.find((candidate) => candidate.id === holdingId);
  // The loan detail's own "Linked payments" section: the transactions the
  // matcher (or a manual pick) linked to THIS loan, newest first — a loan
  // is ledgerless, so its own `transactions` query above never finds them
  // (a payment always lives on the payer holding instead). Disabled outright
  // for every other holding type (kiko-architecture: never read data a
  // disabled caller does not need).
  const { data: linkedPayments, isLoading: linkedPaymentsLoading } = useLiveQuery(
    transactionsRepo.listLinkedToLoanQuery(holdingId),
    ['transactions'],
    holding?.type === 'loan',
    { cached: true },
  );
  // The register terms a bond's coupons, expected profit and yield to
  // maturity read its payments from.
  const { terms: registerTerms, isLoading: registerTermsLoading } = useBondRegisterTerms(holding);
  const currency: Currency = holding?.currency ?? 'UAH';
  const now = Date.now();
  const breakdown = holding ? holdingValueBreakdown(holding, now, priceBook) : null;
  // The owning account, so the footer's sync gate can read its `institution`.
  // `isSyncedHolding` requires BOTH a connected synced institution AND a sync
  // key in metadata, so a disconnected former-Monobank holding counts as manual
  // again and keeps its add action.
  const { data: accounts, isLoading: accountsLoading } = useLiveQuery(
    accountsRepo.byIdQuery(holding?.accountId ?? ''),
    ['accounts'],
    true,
    { cached: true },
  );
  const account = accounts.at(0);
  // The empty-transactions text, the footer add action, and the Value header
  // must never render while any of this screen's own queries is still on its
  // first load (kiko-architecture's useLiveQuery consumer rule) — gated below,
  // right at the return.
  const isReady = useDataReady(
    holdingsLoading,
    transactionsLoading,
    categoriesLoading,
    settingsLoading,
    ratesLoading,
    priceBookLoading,
    accountsLoading,
    linkedPaymentsLoading,
    registerTermsLoading,
  );
  // This holding's detail-screen behavior (`HoldingDetailSpec`,
  // `holding-detail-spec/`) — `undefined` when there is no real holding
  // (`holdingDetailSpecFor` itself always tolerates an unrecognized type).
  const spec = foldMap(maybe(holding), (found) => holdingDetailSpecFor(found.type));
  const todayStart = startOfLocalDay(now);
  // An annuity/differentiated loan's every remaining installment, listed just
  // below the Value header. Keyed on the local DAY, not the per-render `now`
  // millisecond (every input it reads is day-granular), so a 30-year
  // mortgage's 360 rows are not rebuilt, nor re-rendered, on every render.
  const upcomingInstallments = useMemo(
    () =>
      foldMap(maybe(holding), (found) =>
        spec?.upcomingInstallments(found, priceBook, todayStart),
      ) ?? [],
    [holding, spec, priceBook, todayStart],
  );

  // The user's main currency, and the rate table that converts into it. A
  // holding in a different currency shows a smaller converted base-currency
  // caption beneath its Value — the same second line the holding card renders.
  // `convert` throws on a missing rate pair, so the `canConvert` guard is
  // load-bearing: a BTC holding before the first rate sync shows no second line.
  const baseCurrency: Currency = settingsRows.at(0)?.baseCurrency ?? 'UAH';
  const rateTable = buildRateTable(rates);
  const convertedToBase = convertedBaseValue(holding, breakdown, baseCurrency, rateTable);

  // The transaction ledger merges the holding's real (stored) transactions with
  // the computed entries a deposit/bond accrues (contributions, interest, tax,
  // purchase, coupon — whatever `derivedEntries` yields for the type). Both
  // carry a `time`; the merged list is sorted newest-first to match the repo's
  // `desc(time)` ordering. Real rows stay interactive (swipe-to-delete, tap to
  // edit); derived rows are read-only and marked "Computed". A bond's coupons
  // each take their own register rate (a step-up bond's rate changes).
  const derived: DerivedEntry[] = useMemo(
    () =>
      holding
        ? derivedEntries(
            holding,
            now,
            t,
            holdingRegisterCoupons(holding.metadata, holding.currency, registerTerms),
          )
        : [],
    [holding, now, t, registerTerms],
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
  // Which add action the footer offers — or none, for a bond, a synced
  // holding, or a type this build's registry does not recognize
  // (`HoldingDetailSpec`, `holding-detail-spec/`).
  const footerAction: FooterAction =
    foldMap(maybe(holding), (found) =>
      spec?.footerAction(isSyncedHolding(found, account), found),
    ) ?? 'none';
  const lotSymbol = foldMap(maybe(holding?.type), (type) => holdingTypeSymbol[type]);
  // The footer's own label for `'updateValue'`: a debt-side type (loan) reads
  // "Update outstanding"; every other priced type reads "Update value". Reads
  // the SAME descriptor `side` net-worth math keys off, so this label and the
  // holding's own asset/debt classification can never diverge.
  const isDebtHolding =
    foldMap(maybe(holding?.type), holdingDescriptorOrUndefined)?.side === 'debt';
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
  // Unknown while the account row loads, so the form reads its own account
  // instead of being told the holding is not a loan.
  const debtAccount = foldMap(maybe(account), ({ kind }) => holdsOnlyDebts(kind));

  // The per-row read context, threaded into each ledger row so the row
  // component stays at module scope. `holdingName` is always a string (the
  // route param seeds it), so the old `?? ''` fallback is no longer needed.
  // Built here (rather than after `listHeader`, where this used to sit) so
  // the Linked-payments section below can read it too.
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
            // breakdown, detached from the value it converts.
            secondary={<ValueHeaderSecondary convertedToBase={convertedToBase} />}
          />
          {spec?.breakdown && (
            <Box style={styles.breakdown}>
              {/* The one shared "label left, value right" row layout
                  (`SummaryTable`) — this is the table the statement-import
                  preview and column-mapping result section now reuse the
                  LAYOUT of, never these value/percent/tax COLUMNS
                  themselves. */}
              <SummaryTable
                rows={breakdownRows(
                  breakdown,
                  spec.breakdown,
                  holding,
                  priceBook,
                  registerTerms,
                  now,
                  t,
                ).map((detail) => ({
                  key: detail.label,
                  label: detail.label,
                  testID: detail.testID,
                  value: <BreakdownValue row={detail} />,
                }))}
              />
            </Box>
          )}
          {upcomingInstallments.length > 0 && (
            <Box style={styles.breakdown}>
              <UpcomingPayments installments={upcomingInstallments} currency={currency} />
            </Box>
          )}
        </Box>
      )}

      <LinkedPaymentsSection
        title={t('holdingDetail.linkedPayments')}
        payments={linkedPayments}
        holdingNameById={holdingNameById}
        context={rowContext}
      />

      <ShareChanges
        holding={holding}
        onEdit={(day) => navigation.navigate('OwnershipChangeForm', { holdingId, day })}
        onDelete={(day) => holdingsRepo.removeOwnershipChange(holdingId, day)}
      />

      <Divider spacing={2} />

      <Text variant="heading">{t('holdingDetail.transactionsHeading')}</Text>
    </Box>
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: holdingName,
      ...(holdingAccountId !== undefined && {
        unstable_headerRightItems: () => [
          editBarItem({
            label: t('common.edit'),
            tintColor: theme.colors.textPrimary,
            onPress: () =>
              navigation.navigate('HoldingForm', {
                accountId: holdingAccountId,
                holdingId,
                debtAccount,
              }),
          }),
        ],
      }),
    });
  }, [
    navigation,
    holdingName,
    holdingAccountId,
    holdingId,
    debtAccount,
    t,
    theme.colors.textPrimary,
  ]);

  const ledgerReadyView = resolveLedgerReadyView(
    isReady,
    listData,
    listHeader,
    t('holdingDetail.emptyTransactions'),
  );

  return (
    <Screen
      // The FlatList below OWNS this screen's scrolling under the accounts
      // stack's native large title (`headerLargeTitle: true`). `bleedTop` makes
      // Screen render the FlatList as a DIRECT child of its SafeAreaView — with
      // NO intermediate `content` wrapper — so iOS tracks the FlatList as the
      // scroll view that drives the large-title COLLAPSE (an interposed wrapper
      // stops the collapse: the title stays stuck expanded). `bleedTop` also
      // drops Screen's top safe-area edge so the list reaches the top edge and
      // iOS applies the large-title content inset to it (via the FlatList's
      // own `contentInsetAdjustmentBehavior="automatic"` below) — without it,
      // the native large title has no scroll view to attach its content
      // inset to and overlaps the list header at scroll-top. This
      // mirrors the working `account-detail` scroll ScrollView, a direct child
      // of its own SafeAreaView; this screen cannot use `scroll` because a
      // virtualized FlatList must not nest inside that branch's ScrollView.
      // Because there is no wrapper, the FlatList owns its own horizontal and
      // bottom padding (see `styles.listContent` / `listBottomClearance`).
      bleedTop
      // A large, full-width primary action, shown for the holdings that take
      // one — see `holdingDetailFooterAction`'s own doc comment for the
      // per-type mapping and the `!isReady` gate.
      footer={holdingDetailFooterAction(
        isReady,
        footerAction,
        holdingId,
        isDebtHolding,
        lotSymbol,
        navigation,
        t,
      )}
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
        // Kept mounted while `!isReady` (never unmounted for a separate
        // loading branch) so `bleedTop` + `contentInsetAdjustmentBehavior`
        // still apply from the very first render — the same FlatList iOS
        // tracks to drive the large-title collapse throughout.
        // `resolveLedgerReadyView` resolves `data`/`ListHeaderComponent`/
        // `ListEmptyComponent` together: no stale/partial ledger or the
        // genuine "no transactions" text ever renders as final while any of
        // this screen's own queries is still loading — only the shared
        // LoadingState in the header slot.
        data={ledgerReadyView.data}
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
        ListHeaderComponent={ledgerReadyView.headerComponent}
        ListEmptyComponent={ledgerReadyView.emptyComponent}
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
  // The ledger's own empty state (`home.screen.tsx`'s
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
