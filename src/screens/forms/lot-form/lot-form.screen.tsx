import {
  asLots,
  changedLots,
  hasNegativeHolding,
  type Lot,
  type LotChange,
} from '@kiko/holdings/lots';
import { useLiveQuery } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { isRecord } from '@kiko/type-guards';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '@kiko/design-system/scroll-to-field';
import { useTranslation } from 'react-i18next';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import Box from '@kiko/design-system/components/box';
import DateField from '@kiko/screens/forms/date-field';
import Button from '@kiko/design-system/components/button';
import Screen from '@kiko/design-system/components/screen';
import { asMetalMeta } from '@kiko/holdings/holding-metadata';
import { alertOnCatch } from '@kiko/design-system/alert-on-catch';
import TextField from '@kiko/design-system/components/text-field';
import { refreshMarketData } from '@kiko/sync/refresh-market-data';
import { useSubmitOnce } from '@kiko/design-system/use-submit-once';
import FieldLabel from '@kiko/design-system/components/field-label';
import type { AccountsStackParamList } from '@kiko/navigation/types';
import { metalUnitSuffix } from '@kiko/screens/forms/metal-unit-suffix';
import { type Currency, currencySymbol } from '@kiko/currency/currency';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { compareDecimal, normalizeDecimal } from '@kiko/currency/decimal';
import { dayKeyOf, localMidnightOfDayKey } from '@kiko/prices/price-book';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { type FC, useEffect, useLayoutEffect, useRef, useState } from 'react';
import SegmentedControl from '@kiko/design-system/components/segmented-control';
import { groupAmount, majorAmountText } from '@kiko/screens/forms/amount-format';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';

type LotFormScreenProps = NativeStackScreenProps<AccountsStackParamList, 'LotForm'>;

type LotDirection = 'buy' | 'sell';

const directions: readonly LotDirection[] = ['buy', 'sell'];

// Local midnight of today, matching the timestamp DateField itself reports for
// a picked day — the sensible default ("dated today"), same as
// contribution-form/price-point-form's own identical helper.
const startOfToday = (): number => {
  const now = new Date();

  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const isSale = (lot: Lot): boolean => compareDecimal(lot.quantityDelta, '0') < 0;

type QuantityErrorKey =
  | 'forms.lot.quantityError'
  | 'forms.lot.sellExceedsError'
  | 'forms.lot.coversLaterSaleError';

// A plain quantity error takes priority over an overdrawn one, since a
// completely invalid quantity is the more fundamental problem. A sell that
// takes too much and a buy a later sale still needs are told apart.
const quantityErrorFor = (params: {
  attemptedSave: boolean;
  quantityValid: boolean;
  overdrawn: boolean;
  direction: LotDirection;
  t: (key: QuantityErrorKey) => string;
}): string | undefined => {
  const { attemptedSave, quantityValid, overdrawn, direction, t } = params;

  if (!attemptedSave) {
    return undefined;
  }

  if (!quantityValid) {
    return t('forms.lot.quantityError');
  }

  if (!overdrawn) {
    return undefined;
  }

  return direction === 'sell'
    ? t('forms.lot.sellExceedsError')
    : t('forms.lot.coversLaterSaleError');
};

type LotFields = {
  direction: LotDirection;
  quantity: string;
  costText: string;
  currency: Currency;
  date: number;
};

// A sell carries no cost of its own: `withLotChange` works it out from the
// lots before it, at average cost.
const lotOf = ({ direction, quantity, costText, currency, date }: LotFields): Lot =>
  direction === 'buy'
    ? {
        day: dayKeyOf(date),
        quantityDelta: quantity,
        costMinorUnits: Money.fromMajor(currency, parseAmount(costText) || 0).minorUnits,
      }
    : { day: dayKeyOf(date), quantityDelta: `-${quantity}`, costMinorUnits: 0 };

const changeOf = (lotIndex: number | undefined, fields: LotFields): LotChange =>
  foldMap(maybe(lotIndex), (index): LotChange => ({ kind: 'edit', index, lot: lotOf(fields) })) ?? {
    kind: 'add',
    lot: lotOf(fields),
  };

// Records one buy or sell lot against a lot-form-eligible holding (`metal` —
// kiko-pricing), reached from holding-detail's "Add lot" footer
// action, or edits one stored lot (`lotIndex`), reached from that lot row's
// long-press menu. It never writes a `price_points` or `Transaction` row:
// the holding is ledgerless (`isLedgerlessHoldingType`), so its quantity and
// cost basis derive entirely from its lots, which `holdingsRepo.changeLots`
// rewrites from the row stored at the time of the write.
const LotFormScreen: FC<LotFormScreenProps> = ({ route, navigation }) => {
  const { holdingId, lotIndex } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // and existing lots come from filtering the full holdings list — the same
  // approach the sibling forms use.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const rawMetadata: Record<string, unknown> = isRecord(holding?.metadata) ? holding.metadata : {};
  const existingLots: Lot[] = asLots(rawMetadata.lots) ?? [];
  const editedLot = foldMap(maybe(lotIndex), (index) => existingLots.at(index));

  const { t } = useTranslation();
  // A metal's quantity is in its own stored unit (g or oz); any other holding's
  // quantity has no unit to show.
  const quantitySuffix = foldMap(maybe(asMetalMeta(holding?.metadata)), (meta) =>
    metalUnitSuffix(t, meta.unit),
  );
  const [direction, setDirection] = useState<LotDirection>('buy');
  const [quantityText, setQuantityText] = useState('');
  const [costText, setCostText] = useState('');
  const [date, setDate] = useState<number>(startOfToday);
  const [attemptedSave, setAttemptedSave] = useState(false);

  const scrollableRef = useAnimatedRef<ScrollViewInstance>();
  const scrollOffset = useScrollOffset(scrollableRef);
  const quantityFieldRef = useRef<FieldInstance>(null);
  const quantityInputRef = useRef<TextInputInstance>(null);
  const costFieldRef = useRef<FieldInstance>(null);
  const costInputRef = useRef<TextInputInstance>(null);
  const headerInset = useHeaderInset();
  const contentHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (lotIndex !== undefined) {
      navigation.setOptions({ title: t('forms.lot.editTitle') });
    }
  }, [lotIndex, navigation, t]);

  // Seeded once: a later live-query emission must not clobber what the user typed.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || editedLot === undefined) {
      return;
    }
    hydrated.current = true;
    const sale = isSale(editedLot);
    setDirection(sale ? 'sell' : 'buy');
    setQuantityText(groupAmount(editedLot.quantityDelta.replace('-', '')));
    setCostText(sale ? '' : groupAmount(majorAmountText(currency, editedLot.costMinorUnits)));
    setDate(localMidnightOfDayKey(editedLot.day));
  }, [editedLot, currency]);

  const quantity = normalizeDecimal(quantityText);
  const quantityValid = quantity !== null && compareDecimal(quantity, '0') > 0;
  // An edit applies only once the lot it names is loaded.
  const canApply = lotIndex === undefined || editedLot !== undefined;
  const change =
    quantityValid && canApply
      ? changeOf(lotIndex, { direction, quantity, costText, currency, date })
      : null;
  // Checked over every lot, not only on the picked day: a backdated sell, or a
  // buy cut below what a later sale took, must leave every sale covered by
  // what is held before it.
  const overdrawn = change !== null && hasNegativeHolding(changedLots(existingLots, change));
  const quantityErrorMessage = quantityErrorFor({
    attemptedSave,
    quantityValid,
    overdrawn,
    direction,
    t,
  });
  // A lot received at no cost reads 0, so 0 is a valid total cost.
  const costValid = parseAmount(costText) >= 0;

  const save = async (): Promise<void> => {
    if (!holding || !canApply) {
      return;
    }

    if (change === null || overdrawn) {
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        quantityFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => quantityInputRef.current?.focus(),
      );

      return;
    }

    if (direction === 'buy' && !costValid) {
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        costFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => costInputRef.current?.focus(),
      );

      return;
    }

    try {
      await holdingsRepo.changeLots(holding.id, change);
    } catch {
      // The SAME shared save-error Alert every other form's write failure
      // uses (account-form, holding-form, price-point-form, transaction-form)
      // — a write failure keeps the screen open with the entered values intact.
      alertOnCatch(t, 'forms.fields.saveErrorTitle', 'forms.fields.saveErrorMessage');

      return;
    }

    // A new or re-dated lot can fall before the stored prices, so its history
    // is asked for now, not at the next pull or cold launch.
    // biome-ignore lint/nursery/noFloatingPromises: OVERRIDE(total function) never rejects
    refreshMarketData({ throttled: false, metals: true });
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
          {t('forms.lot.save')}
        </Button>
      }
    >
      <Box gap={4}>
        <Box gap={1}>
          <FieldLabel label={t('forms.lot.type')} />
          {/* Buy/Sell shows/hides the Total cost field below
              (`direction === 'buy'`), so — unlike a value selection that
              leaves the form the same — this is a mode toggle and takes
              `SegmentedControl`, not a chip row. */}
          <SegmentedControl<LotDirection>
            options={directions}
            selected={direction}
            onSelect={setDirection}
            labels={{ buy: t('forms.lot.buy'), sell: t('forms.lot.sell') }}
            accessibilityLabel={t('forms.lot.type')}
          />
        </Box>

        <View ref={quantityFieldRef}>
          <TextField
            label={t('forms.lot.quantity')}
            value={quantityText}
            onChangeText={(text) => setQuantityText(groupAmount(text))}
            keyboardType="decimal-pad"
            placeholder={t('forms.lot.quantityPlaceholder')}
            suffix={quantitySuffix}
            required
            error={quantityErrorMessage}
            inputRef={quantityInputRef}
          />
        </View>

        {direction === 'buy' && (
          <View ref={costFieldRef}>
            <TextField
              label={t('forms.lot.totalCost')}
              value={costText}
              onChangeText={(text) => setCostText(groupAmount(text))}
              keyboardType="decimal-pad"
              placeholder={t('forms.lot.totalCostPlaceholder')}
              suffix={currencySymbol[currency]}
              required
              error={
                attemptedSave && !costValid ? t('forms.lot.totalCostRequiredError') : undefined
              }
              inputRef={costInputRef}
            />
          </View>
        )}

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

export default LotFormScreen;
