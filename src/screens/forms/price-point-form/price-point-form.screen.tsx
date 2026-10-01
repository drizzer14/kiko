import { match } from 'ts-pattern';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import { dayKeyOf } from '@kiko/prices/price-book';
import Box from '@kiko/design-system/components/box';
import { shiftDecimal } from '@kiko/currency/decimal';
import DateField from '@kiko/screens/forms/date-field';
import { sharePriceOf } from '@kiko/prices/share-price';
import { useLiveQuery, type HoldingRow } from '@kiko/db';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { holdingInstrument } from '@kiko/prices/instrument';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { groupAmount } from '@kiko/screens/forms/amount-format';
import { pricePointsRepo } from '@kiko/prices/price-points-repo';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { type FC, useLayoutEffect, useRef, useState } from 'react';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { type Currency, currencyScale, currencySymbol } from '@kiko/currency/currency';

type PricePointFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'PricePointForm'>;

// Local midnight of today, matching DateField's own reported timestamp for a
// picked day — the sensible default ("value as of today"). Mirrors
// contribution-form's identical helper.
const startOfToday = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

type PricePointKind = 'debt' | 'share' | 'value';

// Every string reads for what the holding is, so no wording still says
// "Value" once the holding loads as a debt or a share. A `null` title keeps
// the stack's own "Update Value".
const pricePointCopy = {
  debt: {
    title: 'forms.pricePoint.loanTitle',
    field: 'forms.pricePoint.loanValue',
    save: 'forms.pricePoint.loanSave',
    error: 'forms.pricePoint.loanValueError',
  },
  share: {
    title: 'forms.pricePoint.shareTitle',
    field: 'forms.pricePoint.pricePerShare',
    save: 'forms.pricePoint.shareSave',
    error: 'forms.pricePoint.pricePerShareError',
  },
  value: {
    title: null,
    field: 'forms.pricePoint.value',
    save: 'forms.pricePoint.save',
    error: 'forms.pricePoint.valueError',
  },
} as const;

const pricePointKinds: Record<HoldingType, PricePointKind> = {
  card: 'value',
  term_deposit: 'value',
  bond: 'value',
  cash: 'value',
  crypto_asset: 'value',
  jar: 'value',
  property_item: 'value',
  metal: 'value',
  loan: 'debt',
  share: 'share',
};

// A stored `type` is not checked by SQLite, so an unknown one reads as a value.
const pricePointKindOf = (holding: Pick<HoldingRow, 'type'> | undefined): PricePointKind =>
  foldMap(maybe(holding), ({ type }) => pricePointKinds[type]) ?? 'value';

const minorUnitPriceOf = (majorValue: number, currency: Currency): string =>
  shiftDecimal(String(Money.fromMajor(currency, majorValue).minorUnits), -currencyScale[currency]);

// A value or an outstanding is a money total, kept at the currency's minor
// unit; a price per share keeps the places it is quoted in. Only a debt may
// reach exactly 0 (repaid). Undefined when the typed value cannot be saved.
const pricePointPriceOf = (
  kind: PricePointKind,
  value: string,
  currency: Currency,
): string | undefined => {
  const majorValue = parseAmount(value);

  return match(kind)
    .with('share', () => sharePriceOf(value))
    .with('debt', () => (majorValue >= 0 ? minorUnitPriceOf(majorValue, currency) : undefined))
    .with('value', () => (majorValue > 0 ? minorUnitPriceOf(majorValue, currency) : undefined))
    .exhaustive();
};

// Records a new `manual` price point for a priced holding (property_item,
// metal, a manual share), reached from holding-detail's "Update value"
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
  // series through this SAME form.
  const kind = pricePointKindOf(holding);
  const copy = pricePointCopy[kind];

  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [date, setDate] = useState<number>(startOfToday);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const price = pricePointPriceOf(kind, value, currency);

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
    if (copy.title !== null) {
      navigation.setOptions({ title: t(copy.title) });
    }
  }, [copy.title, navigation, t]);

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }

    if (price === undefined) {
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        valueFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => valueInputRef.current?.focus(),
      );

      return;
    }
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
          {t(copy.save)}
        </Button>
      }
    >
      <Box gap={4}>
        <View ref={valueFieldRef}>
          <TextField
            label={t(copy.field)}
            value={value}
            onChangeText={(text) => setValue(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.pricePoint.valuePlaceholder')}
            suffix={currencySymbol[currency]}
            required
            error={attemptedSave && price === undefined ? t(copy.error) : undefined}
            inputRef={valueInputRef}
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

export default PricePointFormScreen;
