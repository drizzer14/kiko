import { type FC, useEffect, useLayoutEffect, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { type Currency, currencyScale } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { TransactionFormParams } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';

// This screen is registered in BOTH the Home and Accounts stacks (Home lists
// every transaction; Accounts reaches it from a holding), so it cannot bind its
// props to a single stack's param list. It only needs the route params and two
// navigation methods, so it declares exactly that minimal shape — structurally
// satisfied by either stack's generated props.
type TransactionFormScreenProps = {
  route: { params: TransactionFormParams };
  navigation: { goBack: () => void; setOptions: (options: { title: string }) => void };
};

type Sign = 'income' | 'expense';

// The message shown on a synced row: its amount is owned by the bank import, so
// the form opens read-only rather than pretending an edit would stick.
const MONOBANK_NOTICE = 'This transaction was imported from Monobank and cannot be edited.';

// The header title reflects the mode: a synced row is a plain read-only view, an
// existing manual row is an edit, and no id at all is a fresh add.
const headerTitle = (isReadOnly: boolean, isEditing: boolean): string => {
  if (isReadOnly) {
    return 'Transaction';
  }

  return isEditing ? 'Edit Transaction' : 'Add Transaction';
};

const signedMinorUnits = (currency: Currency, amount: string, sign: Sign): number => {
  const magnitude = Money.fromMajor(currency, Number(amount));

  return sign === 'expense' ? -magnitude.minorUnits : magnitude.minorUnits;
};

// Present a stored (signed) minor-units amount as the unsigned major string the
// Amount input shows, pairing it with the sign chip the amount's polarity maps
// to. Kept pure so the hydration effect below stays a one-liner.
const toAmountFields = (
  currency: Currency,
  amountMinorUnits: number,
): { amount: string; sign: Sign } => {
  const factor = 10 ** currencyScale[currency];

  return {
    amount: (Math.abs(amountMinorUnits) / factor).toString(),
    sign: amountMinorUnits < 0 ? 'expense' : 'income',
  };
};

const TransactionFormScreen: FC<TransactionFormScreenProps> = ({ route, navigation }) => {
  const { theme } = useUnistyles();
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the detail screen uses.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);

  // Two entry points: `holdingId` = add a new manual row; `transactionId` = open
  // an existing one. In add mode the by-id query runs against an empty id and
  // returns nothing, keeping the hook order stable without a conditional call.
  const editingId = 'transactionId' in route.params ? route.params.transactionId : null;
  const { data: matchedTransactions } = useLiveQuery(
    transactionsRepo.getByIdQuery(editingId ?? ''),
    ['transactions'],
  );
  const existing = editingId ? matchedTransactions.at(0) : undefined;

  const holdingId =
    existing?.holdingId ?? ('holdingId' in route.params ? route.params.holdingId : undefined);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  const isReadOnly = existing?.source === 'monobank';
  // `editingId` is known synchronously from the route params, so the header
  // reads "Edit Transaction" immediately instead of flashing "Add Transaction"
  // until the row loads. Read-only still keys off the loaded `source`.
  const isEditing = editingId != null;

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [sign, setSign] = useState<Sign>('income');
  const [hydrated, setHydrated] = useState(false);

  // Seed the fields once, when BOTH the transaction and its holding have loaded
  // (the holding's currency scale is needed to render the amount). The `hydrated`
  // latch keeps a later live-query refresh from clobbering in-progress edits.
  useEffect(() => {
    if (existing && holding && !hydrated) {
      const fields = toAmountFields(currency, existing.amountMinorUnits);
      setAmount(fields.amount);
      setSign(fields.sign);
      setDescription(existing.description);
      setHydrated(true);
    }
  }, [existing, holding, hydrated, currency]);

  const title = headerTitle(isReadOnly, isEditing);
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const save = async (): Promise<void> => {
    // Guard: reject an empty or non-numeric amount — no zero-amount row.
    if (amount.trim() === '' || Number.isNaN(Number(amount))) {
      return;
    }
    const amountMinorUnits = signedMinorUnits(currency, amount, sign);
    if (editingId) {
      // A synced row never reaches here (its footer/Save is not rendered), and
      // the repo refuses a monobank update regardless.
      await transactionsRepo.update({
        transactionId: editingId,
        amountMinorUnits,
        time: existing?.time ?? Date.now(),
        description,
      });
    } else if (holdingId) {
      await transactionsRepo.recordManual({
        holdingId,
        amountMinorUnits,
        time: Date.now(),
        description,
      });
    }
    navigation.goBack();
  };

  const inputStyle = [
    styles.input,
    { color: theme.colors.textPrimary, borderColor: theme.colors.surfaceHigh },
  ];

  return (
    <Screen
      scroll
      footer={
        isReadOnly ? undefined : (
          <Pressable
            accessibilityRole="button"
            onPress={save}
            style={[styles.button, { backgroundColor: theme.colors.accent }]}
          >
            <Text variant="body">Save</Text>
          </Pressable>
        )
      }
    >
      <Box gap={4}>
        {isReadOnly && (
          <Box padding={3} style={[styles.notice, { backgroundColor: theme.colors.surfaceHigh }]}>
            <Text variant="caption" tone="textSecondary">
              {MONOBANK_NOTICE}
            </Text>
          </Box>
        )}

        <TextInput
          accessibilityLabel="Amount"
          value={amount}
          onChangeText={setAmount}
          editable={!isReadOnly}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textSecondary}
          style={inputStyle}
        />

        <TextInput
          accessibilityLabel="Description"
          value={description}
          onChangeText={setDescription}
          editable={!isReadOnly}
          placeholder="Description"
          placeholderTextColor={theme.colors.textSecondary}
          style={inputStyle}
        />

        <Box style={styles.toggleRow} gap={2}>
          {(['income', 'expense'] as const).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: sign === option, disabled: isReadOnly }}
              disabled={isReadOnly}
              onPress={() => setSign(option)}
              style={[
                styles.chip,
                { backgroundColor: sign === option ? theme.colors.accent : theme.colors.surface },
              ]}
            >
              <Text variant="body">{option === 'income' ? 'Income' : 'Expense'}</Text>
            </Pressable>
          ))}
        </Box>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  input: {
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    ...theme.typography.body,
  },
  notice: {
    borderRadius: theme.radii.sm,
  },
  toggleRow: {
    flexDirection: 'row',
  },
  chip: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
    alignSelf: 'flex-start',
  },
}));

export default TransactionFormScreen;
