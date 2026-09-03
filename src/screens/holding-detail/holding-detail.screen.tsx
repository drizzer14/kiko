import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useLayoutEffect, useState } from 'react';
import { Alert, Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { HoldingRow } from '../../db/schema';
import { Money } from '../../currency/money';
import { buildCategoryDisplayMap, resolveCategoryDisplay } from '../../categories/category-display';
import { formatDateTime, parseLocalDate } from '../../dates/format';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import SymbolIcon from '../../design-system/components/symbol';
import SwipeableRow from '../../design-system/components/swipeable-row';
import { useSwipePopGuard } from '../../design-system/components/swipeable-row/use-swipe-pop-guard';
import Text from '../../design-system/components/text';
import { isSyncedTransaction } from '../../holdings/deletable';
import { type DerivedEntry, type EntryTone, derivedEntries } from '../../holdings/derived-entries';
import LedgerAmount from './ledger-amount';
import { asBondMeta } from '../../holdings/holding-metadata';
import {
  bondExpectedProfitMinor,
  type HoldingValueBreakdown,
  holdingValueBreakdown,
} from '../../holdings/holding-value';
import type { AccountsStackParamList } from '../../navigation/types';
import { categoriesRepo } from '../../repositories/categories.repo';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { defaultTransactionDescription } from '../../transactions/default-description';
import { parseAmount } from '../../currency/parse';
import { holdingTypeIcon } from '../../holdings/holding-icon';
import HoldingIdentityField from '../forms/holding-identity-field';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

// The holding's own metadata, edited here rather than on the tiny account-detail
// list row: the shared identity control pairs the icon picker (with
// remove-to-default) with a labelled name field. Local name state seeds from
// the holding so keystrokes show immediately while the persisted value flows
// back through the live query; the rename commits once on end-of-editing
// (return-key submit or blur), and an empty or unchanged name is never written.
const HoldingMetadataHeader: FC<{ holding: HoldingRow }> = ({ holding }) => {
  const [name, setName] = useState(holding.name);

  const commitName = (): void => {
    const trimmed = name.trim();

    if (trimmed !== '' && trimmed !== holding.name) {
      holdingsRepo.updateName(holding.id, trimmed);
    }
  };

  return (
    <HoldingIdentityField
      icon={holding.icon}
      fallbackIcon={holdingTypeIcon[holding.type]}
      name={name}
      onChangeName={setName}
      onSelectIcon={(icon) => holdingsRepo.setIcon(holding.id, icon)}
      onRemoveIcon={() => holdingsRepo.setIcon(holding.id, null)}
      nameAccessibilityLabel={`${holding.name} name`}
      onEndEditingName={commitName}
    />
  );
};

// Rows that break the headline net value into its parts. Only the deposit and
// bond types accrue interest/tax, so the breakdown is meaningful there; other
// types render a flat value where gross == net and these would all read zero.
const breakdownRows = (
  breakdown: HoldingValueBreakdown,
  type: string,
  expectedProfit: Money | null,
): { label: string; money: Money; tone?: EntryTone }[] => [
  { label: type === 'bond' ? 'Cost' : 'Principal', money: breakdown.principalOrCost },
  { label: 'Gross value', money: breakdown.gross },
  { label: 'Interest earned', money: breakdown.interest },
  { label: 'Tax withheld', money: breakdown.tax },
  // Bonds surface the whole-life expected profit: sum of net coupons + nominal
  // redeemed, less the price paid (the figure the bank statement shows). It
  // reads green as the holding's expected gain.
  ...(expectedProfit
    ? [{ label: 'Expected profit', money: expectedProfit, tone: 'positive' as const }]
    : []),
];

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  const { theme } = useUnistyles();
  // Disable this screen's native back-swipe while any transaction row is open,
  // so a right-swipe that closes a row does not also pop the screen.
  const onOpenChange = useSwipePopGuard(navigation);
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listByHoldingQuery(holdingId), [
    'transactions',
  ]);
  const { data: categories } = useLiveQuery(categoriesRepo.allQuery(), ['categories']);

  // Resolve each transaction row's stored category to its display (icon + title)
  // through the same shared mapping Home uses, so a rename flows through here too.
  const categoryByKey = buildCategoryDisplayMap(categories);

  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const now = Date.now();
  const breakdown = holding ? holdingValueBreakdown(holding, now) : null;
  // Bonds show a whole-life expected profit line (net coupons + nominal - price).
  const bondMeta = holding?.type === 'bond' ? asBondMeta(holding.metadata) : null;
  const expectedProfit = bondMeta
    ? Money.of(currency, bondExpectedProfitMinor(bondMeta, currency))
    : null;

  // The transaction ledger merges the holding's real (stored) transactions with
  // the computed entries a deposit/bond accrues (contributions, interest, tax,
  // purchase, coupon — whatever `derivedEntries` yields for the type). Both
  // carry a `time`; the merged list is sorted newest-first to match the repo's
  // `desc(time)` ordering. Real rows stay interactive (swipe-to-delete, tap to
  // edit); derived rows are read-only and marked "Computed".
  const derived: DerivedEntry[] = holding ? derivedEntries(holding, now) : [];
  const ledger = [
    ...transactions.map((transaction) => ({
      kind: 'transaction' as const,
      time: transaction.time,
      transaction,
    })),
    ...derived.map((entry) => ({ kind: 'derived' as const, time: entry.time, entry })),
  ].sort((first, second) => second.time - first.time);
  const showBreakdown = holding?.type === 'term_deposit' || holding?.type === 'bond';
  const isDeposit = holding?.type === 'term_deposit';
  // Deposits and bonds take "contributions" (a deposit top-up or a bond
  // purchase); every other holding takes a plain transaction. The footer action
  // reads accordingly.
  const isContribution = holding?.type === 'term_deposit' || holding?.type === 'bond';

  // Local add-contribution form state. Kept collapsed until the user opens it so
  // the detail screen stays a read view by default.
  const [addingContribution, setAddingContribution] = useState(false);
  const [contributionAmount, setContributionAmount] = useState('');
  const [contributionDate, setContributionDate] = useState('');

  // The stack sets no static title for this screen, so drive the header title
  // from the holding's own name once it loads — otherwise the header falls
  // back to the raw "HoldingDetail" route name. Skip until the name is known
  // so the header never flashes an empty title.
  const holdingName = holding?.name;
  useLayoutEffect(() => {
    if (holdingName !== undefined) {
      navigation.setOptions({ title: holdingName });
    }
  }, [navigation, holdingName]);

  const submitContribution = async (): Promise<void> => {
    if (!holding) {
      return;
    }
    // parseAmount (accepting a comma decimal) yields NaN for a blank or junk
    // field, and `!(NaN > 0)` rejects it: require a strictly positive major
    // amount and a parseable date. Anything else keeps the form open (no
    // zero-amount or invalid-date contribution).
    const majorAmount = parseAmount(contributionAmount);
    // Parse the typed YYYY-MM-DD as LOCAL midnight (matching DateField and the
    // interest boundaries), not the UTC midnight Date.parse would give — which
    // would shift the contribution a day off in a +2/+3 zone.
    const date = parseLocalDate(contributionDate);
    if (!(majorAmount > 0) || Number.isNaN(date)) {
      return;
    }
    const amountMinorUnits = Money.fromMajor(currency, majorAmount).minorUnits;
    try {
      await holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date });
    } catch {
      // Keep the form open on failure so the entered values are not lost.
      Alert.alert('Could not add contribution', 'Please try again.');
      return;
    }
    setContributionAmount('');
    setContributionDate('');
    setAddingContribution(false);
  };

  const inputStyle = [
    styles.input,
    { color: theme.colors.textPrimary, borderColor: theme.colors.surfaceHigh },
  ];

  return (
    <Screen
      scroll
      footer={
        // A large, full-width primary action. For a deposit it opens the inline
        // top-up form; for a bond (also a "contribution") and every other
        // holding it opens the shared Transaction form to record the movement.
        <Button
          onPress={() =>
            isDeposit
              ? setAddingContribution(true)
              : navigation.navigate('TransactionForm', { holdingId })
          }
        >
          {isContribution ? 'Add contribution' : 'Add transaction'}
        </Button>
      }
    >
      <Box gap={4}>
        {holding && <HoldingMetadataHeader holding={holding} />}

        {holding && breakdown && (
          <Box gap={1}>
            <Text variant="caption" tone="textSecondary">
              Value
            </Text>
            <MoneyText money={breakdown.net} style={styles.headlineValue} />
            {showBreakdown && (
              <Box gap={1} style={styles.breakdown}>
                {breakdownRows(breakdown, holding.type, expectedProfit).map((detail) => (
                  <Box
                    key={detail.label}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                  >
                    <Text variant="caption" tone="textSecondary">
                      {detail.label}
                    </Text>
                    {detail.tone ? (
                      <LedgerAmount money={detail.money} tone={detail.tone} />
                    ) : (
                      <MoneyText money={detail.money} />
                    )}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        {isDeposit && addingContribution && (
          <Box gap={2}>
            <Text variant="heading">New contribution</Text>
            <TextInput
              accessibilityLabel="Contribution amount"
              value={contributionAmount}
              onChangeText={setContributionAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={theme.colors.textSecondary}
              style={inputStyle}
            />
            <TextInput
              accessibilityLabel="Contribution date"
              value={contributionDate}
              onChangeText={setContributionDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.colors.textSecondary}
              style={inputStyle}
            />
            <PressableButton
              onPress={submitContribution}
              backgroundColor={theme.colors.accent}
              alignSelf="flex-start"
              label="Save contribution"
            />
          </Box>
        )}

        <Box gap={2}>
          <Text variant="heading">Transactions</Text>
          {ledger.map((row) => {
            if (row.kind === 'derived') {
              // A computed lifecycle entry (opening/top-up, interest accrual, the
              // 18%/5% withholding lines, capitalization, or a bond
              // purchase/coupon/redemption): read-only — no SwipeableRow, not
              // tappable — and marked "Computed" so it reads as derived, not a
              // stored transaction. A projected (future-dated) entry — an
              // upcoming accrual, coupon, or redemption — is dimmed and marked
              // "Projected". The amount reads in its kind-derived tone (tax red,
              // interest/coupon green, principal movements neutral/by-sign).
              return (
                <Box
                  key={row.entry.id}
                  gap={1}
                  style={[
                    styles.row,
                    { backgroundColor: theme.colors.surface },
                    row.entry.isFuture && styles.futureRow,
                  ]}
                >
                  <Box direction="row" style={styles.rowMain}>
                    <Box style={styles.rowDescription}>
                      <Text variant="body">{row.entry.label}</Text>
                    </Box>
                    <Box style={styles.rowAmount}>
                      <LedgerAmount
                        money={Money.of(currency, row.entry.amountMinorUnits)}
                        tone={row.entry.tone}
                      />
                    </Box>
                  </Box>
                  <Text variant="caption" tone="textSecondary">
                    {row.entry.isFuture ? 'Projected' : 'Computed'} ·{' '}
                    {formatDateTime(row.entry.time)}
                  </Text>
                </Box>
              );
            }

            // The row's stored category resolves to its icon + title through the
            // same shared mapping Home uses; a null/unknown category falls back
            // to the neutral display.
            const category = resolveCategoryDisplay(row.transaction.category, categoryByKey);

            // Every real row is tappable: it opens the shared Transaction form
            // for this id. A manual row edits; a synced (Monobank) row opens
            // read-only — the form resolves which from the transaction's own
            // `source`, so the row only needs to pass the id. Swipe-to-delete
            // is disabled for synced rows (their state is owned by the sync).
            return (
              <SwipeableRow
                key={row.transaction.id}
                disabled={isSyncedTransaction(row.transaction)}
                onDelete={() => transactionsRepo.remove(row.transaction.id)}
                onOpenChange={onOpenChange}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    navigation.navigate('TransactionForm', { transactionId: row.transaction.id })
                  }
                >
                  <Box gap={1} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
                    <Box direction="row" style={styles.rowMain}>
                      <Box direction="row" gap={2} style={styles.rowLead}>
                        <SymbolIcon
                          name={category.icon}
                          size={18}
                          tone="textSecondary"
                          accessibilityLabel={category.title}
                        />
                        <Box style={styles.rowDescription}>
                          <Text variant="body">
                            {row.transaction.description ||
                              defaultTransactionDescription(
                                holdingName ?? '',
                                row.transaction.amountMinorUnits,
                              )}
                          </Text>
                        </Box>
                      </Box>
                      <Box style={styles.rowAmount}>
                        <MoneyText
                          money={Money.of(currency, row.transaction.amountMinorUnits)}
                          context="transaction"
                        />
                      </Box>
                    </Box>
                    <Text variant="caption" tone="textSecondary">
                      {formatDateTime(row.transaction.time)}
                    </Text>
                  </Box>
                </Pressable>
              </SwipeableRow>
            );
          })}
        </Box>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  // A projected (post-`now`) lifecycle entry, dimmed so it reads as an estimate
  // rather than a settled statement line.
  futureRow: {
    opacity: 0.5,
  },
  // The holding's headline net value: rendered at the title type scale so it
  // reads as the primary figure of the screen. Only size/weight live here —
  // MoneyText still owns the tone color, so this omits `color`.
  headlineValue: {
    fontSize: theme.typography.title.fontSize,
    fontWeight: theme.typography.title.fontWeight,
  },
  // Extra space above the value breakdown so the headline number sits clearly
  // apart from the principal/gross/interest/tax rows beneath it.
  breakdown: {
    marginTop: theme.spacing(3),
  },
  row: {
    padding: theme.spacing(3),
    borderRadius: theme.radii.sm,
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
  input: {
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    ...theme.typography.body,
  },
}));

export default HoldingDetailScreen;
