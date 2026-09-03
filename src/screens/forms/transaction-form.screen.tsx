import { type FC, useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { type Currency, currencyScale } from '../../currency/currency';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import { groupAmount } from './amount-format';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import TextField from '../../design-system/components/text-field';
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
  const magnitude = Money.fromMajor(currency, parseAmount(amount));

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
      setAmount(groupAmount(fields.amount));
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
    if (amount.trim() === '' || Number.isNaN(parseAmount(amount))) {
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

  // A manual row can be deleted; the confirm dialog guards the destructive write,
  // and only its "Delete" button runs the removal, then returns to the list.
  const confirmDelete = (): void => {
    if (editingId === null) {
      return;
    }
    Alert.alert('Delete Transaction', 'This transaction will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await transactionsRepo.remove(editingId);
          navigation.goBack();
        },
      },
    ]);
  };

  return (
    <Screen scroll footer={isReadOnly ? undefined : <Button onPress={save}>Save</Button>}>
      <Box gap={4}>
        {isReadOnly && (
          <Box padding={3} style={[styles.notice, { backgroundColor: theme.colors.surfaceHigh }]}>
            <Text variant="caption" tone="textSecondary">
              {MONOBANK_NOTICE}
            </Text>
          </Box>
        )}

        <TextField
          label="Amount"
          value={amount}
          onChangeText={(text) => setAmount(groupAmount(text))}
          editable={!isReadOnly}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />

        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          editable={!isReadOnly}
          placeholder="Description"
        />

        <Box style={styles.toggleRow} gap={2}>
          {(['income', 'expense'] as const).map((option) => {
            const isSelected = sign === option;

            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected, disabled: isReadOnly }}
                disabled={isReadOnly}
                onPress={() => setSign(option)}
                style={[styles.chip, isSelected ? styles.chipSelected : styles.chipUnselected]}
              >
                <Text variant="body" tone={isSelected ? 'textPrimary' : 'textSecondary'}>
                  {option === 'income' ? 'Income' : 'Expense'}
                </Text>
              </Pressable>
            );
          })}
        </Box>

        {isEditing && !isReadOnly && (
          <Button variant="destructive" size="compact" fullWidth={false} onPress={confirmDelete}>
            Delete
          </Button>
        )}
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create((theme) => ({
  notice: {
    borderRadius: theme.radii.sm,
  },
  toggleRow: {
    flexDirection: 'row',
  },
  // Each option is an equal-width segment so the pair reads as one segmented
  // control rather than two free-floating buttons.
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
  },
  // The chosen option is clearly active: a solid accent fill behind white text.
  chipSelected: {
    backgroundColor: theme.colors.accent,
  },
  // The other option reads as inactive/disabled: a muted, dimmed surface behind
  // secondary-tone text, so it is unambiguous which side is selected.
  chipUnselected: {
    backgroundColor: theme.colors.surfaceHigh,
    opacity: 0.5,
  },
}));

export default TransactionFormScreen;
