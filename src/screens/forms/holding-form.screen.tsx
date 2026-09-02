import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, type ReactElement, useState } from 'react';
import { Pressable, TextInput, type TextInputProps } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { Currency } from '../../currency/currency';
import { Money } from '../../currency/money';
import Box from '../../design-system/components/box';
import Screen from '../../design-system/components/screen';
import Text from '../../design-system/components/text';
import type { CompoundingFrequency } from '../../holdings/holding-metadata';
import type { AccountsStackParamList } from '../../navigation/types';
import { holdingsRepo } from '../../repositories/holdings.repo';

type HoldingFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'HoldingForm'>;

const types = ['card', 'term_deposit', 'bond', 'cash', 'crypto_asset', 'jar'] as const;
type HoldingType = (typeof types)[number];

const currencies = ['BTC', 'USD', 'EUR', 'UAH'] as const;

const recapitalizationOptions = ['on', 'off'] as const;
const compoundingOptions: readonly CompoundingFrequency[] = [
  'daily',
  'monthly',
  'quarterly',
  'annually',
];

const HoldingFormScreen: FC<HoldingFormScreenProps> = ({ route, navigation }) => {
  const { accountId } = route.params;
  const { theme } = useUnistyles();
  const [name, setName] = useState('');
  const [type, setType] = useState<HoldingType>('card');
  const [currency, setCurrency] = useState<Currency>('UAH');
  const [openingBalance, setOpeningBalance] = useState('');

  // term deposit state
  const [principal, setPrincipal] = useState('');
  const [annualRate, setAnnualRate] = useState('');
  const [startDate, setStartDate] = useState('');
  const [termMonths, setTermMonths] = useState('');
  const [recapitalization, setRecap] = useState<'on' | 'off'>('on');
  const [compounding, setCompounding] = useState<CompoundingFrequency>('monthly');

  // bond state
  const [quantity, setQuantity] = useState('');
  const [faceValue, setFaceValue] = useState('');
  const [couponPct, setCouponPct] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [maturityDate, setMaturityDate] = useState('');

  const buildMetadata = (): Record<string, unknown> | undefined => {
    if (type === 'term_deposit') {
      return {
        principalMinorUnits: Money.fromMajor(currency, Number(principal) || 0).minorUnits,
        annualRatePct: Number(annualRate) || 0,
        startDate: Date.parse(startDate) || Date.now(),
        termMonths: Number(termMonths) || 0,
        recapitalization: recapitalization === 'on',
        compounding,
      };
    }
    if (type === 'bond') {
      return {
        quantity: Number(quantity) || 0,
        faceValueMinorUnits: Money.fromMajor(currency, Number(faceValue) || 0).minorUnits,
        couponPct: Number(couponPct) || 0,
        purchaseDate: Date.parse(purchaseDate) || Date.now(),
        maturityDate: Date.parse(maturityDate) || Date.now(),
      };
    }
    return undefined;
  };

  const save = async (): Promise<void> => {
    await holdingsRepo.create({
      accountId,
      name,
      type,
      currency,
      balanceMinorUnits: Money.fromMajor(currency, Number(openingBalance) || 0).minorUnits,
      metadata: buildMetadata(),
    });
    navigation.goBack();
  };

  const renderInput = (
    label: string,
    value: string,
    onChangeText: (next: string) => void,
    options?: { placeholder?: string; keyboardType?: TextInputProps['keyboardType'] },
  ): ReactElement => (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={options?.keyboardType}
        placeholder={options?.placeholder ?? label}
        placeholderTextColor={theme.colors.textSecondary}
        style={[
          styles.input,
          { color: theme.colors.textPrimary, borderColor: theme.colors.border },
        ]}
      />
    </Box>
  );

  const renderChips = <T extends string>(
    label: string,
    options: readonly T[],
    selected: T,
    onSelect: (option: T) => void,
  ): ReactElement => (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>
      <Box style={styles.chipRow} gap={2}>
        {options.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === option }}
            onPress={() => onSelect(option)}
            style={[
              styles.chip,
              { backgroundColor: selected === option ? theme.colors.accent : theme.colors.surface },
            ]}
          >
            <Text variant="body">{option}</Text>
          </Pressable>
        ))}
      </Box>
    </Box>
  );

  return (
    <Screen
      scroll
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={save}
          style={[styles.button, { backgroundColor: theme.colors.accent }]}
        >
          <Text variant="body">Save</Text>
        </Pressable>
      }
    >
      <Box gap={4}>
        {renderInput('Name', name, setName, { placeholder: 'Name' })}

        {renderChips('Type', types, type, setType)}

        {renderChips('Currency', currencies, currency, setCurrency)}

        {type !== 'term_deposit' &&
          type !== 'bond' &&
          renderInput('Balance', openingBalance, setOpeningBalance, {
            placeholder: '0.00',
            keyboardType: 'decimal-pad',
          })}

        {type === 'term_deposit' && (
          <Box gap={4}>
            {renderInput('Principal', principal, setPrincipal, {
              placeholder: '0.00',
              keyboardType: 'decimal-pad',
            })}
            {renderInput('Annual Rate %', annualRate, setAnnualRate, {
              placeholder: '0',
              keyboardType: 'decimal-pad',
            })}
            {renderInput('Start Date', startDate, setStartDate, { placeholder: 'YYYY-MM-DD' })}
            {renderInput('Term (Months)', termMonths, setTermMonths, {
              placeholder: '0',
              keyboardType: 'number-pad',
            })}
            {renderChips('Recapitalization', recapitalizationOptions, recapitalization, setRecap)}
            {renderChips('Compounding', compoundingOptions, compounding, setCompounding)}
          </Box>
        )}

        {type === 'bond' && (
          <Box gap={4}>
            {renderInput('Quantity', quantity, setQuantity, {
              placeholder: '0',
              keyboardType: 'number-pad',
            })}
            {renderInput('Face Value', faceValue, setFaceValue, {
              placeholder: '0.00',
              keyboardType: 'decimal-pad',
            })}
            {renderInput('Coupon %', couponPct, setCouponPct, {
              placeholder: '0',
              keyboardType: 'decimal-pad',
            })}
            {renderInput('Purchase Date', purchaseDate, setPurchaseDate, {
              placeholder: 'YYYY-MM-DD',
            })}
            {renderInput('Maturity Date', maturityDate, setMaturityDate, {
              placeholder: 'YYYY-MM-DD',
            })}
          </Box>
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
