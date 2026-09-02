import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import { Pressable, TextInput } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import Box from '../../design-system/components/box';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { AccountsStackParamList } from '../../navigation/types';
import { accountsRepo } from '../../repositories/accounts.repo';
import ChipRow from './chip-row';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

// The account kinds offered in this form (a subset of the `kind` enum in
// db/schema.ts). A crypto account is created like a bank account — no initial
// holding/currency at creation; holdings are added later — so only cash needs
// the currency + initial-value fields below.
const kinds = ['bank', 'cash', 'crypto'] as const;
type Kind = (typeof kinds)[number];

const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

const AccountFormScreen: FC<AccountFormScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('bank');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');

  const trimmedName = name.trim();
  const canSave = trimmedName !== '';

  const save = async (): Promise<void> => {
    // Block submit on an empty (or whitespace-only) name; the button is also
    // disabled below so this guards the programmatic path too.
    if (!canSave) {
      return;
    }
    if (kind === 'cash') {
      // Clamp a negative initial value to zero — a cash balance can never be
      // negative, and Number('') || 0 also covers a blank field.
      const initialMajor = Math.max(0, Number(initialValue) || 0);
      await accountsRepo.createCashAccount({
        name: trimmedName,
        currency,
        initialBalanceMinorUnits: Money.fromMajor(currency, initialMajor).minorUnits,
      });
      navigation.goBack();
      return;
    }

    await accountsRepo.create({ name: trimmedName, kind });
    navigation.goBack();
  };

  return (
    <Screen
      scroll
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={save}
          style={[styles.button, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="body">Save</Text>
        </Pressable>
      }
    >
      <Box gap={4}>
        <TextInput
          accessibilityLabel="Name"
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border },
          ]}
        />

        <ChipRow options={kinds} selected={kind} onSelect={setKind} />

        {kind === 'cash' && (
          <>
            <ChipRow options={currencies} selected={currency} onSelect={setCurrency} />

            <TextInput
              accessibilityLabel="Initial value"
              value={initialValue}
              onChangeText={setInitialValue}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={theme.colors.textSecondary}
              style={[
                styles.input,
                { color: theme.colors.textPrimary, borderColor: theme.colors.border },
              ]}
            />
          </>
        )}
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
  button: {
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    borderRadius: theme.radii.sm,
    alignSelf: 'flex-start',
  },
}));

export default AccountFormScreen;
