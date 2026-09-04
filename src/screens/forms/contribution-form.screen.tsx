import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useState } from 'react';
import { Alert } from 'react-native';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import { parseAmount } from '../../currency/parse';
import { useLiveQuery } from '../../db/use-live-query';
import Box from '../../design-system/components/box';
import Button from '../../design-system/components/button';
import Screen from '../../design-system/components/screen';
import TextField from '../../design-system/components/text-field';
import type { AccountsStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';
import { groupAmount } from './amount-format';
import DateField from './date-field';

type ContributionFormScreenProps = NativeStackScreenProps<
  AccountsStackParamList,
  'ContributionForm'
>;

// Local midnight of today, matching the timestamp DateField itself reports for
// a picked day — the sensible default for a new top-up ("dated today").
const startOfToday = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

// A dedicated screen for adding a deposit top-up, replacing the old inline
// collapsible form on the holding-detail screen. It uses the same shared inputs
// as the other forms — a grouped-amount TextField and the calendar DateField —
// and persists through the exact same repo call the inline form used.
const ContributionFormScreen: FC<ContributionFormScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the sibling forms use.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<number>(startOfToday);

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }
    // parseAmount (accepting a comma decimal) yields NaN for a blank or junk
    // field, and `!(NaN > 0)` rejects it: require a strictly positive major
    // amount before persisting anything.
    const majorAmount = parseAmount(amount);
    if (!(majorAmount > 0)) {
      return;
    }
    const amountMinorUnits = Money.fromMajor(currency, majorAmount).minorUnits;
    try {
      await holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date });
    } catch {
      // Keep the screen open on failure so the entered values are not lost.
      Alert.alert('Could not add contribution', 'Please try again.');
      return;
    }
    navigation.goBack();
  };

  return (
    <Screen scroll footer={<Button onPress={save}>Save contribution</Button>}>
      <Box gap={4}>
        <TextField
          label="Amount"
          value={amount}
          onChangeText={(text) => setAmount(groupAmount(text))}
          keyboardType="decimal-pad"
          placeholder="0.00"
        />

        <DateField label="Date" value={date} onChange={setDate} />
      </Box>
    </Screen>
  );
};

export default ContributionFormScreen;
