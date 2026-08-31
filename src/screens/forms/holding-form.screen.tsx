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
import { holdingsRepo } from '../../repositories/holdings.repo';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

const types = ['card', 'term_deposit', 'bond', 'cash', 'crypto_asset', 'jar'] as const;
type HoldingType = (typeof types)[number];

const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [type, setType] = useState<HoldingType>('card');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [openingBalance, setOpeningBalance] = useState('');

  const save = async (): Promise<void> => {
    await holdingsRepo.create({
      accountId,
      name,
      type,
      currency,
      balanceMinorUnits: Money.fromMajor(currency, Number(openingBalance) || 0).minorUnits,
    });
    navigation.goBack();
  };

  return (
    <Screen>
      <Box gap={4}>
        <Text variant="title">Add holding</Text>

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
          {types.map(option => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: type === option }}
              onPress={() => setType(option)}
              style={[
                styles.chip,
                { backgroundColor: type === option ? theme.colors.accent : theme.colors.surface },
              ]}
            >
              <Text variant="body">{option}</Text>
            </Pressable>
          ))}
        </Box>

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
                  backgroundColor: currency === option ? theme.colors.accent : theme.colors.surface,
                },
              ]}
            >
              <Text variant="body">{option}</Text>
            </Pressable>
          ))}
        </Box>

        <TextInput
          accessibilityLabel="Opening balance"
          value={openingBalance}
          onChangeText={setOpeningBalance}
          keyboardType="decimal-pad"
          placeholder="0.00"
          placeholderTextColor={theme.colors.textSecondary}
          style={[
            styles.input,
            { color: theme.colors.textPrimary, borderColor: theme.colors.border },
          ]}
        />

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

export default HoldingFormScreen;
