import { holdingsRepo } from '@kiko/holdings/repo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { Alert, View, type ScrollViewInstance, type TextInputInstance } from 'react-native';

import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';
import { shiftDecimal } from '../../../currency/decimal';
import { Money } from '../../../currency/money';
import { parseAmount } from '../../../currency/parse';
import { useLiveQuery } from '../../../db/use-live-query';
import Box from '../../../design-system/components/box';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import TextField from '../../../design-system/components/text-field';
import { holdingInstrument } from '../../../prices/instrument';
import { dayKeyOf } from '../../../prices/price-book';
import { pricePointsRepo } from '../../../prices/price-points-repo';
import type { AccountsStackParamList } from '../../../navigation/types';

import DateField from '../date-field';
import { groupAmount } from '../amount-format/amount-format';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';

type PricePointFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'PricePointForm'>;

// Local midnight of today, matching DateField's own reported timestamp for a
// picked day — the sensible default ("value as of today"). Mirrors
// contribution-form's identical helper.
const startOfToday = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

// Records a new `manual` price point for a priced holding (property_item,
// T16 — `isPricedHoldingType`), reached from holding-detail's "Update value"
// footer action. Mirrors contribution-form's shape: a grouped-amount TextField
// plus the shared calendar DateField, writing through the same
// `pricePointsRepo.upsertMany` the PriceBook itself reads.
const PricePointFormScreen: FC<PricePointFormScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // (needed to convert the entered major value to a decimal-string price)
  // comes from filtering the full holdings list — the same approach the
  // sibling forms use.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  // A loan's correction targets its manual OUTSTANDING series through this
  // SAME form (T28 review round 1, Minor 6) — the title, field label, Save
  // label, and the 0-vs-greater-than-0 validation (I2: a loan can be repaid
  // to exactly 0) all switch on this flag, so no wording still says "Value"
  // once the holding has loaded as a loan.
  const isLoan = holding?.type === 'loan';

  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [date, setDate] = useState<number>(startOfToday);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const valueFieldRef = useRef<FieldInstance>(null);
  const valueInputRef = useRef<TextInputInstance>(null);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);

  // The stack sets the static "Update Value" title (accounts.stack.tsx); this
  // screen overrides it to read correctly for a debt once the holding loads
  // as a loan (holding-detail's footerActionFor reuses 'updateValue' for a
  // loan rather than minting a separate action). Mirrors HoldingFormScreen's
  // own edit-mode title override.
  useLayoutEffect(() => {
    if (isLoan) {
      navigation.setOptions({ title: t('forms.pricePoint.loanTitle') });
    }
  }, [isLoan, navigation, t]);

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }
    const majorValue = parseAmount(value);
    // I2: a loan's outstanding can reach exactly 0 (repaid) — every other
    // priced holding's value must stay strictly positive.
    const isValidValue = isLoan ? majorValue >= 0 : majorValue > 0;
    if (!isValidValue) {
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        valueFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => valueInputRef.current?.focus(),
      );

      return;
    }
    const minorUnits = Money.fromMajor(currency, majorValue).minorUnits;
    const price = shiftDecimal(String(minorUnits), -currencyScale[currency]);
    try {
      await pricePointsRepo.upsertMany([
        {
          instrument: holdingInstrument(holding.id),
          day: dayKeyOf(date),
          price,
          currency,
          source: 'manual',
        },
      ]);
    } catch {
      // Mirrors contribution-form's Alert pattern: a write failure keeps the
      // screen open with the entered values intact.
      Alert.alert(t('forms.fields.saveErrorTitle'), t('forms.fields.saveErrorMessage'));
      return;
    }
    navigation.goBack();
  };

  const { onPress: onSave, isSubmitting } = useSubmitOnce(save);

  return (
    <Screen
      scroll
      scrollableRef={scrollableRef}
      onContentSizeChange={(_width, height) => {
        contentHeightRef.current = height;
      }}
      footer={
        <Button onPress={onSave} disabled={isSubmitting}>
          {t(isLoan ? 'forms.pricePoint.loanSave' : 'forms.pricePoint.save')}
        </Button>
      }
    >
      <Box gap={4}>
        <View ref={valueFieldRef}>
          <TextField
            label={t(isLoan ? 'forms.pricePoint.loanValue' : 'forms.pricePoint.value')}
            value={value}
            onChangeText={(text) => setValue(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.pricePoint.valuePlaceholder')}
            suffix={currencySymbol[currency]}
            required
            error={
              attemptedSave && !(isLoan ? parseAmount(value) >= 0 : parseAmount(value) > 0)
                ? t(isLoan ? 'forms.pricePoint.loanValueError' : 'forms.pricePoint.valueError')
                : undefined
            }
            inputRef={valueInputRef}
          />
        </View>

        <DateField label={t('forms.fields.date')} value={date} onChange={setDate} />
      </Box>
    </Screen>
  );
};

export default PricePointFormScreen;
