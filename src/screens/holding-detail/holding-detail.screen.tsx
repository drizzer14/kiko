import {
  isSyncedHolding,
  isSyncedTransaction,
  isDeletableTransaction,
} from '@kiko/holdings/deletable';
import { match } from 'ts-pattern';
import {
  loanLedgerSummary,
  type LinkedPaymentBreakdown,
  type UpcomingLoanInstallment,
  loanLinkedPaymentBreakdownsMinor,
} from '@kiko/holdings/loan-ledger';
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
import { isRecord } from '@kiko/type-guards';
import { accountsRepo } from '@kiko/accounts';
import { settingsRepo } from '@kiko/settings';
import Screen, {
  useBottomClearance,
  useContentCap,
  useScrollIndicatorProps,
} from '@kiko/design-system/components/screen';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { FlatList, Pressable } from 'react-native';
import { formatMoney } from '@kiko/currency/format';
import Box from '@kiko/design-system/components/box';
import { categoriesRepo } from '@kiko/categories/repo';
import Text from '@kiko/design-system/components/text';
import { activeLocale } from '@kiko/i18n/active-locale';
import type { Currency } from '@kiko/currency/currency';
import { useTimeClock } from '@kiko/i18n/use-time-clock';
import type { PriceBook } from '@kiko/prices/price-book';
import { transactionsRepo } from '@kiko/transactions/repo';
import Button from '@kiko/design-system/components/button';
import LargeTitleHeading, {
  useLargeTitleScroll,
} from '@kiko/design-system/components/large-title-heading';
import { isHoldingType } from '@kiko/holdings/holding-type';
import { asLoanMeta } from '@kiko/holdings/holding-metadata';
import { groupByDay } from '@kiko/transactions/group-by-day';
import { needsPriceBook } from '@kiko/holdings/priced-value';
import Divider from '@kiko/design-system/components/divider';
import SymbolIcon from '@kiko/design-system/components/symbol';
import { editBarItem } from '@kiko/design-system/edit-bar-item';
import { removeNotice } from '@kiko/transactions/remove-notice';
import { convert, type RateTable } from '@kiko/rates/conversion';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import { holdingIdentity } from '@kiko/holdings/holding-identity';
import EntryCard from '@kiko/design-system/components/entry-card';
import { ownershipShareDetailText } from '@kiko/holdings/ownership';
import { yieldToMaturityText } from '@kiko/bonds/yield-to-maturity';
import EmptyState from '@kiko/design-system/components/empty-state';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { startOfLocalDay, formatDate, formatTime } from '@kiko/dates';
import { buildRateTable, canConvert } from '@kiko/rates/net-worth-view';
import SummaryTable from '@kiko/design-system/components/summary-table';
import LoadingState from '@kiko/design-system/components/loading-state';
import ExpandToggle from '@kiko/design-system/components/expand-toggle';
import { useCurrentPriceBook } from '@kiko/prices/use-current-price-book';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { asLots, changedLots, hasNegativeHolding } from '@kiko/holdings/lots';
import { transactionRowDescription } from '@kiko/transactions/row-description';
import CardContextMenu from '@kiko/design-system/components/card-context-menu';
import EntryDateHeader from '@kiko/design-system/components/entry-date-header';
import EntityHeaderIcon from '@kiko/design-system/components/entity-header-icon';
import { type BondTerms, holdingRegisterCoupons } from '@kiko/bonds/nbu-register';
import EntityAmountHeader from '@kiko/design-system/components/entity-amount-header';
import { genericEntitySymbol, holdingTypeSymbol } from '@kiko/holdings/entity-symbols';
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
import { useViewActions } from './use-view-actions';
import { paymentSplitText } from './payment-split-text';
import { useCloseWhenGone } from './use-close-when-gone';
import OversizedSaleNotice from './oversized-sale-notice';
import ScheduledPaymentRow from './scheduled-payment-row';
import LotRowMenu, { type LotActions } from './lot-row-menu';
import { useScheduledPreview } from './use-scheduled-preview';
import { useBondRegisterTerms } from './use-bond-register-terms';
import { useLinkedLoanPayments } from './use-linked-loan-payments';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

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

// A priced type's (`property_item`, `metal`) breakdown: its cost basis, its
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

// Principal repaid equals Paid so far when no payment carried interest or a fee (a 0% loan, or
// a loan with no payments yet); repeating the same amount adds nothing.
const showsPrincipalRepaid = (summary: ReturnType<typeof loanLedgerSummary>): boolean =>
  summary.principalRepaidMinorUnits !== summary.paidSoFarMinorUnits;

const NO_LINKED_BREAKDOWNS: ReadonlyMap<string, LinkedPaymentBreakdown> = new Map();

// A loan's counted linked payments with their own split and the balance each left; nothing for
// a holding that is not a loan with parsable metadata.
const linkedBreakdownsOf = (
  holding: HoldingRow | undefined,
  book: PriceBook,
  now: number,
): ReadonlyMap<string, LinkedPaymentBreakdown> =>
  foldMap(maybe(holding), (found) =>
    foldMap(maybe(asLoanMeta(found.metadata)), (meta) =>
      loanLinkedPaymentBreakdownsMinor(meta, found, book, now),
    ),
  ) ?? NO_LINKED_BREAKDOWNS;

// A loan's breakdown: its principal and what its linked payments paid, split
// into interest and principal (`loanLedgerSummary`; a within-tolerance fee is
// in neither), ending on the SAME outstanding the Value header shows. Every
// amount is a positive magnitude, so no row carries a tone. Unparsable
// metadata shows no rows, the same way the descriptor values such a loan at 0.
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
      ...(showsPrincipalRepaid(summary)
        ? [
            {
              label: t('holdingDetail.principalRepaid'),
              money: money(summary.principalRepaidMinorUnits),
              testID: 'loan-ledger-principal-repaid',
            },
          ]
        : []),
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
// nothing (null) without a converted value, the same as passing
// `secondary={undefined}`.
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

// One merged ledger row — a real stored transaction (a loan's linked payment
// too), a computed (derived) lifecycle entry, or a loan's scheduled payment,
// dated by its due day. Shared by the FlatList's `data`, `keyExtractor`, and
// `renderItem` so all three agree on the row shape.
type LedgerRow =
  | { kind: 'transaction'; time: number; transaction: TransactionRow }
  | { kind: 'derived'; time: number; entry: DerivedEntry }
  | { kind: 'scheduled'; time: number; installment: UpcomingLoanInstallment };

// A stable key per row, reusing the exact identity the eager `.map` keyed on: a
// derived entry's synthetic id, a stored row's transaction id, a scheduled
// payment's installment number.
const ledgerKey = (row: LedgerRow): string =>
  match(row)
    .with({ kind: 'derived' }, (derivedRow) => derivedRow.entry.id)
    .with({ kind: 'transaction' }, (transactionRow) => transactionRow.transaction.id)
    .with({ kind: 'scheduled' }, (scheduledRow) => `scheduled-${scheduledRow.installment.index}`)
    .exhaustive();

// The ledger's rows newest first: the holding's own transactions, a loan's linked payments
// (stored on the payer holding), the computed entries, and the scheduled payments to show.
const mergedLedger = (parts: {
  transactions: readonly TransactionRow[];
  linkedPayments: readonly TransactionRow[];
  derived: readonly DerivedEntry[];
  scheduled: readonly UpcomingLoanInstallment[];
}): LedgerRow[] =>
  [
    ...[...parts.transactions, ...parts.linkedPayments].map(
      (transaction): LedgerRow => ({ kind: 'transaction', time: transaction.time, transaction }),
    ),
    ...parts.derived.map((entry): LedgerRow => ({ kind: 'derived', time: entry.time, entry })),
    ...parts.scheduled.map(
      (installment): LedgerRow => ({ kind: 'scheduled', time: installment.dueDate, installment }),
    ),
  ].sort((first, second) => second.time - first.time);

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
  holdingId: string;
  holdingName: string;
  holdingNameById: Map<string, string>;
  holdingCurrencyById: Map<string, string>;
  // A loan's counted linked payments, by transaction id; empty for every other holding.
  linkedBreakdowns: ReadonlyMap<string, LinkedPaymentBreakdown>;
  onPressTransaction: (transactionId: string) => void;
  // Duplicate this ledger row into a pre-filled create form. Passed for
  // manual rows only (a synced row is not duplicable), stateless via the
  // `duplicateOfTransactionId` route param.
  onDuplicateTransaction: (transactionId: string) => void;
  // The row's "open its account / its holding" actions, by the holding the row is stored on.
  viewActionsFor: ReturnType<typeof useViewActions>;
  lotActions: LotActions | undefined;
};

// The name a stored row's blank-description fallback reads: its own holding's. A loan's linked
// payment lives on the payer holding, so it reads the payer's name, never the loan's.
const ledgerHoldingName = (rowHoldingId: string, context: LedgerRowContext): string =>
  rowHoldingId === context.holdingId
    ? context.holdingName
    : (context.holdingNameById.get(rowHoldingId) ?? '');

// A linked payment's own split and the loan balance right after it, the two lines a scheduled
// payment's card carries; no fee part, since the fee is not the loan's principal or interest.
const linkedPaymentFooterLines = (
  breakdown: LinkedPaymentBreakdown,
  currency: Currency,
  t: TFunction,
): string[] => [
  paymentSplitText(t, currency, breakdown.principalMinorUnits, breakdown.interestMinorUnits),
  t('holdingDetail.remainingBalance', {
    amount: formatMoney(Money.of(currency, breakdown.remainderMinorUnits), activeLocale()),
  }),
];

// A lot row is the user's own entry, so it is never marked "Computed"; a
// future-dated one still reads "Projected".
const derivedMarker = (entry: DerivedEntry, t: TFunction): string | undefined => {
  if (entry.isFuture) {
    return t('holdingDetail.projected');
  }

  if (entry.lotIndex !== undefined) {
    return undefined;
  }

  return t('holdingDetail.computed');
};

const derivedTitle = (entry: DerivedEntry, t: TFunction): string =>
  [entry.label, derivedMarker(entry, t)].filter((part) => part !== undefined).join(' · ');

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
    holdingNameById,
    holdingCurrencyById,
    linkedBreakdowns,
    onPressTransaction,
    onDuplicateTransaction,
    viewActionsFor,
    lotActions,
  } = context;

  return match(row)
    .with({ kind: 'scheduled' }, (scheduledRow) => {
      // A payment due on the loan's own schedule: not tappable, no menu, and dimmed like a
      // projected entry, since it has not happened yet. The day header above it names its date.
      return (
        <ScheduledPaymentRow
          installment={scheduledRow.installment}
          currency={currency}
          style={styles.futureRow}
        />
      );
    })
    .with({ kind: 'derived' }, (derivedRow) => {
      // A computed lifecycle entry (opening/top-up, interest accrual, the
      // 18%/5% withholding lines, capitalization, or a bond
      // purchase/coupon/redemption): not tappable, and titled "<label> ·
      // Computed" so it reads as derived, not a stored transaction; only a
      // lot row takes a long-press menu (`LotRowMenu`). A projected
      // (future-dated) entry — an upcoming accrual, coupon, or redemption —
      // is dimmed and titled "<label> · Projected". The amount reads in its
      // kind-derived tone (tax red, interest/coupon green, principal
      // movements neutral/by-sign), with the time under it on a timed type.
      return (
        <LotRowMenu entry={derivedRow.entry} actions={lotActions}>
          <EntryCard
            testID="ledger-row"
            label={derivedTitle(derivedRow.entry, t)}
            style={derivedRow.entry.isFuture ? styles.futureRow : undefined}
            amount={
              <MoneyText
                money={Money.of(currency, derivedRow.entry.amountMinorUnits)}
                tone={ledgerTone(derivedRow.entry.tone, derivedRow.entry.amountMinorUnits)}
              />
            }
            amountCaption={showTime ? formatTime(derivedRow.entry.time, clock) : undefined}
          />
        </LotRowMenu>
      );
    })
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
        holdingName: ledgerHoldingName(transactionRow.transaction.holdingId, context),
        holdingNameById,
        holdingCurrencyById,
        t,
      });

      // Every real row is tappable: it opens the shared Transaction form
      // for this id. A manual row edits; a synced (Monobank) row opens
      // read-only — the form resolves which from the transaction's own
      // `source`, so the row only needs to pass the id. Delete is a
      // touch-and-hold that opens the shared card context menu (see
      // `CardContextMenu`), the same long-press pattern the account/holding
      // cards use. Every row lists View account (and View holding, unless the
      // row is on this very holding); a manual row adds Duplicate and Delete,
      // an imported row Delete. A synced (Monobank) row is not deletable (its
      // state is owned by the sync), so its hold lists the View actions only.
      const { onViewAccount, onViewHolding } = viewActionsFor(transactionRow.transaction.holdingId);

      return (
        <CardContextMenu
          name={description}
          deletable={isDeletableTransaction(transactionRow.transaction)}
          // Read when the delete is requested, so it names what is stored now: a
          // row that is one part of a movement takes the rest with it.
          deleteMessage={async () =>
            removeNotice(await transactionsRepo.removePlan(transactionRow.transaction.id), t)
          }
          onDelete={() => transactionsRepo.remove(transactionRow.transaction.id)}
          // A synced or imported row is not duplicable — pass no handler so its
          // long-press keeps offering nothing more than Delete. A manual row's
          // Duplicate opens the create form pre-filled from this row.
          onDuplicate={
            isSyncedTransaction(transactionRow.transaction)
              ? undefined
              : () => onDuplicateTransaction(transactionRow.transaction.id)
          }
          onViewAccount={onViewAccount}
          onViewHolding={onViewHolding}
          liftOnHold
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => onPressTransaction(transactionRow.transaction.id)}
          >
            <EntryCard
              testID="ledger-row"
              label={description}
              lead={
                <SymbolIcon
                  name={category.icon}
                  size={theme.iconSizes.body}
                  tone="textSecondary"
                  color={resolveCategoryColor(category.color, categoryKey)}
                  accessibilityLabel={category.title}
                />
              }
              // A small "loan payment" marker beside the time, under the value —
              // shown regardless of `loanLinkSource` ('auto' or 'manual' read the
              // same marker). Decorative, so no accessibility label: the row's
              // own accessible content already fully describes the transaction.
              amountCaptionIcon={
                transactionRow.transaction.loanHoldingId != null
                  ? { name: 'link', testID: 'ledger-row-loan-link-marker' }
                  : undefined
              }
              amountCaption={
                showTime ? formatTime(transactionRow.transaction.time, clock) : undefined
              }
              amount={
                <MoneyText
                  money={Money.of(currency, transactionRow.transaction.amountMinorUnits)}
                  context="transaction"
                />
              }
              // A loan's linked payment the ledger counts also reads its split and the balance it
              // left; one the ledger ignores (before the start day) reads neither.
              footerLines={foldMap(
                maybe(linkedBreakdowns.get(transactionRow.transaction.id)),
                (breakdown) => linkedPaymentFooterLines(breakdown, currency, t),
              )}
            />
          </Pressable>
        </CardContextMenu>
      );
    })
    .exhaustive();
};

// What the list shows when it holds no row at all. A loan's rows are its linked and its
// scheduled payments, so it reads the shared `EmptyState`; every other holding reads the
// plain "No transactions" caption.
const LedgerEmpty: FC<{ isLoan: boolean }> = ({ isLoan }) => {
  const { t } = useTranslation();

  if (isLoan) {
    return (
      <EmptyState
        icon="link"
        title={t('holdingDetail.emptyLoanPayments.title')}
        message={t('holdingDetail.emptyLoanPayments.message')}
        testID="holding-detail-loan-payments-empty"
      />
    );
  }

  return (
    <Box style={styles.empty}>
      <Text tone="textSecondary">{t('holdingDetail.emptyTransactions')}</Text>
    </Box>
  );
};

// A lot's Delete is offered only while every sale stays covered without it;
// the repo checks the same change again inside its write, and a refusal there
// (the lots changed since this render) shows the shared save-error alert.
const buildLotActions = (
  holding: HoldingRow | undefined,
  navigation: HoldingDetailScreenProps['navigation'],
  t: TFunction,
): LotActions | undefined =>
  foldMap(maybe(holding), ({ id, metadata }): LotActions => {
    const lots = asLots(isRecord(metadata) ? metadata.lots : undefined) ?? [];

    return {
      edit: (lotIndex) => navigation.navigate('LotForm', { holdingId: id, lotIndex }),
      remove: async (lotIndex) => {
        try {
          await holdingsRepo.changeLots(id, { kind: 'remove', index: lotIndex });
        } catch {
          alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
        }
      },
      isRemovable: (lotIndex) =>
        !hasNegativeHolding(changedLots(lots, { kind: 'remove', index: lotIndex })),
    };
  });

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
    .with('addLot', () => (
      <Button onPress={() => navigation.navigate('LotForm', { holdingId })} icon={lotSymbol}>
        {t('holdingDetail.addLot')}
      </Button>
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
// `!isReady` it shows no ledger rows, no empty state, and no
// loaded summary header — only the shared `LoadingState` in the header slot,
// so nothing renders as a final (empty or partial) state while this screen's
// own queries are still loading.
const resolveLedgerReadyView = (
  isReady: boolean,
  listData: LedgerListItem[],
  listHeader: ReactElement,
  isLoan: boolean,
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
    emptyComponent: <LedgerEmpty isLoan={isLoan} />,
  };
};

// A row of a type outside this build's list (an imported dev-build holding)
// offers no Edit: the form dispatches on a descriptor that type does not have.
const editableAccountId = (holding: HoldingRow | undefined): string | undefined =>
  foldMap(maybe(holding), (found) => (isHoldingType(found.type) ? found.accountId : undefined));

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const headingScrollProps = useLargeTitleScroll();
  const { holdingId, name: initialName } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const {
    data: holdings,
    isLoading: holdingsLoading,
    isFresh: holdingsFresh,
  } = useLiveQuery(holdingsRepo.allQuery(), ['holdings'], true, { cached: true });
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
  const { book: priceBook, isLoading: priceBookLoading } = useCurrentPriceBook(
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
  const isLoan = holding?.type === 'loan';
  // A loan's linked payments are stored on their payers, so their View account needs the payer's
  // account too. Every other holding's rows sit on this holding, whose account is read below.
  const { data: accountList, isLoading: accountListLoading } = useLiveQuery(
    accountsRepo.listQuery(),
    ['accounts'],
    isLoan,
    { cached: true },
  );
  useCloseWhenGone({ routeKey: route.key, isFresh: holdingsFresh, holding });
  // The loan's linked payments, listed beside its scheduled ones.
  const { payments: linkedPayments, isLoading: linkedPaymentsLoading } = useLinkedLoanPayments(
    holdingId,
    isLoan,
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
  const knownAccounts = useMemo(() => [...accounts, ...accountList], [accounts, accountList]);
  const viewActionsFor = useViewActions({ holdingId, holdings, accounts: knownAccounts });
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
    accountListLoading,
    linkedPaymentsLoading,
    registerTermsLoading,
  );
  // This holding's detail-screen behavior (`HoldingDetailSpec`,
  // `holding-detail-spec/`) — `undefined` when there is no real holding
  // (`holdingDetailSpecFor` itself always tolerates an unrecognized type).
  const spec = foldMap(maybe(holding), (found) => holdingDetailSpecFor(found.type));
  const todayStart = startOfLocalDay(now);
  // An annuity/differentiated loan's every remaining installment, listed in
  // the ledger beside its linked payments. Keyed on the local DAY, not the
  // per-render `now` millisecond (every input it reads is day-granular), so a
  // 30-year mortgage's 360 rows are not rebuilt, nor re-rendered, on every render.
  const upcomingInstallments = useMemo(
    () =>
      foldMap(maybe(holding), (found) =>
        spec?.upcomingInstallments(found, priceBook, todayStart),
      ) ?? [],
    [holding, spec, priceBook, todayStart],
  );
  const scheduled = useScheduledPreview(upcomingInstallments);
  // Each counted linked payment's own split and the balance it left, read from the same ledger the
  // header's outstanding comes from, so the last card's balance is that outstanding. Keyed on the
  // local day for the same reason as the installments above.
  const linkedBreakdowns = useMemo(
    () => linkedBreakdownsOf(holding, priceBook, todayStart),
    [holding, priceBook, todayStart],
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
  // purchase, coupon — whatever `derivedEntries` yields for the type), and, for
  // a loan, its linked payments with the scheduled payments still to come. All
  // carry a `time`; the merged list is sorted newest-first to match the repo's
  // `desc(time)` ordering, so the future rows head it. Real rows stay interactive
  // (hold to delete, tap to edit); derived and scheduled rows are read-only. A
  // bond's coupons each take their own register rate (a step-up bond's rate changes).
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
    () => mergedLedger({ transactions, linkedPayments, derived, scheduled: scheduled.shown }),
    [transactions, linkedPayments, derived, scheduled.shown],
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
    foldMap(maybe(holding), (found) => spec?.footerAction(isSyncedHolding(found, account))) ??
    'none';
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
  // shared hook (the same one Home's list uses), which leaves the bottom inset
  // to the SafeAreaView and gives a pane that is not at the window's bottom none.
  const bottomClearance = useBottomClearance();
  const listBottomClearance = footerAction === 'none' ? bottomClearance : 0;
  // In a pane the list keeps the whole pane and its content is capped and centred.
  const contentCap = useContentCap();
  const scrollIndicatorProps = useScrollIndicatorProps();
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
  // language — nothing is persisted (see src/transactions/row-description/row-description.ts).
  const holdingNameById = useMemo(
    () => new Map(holdings.map((candidate) => [candidate.id, candidate.name])),
    [holdings],
  );
  // With the names, what tells a same-currency leg ("Transfer to") from a
  // cross-currency one ("Exchange to").
  const holdingCurrencyById = useMemo(
    () => new Map(holdings.map((candidate) => [candidate.id, candidate.currency])),
    [holdings],
  );
  // The holding's effective icon + color, rendered as the identity glyph beside
  // the Value amount (via `EntityHeaderIcon` in the `EntityAmountHeader` icon slot
  // below) rather than in the nav title.
  const identity = holding ? holdingIdentity(holding) : undefined;
  // The holding's owning account, needed to open its edit form (the form reads
  // the account's kind to constrain the type chips). Always present on a real
  // row (accountId is NOT NULL); the header Edit action is gated on it.
  const holdingAccountId = editableAccountId(holding);
  // Unknown while the account row loads, so the form reads its own account
  // instead of being told the holding is not a loan.
  const debtAccount = foldMap(maybe(account), ({ kind }) => holdsOnlyDebts(kind));

  // The per-row read context, threaded into each ledger row so the row
  // component stays at module scope. `holdingName` is always a string (the
  // route param seeds it), so no `?? ''` fallback is needed.
  const rowContext: LedgerRowContext = {
    currency,
    showTime,
    categoryByKey,
    defaultCategoryKey,
    holdingId,
    holdingName,
    holdingNameById,
    holdingCurrencyById,
    linkedBreakdowns,
    onPressTransaction: (transactionId) =>
      navigation.navigate('TransactionForm', { transactionId }),
    onDuplicateTransaction: (transactionId) =>
      navigation.navigate('TransactionForm', { duplicateOfTransactionId: transactionId }),
    viewActionsFor,
    lotActions: buildLotActions(holding, navigation, t),
  };

  // The header/summary block that scrolls above the ledger: the Value amount +
  // identity icon, the optional converted (main-currency) caption tucked
  // directly under that amount, the optional breakdown lines, and then the
  // hairline divider with the Transactions heading. A loan has no ledger of its
  // own, so it shows the divider and the Linked payments section there instead
  // (an empty state when nothing is linked). It sits in the FlatList's
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
            // hugging the value) and consistent across every holding type, so it
            // never floats as a disconnected caption at the BOTTOM of the whole
            // summary block, below a deposit/bond breakdown and detached from
            // the value it converts.
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
        </Box>
      )}

      <OversizedSaleNotice holding={holding} />

      <ShareChanges
        holding={holding}
        onEdit={(day) => navigation.navigate('OwnershipChangeForm', { holdingId, day })}
        onDelete={(day) => holdingsRepo.removeOwnershipChange(holdingId, day)}
      />

      <Divider spacing={2} testID="holding-detail-transactions-divider" />

      <Text variant="heading">{t('holdingDetail.transactionsHeading')}</Text>

      {/* Newest first puts the scheduled payments on top of the list, so the toggle that
          reveals the rest of them sits directly above them. */}
      {scheduled.canExpand && (
        <ExpandToggle
          expanded={scheduled.expanded}
          onPress={scheduled.toggle}
          testID="scheduled-payments-toggle"
        />
      )}
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

  const ledgerReadyView = resolveLedgerReadyView(isReady, listData, listHeader, isLoan);

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
          the rhythm a `<Box gap={2}>` would give — it lands between the header
          and the first row and between rows alike. */}
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
              <EntryDateHeader testID="ledger-day-header" title={item.dayTitle} />
            )}

            <LedgerRowItem row={item.row} context={rowContext} />
          </>
        )}
        // The full title, when it is too long for the native large title, is the first thing in
        // the list; it also shows while the ledger loads, since the title is known from the route.
        ListHeaderComponent={
          <>
            <LargeTitleHeading />

            {ledgerReadyView.headerComponent}
          </>
        }
        ListEmptyComponent={ledgerReadyView.emptyComponent}
        {...headingScrollProps}
        // The list owns the scrolling under the native large title, so it — not
        // Screen's ScrollView — must carry the automatic content-inset
        // adjustment that seats content below the expanded large title (Screen
        // passes `bleedTop` above to drop the matching double top inset). Same
        // setting the shared `Screen` scroll branch applies to its ScrollView.
        contentInsetAdjustmentBehavior="automatic"
        {...scrollIndicatorProps}
        style={styles.list}
        contentContainerStyle={[styles.listContent(listBottomClearance), contentCap]}
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
  // screen's padding:
  //  - top: `spacing(4)` below the collapsed large title (matching
  //    account-detail's scroll content), living here so the FlatList itself
  //    still reaches the top edge for iOS's automatic large-title inset;
  //  - horizontal: `spacing(4)`, the screen's side gutter;
  //  - bottom: a `spacing(4)` gap plus the caller's `bottomClearance` — 0 when a
  //    footer owns the floating tab-bar clearance, else `useBottomClearance`
  //    so the last row clears the bar exactly once (see the screen component).
  // The `spacing(2)` gap sits between every child — the header block and the
  // first row, and each row and the next — the same rhythm a `<Box gap={2}>`
  // around the Transactions heading and its rows would give.
  listContent: (bottomClearance: number) => ({
    paddingTop: theme.spacing(4),
    paddingHorizontal: theme.spacing(4),
    paddingBottom: theme.spacing(4) + bottomClearance,
    gap: theme.spacing(2),
  }),
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
}));

export default HoldingDetailScreen;
