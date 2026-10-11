import { useLiveQuery } from '@kiko/db';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { type FC, useRef, useState } from 'react';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import Box from '@kiko/design-system/components/box';
import DateField from '@kiko/screens/forms/date-field';
import Screen from '@kiko/design-system/components/screen';
import { View, type TextInputInstance } from 'react-native';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { type Currency, currencySymbol } from '@kiko/currency/currency';
import type { FieldInstance } from '@kiko/design-system/scroll-to-field';
import { useScrollToField } from '@kiko/design-system/use-scroll-to-field';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFormHeaderItems } from '@kiko/screens/forms/use-form-header-items';

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

// A dedicated screen for adding a deposit top-up. It uses the same shared
// inputs as the other forms — a grouped-amount TextField and the calendar
// DateField — and persists through `holdingsRepo.appendDepositContribution`.
const ContributionFormScreen: FC<ContributionFormScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major amount to minor units) comes from
  // filtering the full holdings list — the same approach the sibling forms use.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';

  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<number>(startOfToday);
  const [attemptedSave, setAttemptedSave] = useState(false);

  // The amount field's own wrapper — a blocked Save (an invalid amount)
  // scrolls it into view alongside its inline error. See scroll-to-field.ts.
  const { scrollableRef, onContentSizeChange, scrollTo } = useScrollToField();
  const amountFieldRef = useRef<FieldInstance>(null);
  // The amount field's own inner TextInput, so a blocked Save can focus it
  // imperatively once it has scrolled into view.
  const amountInputRef = useRef<TextInputInstance>(null);

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }
    // parseAmount (accepting a comma decimal) yields NaN for a blank or junk
    // field, and `!(NaN > 0)` rejects it: require a strictly positive major
    // amount before persisting anything.
    const majorAmount = parseAmount(amount);

    if (!(majorAmount > 0)) {
      setAttemptedSave(true);
      scrollTo(amountFieldRef, () => amountInputRef.current?.focus());

      return;
    }
    const amountMinorUnits = Money.fromMajor(currency, majorAmount).minorUnits;
    try {
      await holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date });
    } catch {
      // Keep the screen open on failure so the entered values are not lost.
      alertOnCatch(t, 'forms.contribution.errorTitle', 'forms.contribution.errorMessage');

      return;
    }
    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  useFormHeaderItems({ navigation, onSave, hasSave: true, isSaving: isSubmitting });

  return (
    <Screen scroll scrollableRef={scrollableRef} onContentSizeChange={onContentSizeChange}>
      <Box gap={4}>
        <View ref={amountFieldRef}>
          <TextField
            label={t('forms.fields.amount')}
            value={amount}
            onChangeText={(text) => setAmount(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.contribution.amountPlaceholder')}
            suffix={currencySymbol[currency]}
            required
            error={
              attemptedSave && !(parseAmount(amount) > 0)
                ? t('forms.contribution.amountError')
                : undefined
            }
            inputRef={amountInputRef}
          />
        </View>

        <DateField
          label={t('forms.fields.date')}
          sheetTitle={t('forms.fields.dateSheetTitle')}
          value={date}
          onChange={setDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
        />
      </Box>
    </Screen>
  );
};

export default ContributionFormScreen;
