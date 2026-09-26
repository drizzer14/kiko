import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { type FC, useLayoutEffect, useRef, useState } from 'react';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { holdingDescriptorOrUndefined } from '@kiko/holdings/holding-descriptor';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';

import DateField from '../date-field';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../scroll-to-field/scroll-to-field';
import { Money } from '../../../currency/money';
import { parseAmount } from '../../../currency/parse';
import { dayKeyOf } from '../../../prices/price-book';
import Box from '../../../design-system/components/box';
import { shiftDecimal } from '../../../currency/decimal';
import { useLiveQuery } from '../../../db/use-live-query';
import { groupAmount } from '../amount-format/amount-format';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import { holdingInstrument } from '../../../prices/instrument';
import { useSubmitOnce } from '../use-submit-once/use-submit-once';
import { pricePointsRepo } from '../../../prices/price-points-repo';
import { alertOnCatch } from '../../../design-system/alert-on-catch';
import TextField from '../../../design-system/components/text-field';
import type { AccountsStackParamList } from '../../../navigation/types';
import { type Currency, currencyScale, currencySymbol } from '../../../currency/currency';

type PricePointFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'PricePointForm'>;

// Local midnight of today, matching DateField's own reported timestamp for a
// picked day — the sensible default ("value as of today"). Mirrors
// contribution-form's identical helper.
const startOfToday = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

// Records a new `manual` price point for a priced holding (property_item,
// metal), reached from holding-detail's "Update value"
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
  // A debt's (only `loan` today) correction targets its manual OUTSTANDING
  // series through this SAME form — the title, field label, Save label, and
  // the 0-vs-greater-than-0 validation (a loan can be repaid to exactly 0)
  // all switch on this flag, so no wording still says "Value" once the
  // holding has loaded as a debt.
  const isDebt =
    holding !== undefined && holdingDescriptorOrUndefined(holding.type)?.side === 'debt';

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
  // as a loan (holding-detail's holdingDetailSpecs reuses 'updateValue' for a
  // loan rather than minting a separate action). Mirrors HoldingFormScreen's
  // own edit-mode title override.
  useLayoutEffect(() => {
    if (isDebt) {
      navigation.setOptions({ title: t('forms.pricePoint.loanTitle') });
    }
  }, [isDebt, navigation, t]);

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }
    const majorValue = parseAmount(value);
    // A loan's outstanding can reach exactly 0 (repaid) — every other
    // priced holding's value must stay strictly positive.
    const isValidValue = isDebt ? majorValue >= 0 : majorValue > 0;
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
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');
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
          {t(isDebt ? 'forms.pricePoint.loanSave' : 'forms.pricePoint.save')}
        </Button>
      }
    >
      <Box gap={4}>
        <View ref={valueFieldRef}>
          <TextField
            label={t(isDebt ? 'forms.pricePoint.loanValue' : 'forms.pricePoint.value')}
            value={value}
            onChangeText={(text) => setValue(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.pricePoint.valuePlaceholder')}
            suffix={currencySymbol[currency]}
            required
            error={
              attemptedSave && !(isDebt ? parseAmount(value) >= 0 : parseAmount(value) > 0)
                ? t(isDebt ? 'forms.pricePoint.loanValueError' : 'forms.pricePoint.valueError')
                : undefined
            }
            inputRef={valueInputRef}
          />
        </View>

        <DateField
          label={t('forms.fields.date')}
          value={date}
          onChange={setDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
        />
      </Box>
    </Screen>
  );
};

export default PricePointFormScreen;
