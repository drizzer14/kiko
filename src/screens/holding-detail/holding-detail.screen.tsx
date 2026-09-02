import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useLayoutEffect, useState } from 'react';
import { Alert, Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import type { HoldingRow } from '../../db/schema';
import { Money } from '../../currency/money';
import { formatDateTime } from '../../dates/format';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import MoneyText from '../../design-system/components/money-text';
import PressableButton from '../../design-system/components/pressable-button';
import Screen from '../../design-system/components/screen';
import SwipeableRow from '../../design-system/components/swipeable-row';
import Text from '../../design-system/components/text';
import { isSyncedTransaction } from '../../holdings/deletable';
import { type DerivedEntry, derivedEntries } from '../../holdings/derived-entries';
import { type HoldingValueBreakdown, holdingValueBreakdown } from '../../holdings/holding-value';
import type { AccountsStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';
import { defaultTransactionDescription } from '../../transactions/default-description';
import IconEditor from '../icon-editor';

type HoldingDetailScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingDetail'>;

// Leading SF Symbol fallback per holding type, shown until the user picks a
// custom icon — the display-side default for the metadata header's IconEditor.
const TYPE_ICON: Record<HoldingRow['type'], string> = {
  card: 'creditcard',
  term_deposit: 'banknote',
  bond: 'doc.text',
  cash: 'banknote',
  crypto_asset: 'bitcoinsign.circle',
  jar: 'cup.and.saucer',
};

// Rows that break the headline net value into its parts. Only the deposit and
// bond types accrue interest/tax, so the breakdown is meaningful there; other
// types render a flat value where gross == net and these would all read zero.
const breakdownRows = (
  breakdown: HoldingValueBreakdown,
  type: string,
): { label: string; money: Money }[] => [
  { label: type === 'bond' ? 'Cost' : 'Principal', money: breakdown.principalOrCost },
  { label: 'Gross value', money: breakdown.gross },
  { label: 'Interest earned', money: breakdown.interest },
  { label: 'Tax withheld', money: breakdown.tax },
];

// The holding's own metadata, edited here rather than on the tiny account-detail
// list row: the icon opens the shared picker (with remove-to-default), and the
// name is a proper labelled field. Local name state seeds from the holding so
// keystrokes show immediately while the persisted value flows back through the
// live query; the rename commits once on end-of-editing (return-key submit or
// blur), and an empty or unchanged name is never written.
const HoldingMetadataHeader: FC<{ holding: HoldingRow }> = ({ holding }) => {
  const { theme } = useUnistyles();
  const [name, setName] = useState(holding.name);

  const commitName = (): void => {
    const trimmed = name.trim();

    if (trimmed !== '' && trimmed !== holding.name) {
      holdingsRepo.updateName(holding.id, trimmed);
    }
  };

  return (
    <Box direction="row" gap={3} style={styles.metadataHeader}>
      <IconEditor
        label="Icon"
        icon={holding.icon}
        fallbackIcon={TYPE_ICON[holding.type]}
        onSelect={(icon) => holdingsRepo.setIcon(holding.id, icon)}
        onRemove={() => holdingsRepo.setIcon(holding.id, null)}
      />

      <Box gap={1} style={styles.metadataNameBlock}>
        <Text variant="caption" tone="textSecondary">
          Name
        </Text>

        <TextInput
          accessibilityLabel={`${holding.name} name`}
          value={name}
          onChangeText={setName}
          onEndEditing={commitName}
          placeholderTextColor={theme.colors.textSecondary}
          style={styles.nameField}
        />
      </Box>
    </Box>
  );
};

const HoldingDetailScreen: FC<HoldingDetailScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  const { theme } = useUnistyles();
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to render each transaction's signed MoneyText) comes
  // from filtering the full holdings list for this id.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const { data: transactions } = useLiveQuery(transactionsRepo.listByHoldingQuery(holdingId), [
    'transactions',
  ]);

  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const now = Date.now();
  const breakdown = holding ? holdingValueBreakdown(holding, now) : null;

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
    // `Number('')` is 0, not NaN, so a blank field must be rejected explicitly:
    // require a strictly positive major amount and a parseable date. Anything
    // else keeps the form open (no zero-amount or invalid-date contribution).
    const majorAmount = Number(contributionAmount);
    const date = Date.parse(contributionDate);
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
    <Screen scroll>
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
                {breakdownRows(breakdown, holding.type).map((detail) => (
                  <Box
                    key={detail.label}
                    style={{ flexDirection: 'row', justifyContent: 'space-between' }}
                  >
                    <Text variant="caption" tone="textSecondary">
                      {detail.label}
                    </Text>
                    <MoneyText money={detail.money} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}

        <Box gap={2}>
          <Text variant="heading">Transactions</Text>
          {ledger.map((row) =>
            row.kind === 'derived' ? (
              // A computed entry (contribution/interest/tax/purchase/coupon):
              // read-only — no SwipeableRow, not tappable — and marked "Computed"
              // so it reads as derived, not a stored transaction. The signed
              // amount uses transaction sign coloring (positive green, negative
              // red).
              <Box
                key={row.entry.id}
                gap={1}
                style={[styles.row, { backgroundColor: theme.colors.surface }]}
              >
                <Box direction="row" style={styles.rowMain}>
                  <Box style={styles.rowDescription}>
                    <Text variant="body">{row.entry.label}</Text>
                  </Box>
                  <Box style={styles.rowAmount}>
                    <MoneyText
                      money={Money.of(currency, row.entry.amountMinorUnits)}
                      context="transaction"
                    />
                  </Box>
                </Box>
                <Text variant="caption" tone="textSecondary">
                  Computed · {formatDateTime(row.entry.time)}
                </Text>
              </Box>
            ) : (
              // Every real row is tappable: it opens the shared Transaction form
              // for this id. A manual row edits; a synced (Monobank) row opens
              // read-only — the form resolves which from the transaction's own
              // `source`, so the row only needs to pass the id. Swipe-to-delete
              // is disabled for synced rows (their state is owned by the sync).
              <SwipeableRow
                key={row.transaction.id}
                disabled={isSyncedTransaction(row.transaction)}
                onDelete={() => transactionsRepo.remove(row.transaction.id)}
              >
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    navigation.navigate('TransactionForm', { transactionId: row.transaction.id })
                  }
                >
                  <Box gap={1} style={[styles.row, { backgroundColor: theme.colors.surface }]}>
                    <Box direction="row" style={styles.rowMain}>
                      <Box style={styles.rowDescription}>
                        <Text variant="body">
                          {row.transaction.description ||
                            defaultTransactionDescription(
                              holdingName ?? '',
                              row.transaction.amountMinorUnits,
                            )}
                        </Text>
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
            ),
          )}
        </Box>

        {isDeposit &&
          (addingContribution ? (
            <Box gap={2}>
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
              >
                <Text variant="body">Save contribution</Text>
              </PressableButton>
            </Box>
          ) : (
            <PressableButton
              onPress={() => setAddingContribution(true)}
              backgroundColor={theme.colors.surfaceHigh}
              alignSelf="flex-start"
            >
              <Text variant="body">Add contribution</Text>
            </PressableButton>
          ))}

        <PressableButton
          onPress={() => navigation.navigate('TransactionForm', { holdingId })}
          backgroundColor={theme.colors.accent}
          alignSelf="flex-start"
        >
          <Text variant="body">Add transaction</Text>
        </PressableButton>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  // The holding's metadata header: the icon chip on the left, the name field
  // growing beside it. Bottom-aligned so the chip lines up with the field's
  // input row (which sits below its caption label) rather than its caption.
  metadataHeader: {
    alignItems: 'flex-end',
  },
  // The name field's column: grows to fill the row beside the fixed-width icon
  // chip, so a long holding name has room to render.
  metadataNameBlock: {
    flex: 1,
  },
  // A labelled name field: a bordered, filled input so the editable name reads
  // as a proper field rather than a tiny inline control.
  nameField: {
    color: theme.colors.textPrimary,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(2),
    ...theme.typography.body,
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
