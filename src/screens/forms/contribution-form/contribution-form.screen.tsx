import { holdingsRepo } from '@kiko/holdings/repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';

import { type Currency, currencySymbol } from '../../../currency/currency';
import { Money } from '../../../currency/money';
import { parseAmount } from '../../../currency/parse';
import { useLiveQuery } from '../../../db/use-live-query';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import TextField from '../../../design-system/components/text-field';
import type { AccountsStackParamList } from '../../../navigation/types';

import DateField from '../date-field';
import { groupAmount } from '../amount-format/amount-format';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import {
  resolveHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';

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

  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState<number>(startOfToday);
  const [attemptedSave, setAttemptedSave] = useState(false);

  // The scrollable content root and the amount field's own wrapper — passed
  // to `scrollToField` so a blocked Save (an invalid amount) scrolls the
  // field into view alongside its inline error. See scroll-to-field.ts. An
  // `useAnimatedRef` (rather than a plain `useRef`) so `useScrollOffset`
  // below can read the ScrollView's own live content offset.
  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const amountFieldRef = useRef<FieldInstance>(null);
  // The amount field's own inner TextInput, so a blocked Save can focus it
  // imperatively once it has scrolled into view.
  const amountInputRef = useRef<TextInputInstance>(null);
  const insets = useSafeAreaInsets();
  const headerInset = resolveHeaderInset(insets.top);

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
      scrollToField(
        scrollableRef,
        amountFieldRef,
        { currentOffset: scrollOffset.value, headerInset },
        () => amountInputRef.current?.focus(),
      );

      return;
    }
    const amountMinorUnits = Money.fromMajor(currency, majorAmount).minorUnits;
    try {
      await holdingsRepo.appendDepositContribution(holding.id, { amountMinorUnits, date });
    } catch {
      // Keep the screen open on failure so the entered values are not lost.
      Alert.alert(t('forms.contribution.errorTitle'), t('forms.contribution.errorMessage'));
      return;
    }
    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t('forms.contribution.save')}
        </Button>
      }
    >
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

        <DateField label={t('forms.fields.date')} value={date} onChange={setDate} />
      </Box>
    </Screen>
  );
};

export default ContributionFormScreen;
