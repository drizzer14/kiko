import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { useLiveQuery } from '../../db/use-live-query';
import { Box } from '../../design-system/components/box';
import { Screen } from '../../design-system/components/screen';
import { Text } from '../../design-system/components/text';
import type { RootStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { transactionsRepo } from '../../repositories/transactions.repo';

type TransactionFormScreenProps = NativeStackScreenProps<RootStackParamList, 'TransactionForm'>;

type Sign = 'income' | 'expense';

export const TransactionFormScreen: FC<TransactionFormScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  const { theme } = useUnistyles();
  // `holdingsRepo` exposes no single-row lookup, so the holding's own
  // currency (needed to convert the entered major amount to minor units)
  // comes from filtering the full holdings list for this id — the same
  // approach the detail screen uses. Currency does not change, so a
  // render-time read is fine; the balance is read atomically inside the
  // repo write, never from this snapshot.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find(candidate => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [sign, setSign] = useState<Sign>('income');

  const save = async (): Promise<void> => {
    const major = Number(amount);
    // Guard: reject an empty or non-numeric amount — no zero-amount row.
    if (amount.trim() === '' || Number.isNaN(major)) {
      return;
    }
    const magnitude = Money.fromMajor(currency, major);
    const amountMinorUnits = sign === 'expense' ? -magnitude.minorUnits : magnitude.minorUnits;
    await transactionsRepo.recordManual({
      holdingId,
      amountMinorUnits,
      time: Date.now(),
      description,
    });
    navigation.goBack();
  };

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Add transaction</Text>

        <TextInput
          accessibilityLabel="Amount"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.surfaceHigh },
          ]}
        />

        <TextInput
          accessibilityLabel="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Description"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.surfaceHigh },
          ]}
        />

        <Box style={styles.toggleRow} gap={2}>
          {(['income', 'expense'] as const).map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: sign === option }}
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

        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={[styles.button, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="body">Save</Text>
        </Pressable>
      </Box>
    </Screen>
  );
};

const styles = StyleSheet.create(theme => ({
  input: {
    borderWidth: 1,
    borderRadius: theme.radii.sm,
    padding: theme.spacing(3),
    ...theme.typography.body,
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
