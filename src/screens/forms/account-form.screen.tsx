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
import { holdingsRepo } from '../../repositories/holdings.repo';

type AccountFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'AccountForm'>;

// The account `kind` enum in the DB also has 'crypto' and 'broker' (see
// db/schema.ts), but this create form only offers Bank and Cash — those two
// kinds cover manual + Monobank-synced accounts today; the others have no
// creation flow yet, so hiding them here avoids offering a dead end.
const kinds = ['bank', 'cash'] as const;
type Kind = (typeof kinds)[number];

const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

const AccountFormScreen: FC<AccountFormScreenProps> = ({ navigation }) => {
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('bank');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [initialValue, setInitialValue] = useState('');

  const save = async (): Promise<void> => {
    if (kind === 'cash') {
      const accountId = await accountsRepo.createAndReturn({ name, kind: 'cash' });
      await holdingsRepo.create({
        accountId,
        name,
        type: 'cash',
        currency,
        balanceMinorUnits: Money.fromMajor(currency, Number(initialValue) || 0).minorUnits,
      });
      navigation.goBack();
      return;
    }

    await accountsRepo.create({ name, kind: 'bank' });
    navigation.goBack();
  };

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Add account</Text>

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

        <Box style={styles.chipRow} gap={2}>
          {kinds.map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === option }}
              onPress={() => setKind(option)}
              style={[
                styles.chip,
                { backgroundColor: kind === option ? theme.colors.accent : theme.colors.surface },
              ]}
            >
              <Text variant="body">{option}</Text>
            </Pressable>
          ))}
        </Box>

        {kind === 'cash' && (
          <>
            <Box style={styles.chipRow} gap={2}>
              {currencies.map(option => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: currency === option }}
                  onPress={() => setCurrency(option)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        currency === option ? theme.colors.accent : theme.colors.surface,
                    },
                  ]}
                >
                  <Text variant="body">{option}</Text>
                </Pressable>
              ))}
            </Box>

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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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

export default AccountFormScreen;
