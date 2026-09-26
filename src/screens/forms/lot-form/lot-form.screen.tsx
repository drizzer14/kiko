import {
  compareDecimal,
  multiplyToMinorUnits,
  normalizeDecimal,
  shiftDecimal,
} from '@kiko/currency/decimal';
import { useLiveQuery } from '@kiko/db';
import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { useTranslation } from 'react-i18next';
import { type FC, useRef, useState } from 'react';
import { holdingsRepo } from '@kiko/holdings/repo';
import { parseAmount } from '@kiko/currency/parse';
import { dayKeyOf } from '@kiko/prices/price-book';
import { asMetalMeta } from '@kiko/holdings/holding-metadata';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { View, type ScrollViewInstance, type TextInputInstance } from 'react-native';
import { asLots, costBasisMinorAt, quantityAt, type Lot } from '@kiko/holdings/lots';
import { type Currency, currencyScale, currencySymbol } from '@kiko/currency/currency';

import DateField from '../date-field';
import { metalUnitSuffix } from '../metal-unit-suffix';
import Box from '../../../design-system/components/box';
import { groupAmount } from '../amount-format/amount-format';
import Button from '../../../design-system/components/button';
import Screen from '../../../design-system/components/screen';
import {
  useHeaderInset,
  scrollToField,
  type FieldInstance,
} from '../../../design-system/scroll-to-field/scroll-to-field';
import { alertOnCatch } from '../../../design-system/alert-on-catch';
import TextField from '../../../design-system/components/text-field';
import FieldLabel from '../../../design-system/components/field-label';
import type { AccountsStackParamList } from '../../../navigation/types';
import SegmentedControl from '../../../design-system/components/segmented-control';
import { useSubmitOnce } from '../../../design-system/use-submit-once/use-submit-once';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The quantity field's active error message, or `undefined` while valid (or
// before the first failed Save press) — a plain quantity error takes
// priority over the Review-Focus-8 sell-exceeds error, since a completely
// invalid quantity is the more fundamental problem. Kept as a module-level
// helper (rather than a nested ternary inline) per the project's
// `noNestedTernary` lint rule.
const quantityErrorFor = (params: {
  attemptedSave: boolean;
  quantityValid: boolean;
  sellExceeds: boolean;
  t: (key: 'forms.lot.quantityError' | 'forms.lot.sellExceedsError') => string;
}): string | undefined => {
  const { attemptedSave, quantityValid, sellExceeds, t } = params;

  if (!attemptedSave) {
    return undefined;
  }

  if (!quantityValid) {
    return t('forms.lot.quantityError');
  }

  return sellExceeds ? t('forms.lot.sellExceedsError') : undefined;
};

// Records one buy or sell lot against a lot-form-eligible holding (`metal` —
// kiko-pricing), reached from holding-detail's "Add lot" footer action.
// Unlike ContributionForm/PricePointForm it never writes a `price_points`
// row: a metal's price comes from the SHARED `metal:<XAU|...>` instrument,
// not a per-holding series —
// this screen only appends to the holding's own `metadata.lots` array
// through `holdingsRepo.update`. No `Transaction` row is ever written, for
// either direction: the holding is ledgerless
// (`isLedgerlessHoldingType`), so its value derives entirely from its lots,
// never from a manual ledger.
const LotFormScreen: FC<LotFormScreenProps> = ({ route, navigation }) => {
  const { holdingId } = route.params;
  // `holdingsRepo` exposes no single-row lookup, so the holding's own currency
  // and existing lots come from filtering the full holdings list — the same
  // approach the sibling forms use.
  const { data: holdings } = useLiveQuery(holdingsRepo.allQuery(), ['holdings']);
  const holding = holdings.find((candidate) => candidate.id === holdingId);
  const currency: Currency = holding?.currency ?? 'UAH';
  const rawMetadata: Record<string, unknown> = isRecord(holding?.metadata) ? holding.metadata : {};
  const existingLots: Lot[] = asLots(rawMetadata.lots) ?? [];

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

  const quantity = normalizeDecimal(quantityText);
  const quantityValid = quantity !== null && compareDecimal(quantity, '0') > 0;
  // The quantity currently held as of the picked day, from the holding's own
  // lots — a sell delta larger than this is rejected, never
  // written, and `quantityAt` itself never returns below "0".
  const heldQuantity = quantityAt(existingLots, date);
  const sellExceeds =
    direction === 'sell' && quantityValid && compareDecimal(quantity, heldQuantity) > 0;
  const quantityErrorMessage = quantityErrorFor({ attemptedSave, quantityValid, sellExceeds, t });
  const costValid = parseAmount(costText) > 0;

  const save = async (): Promise<void> => {
    if (!holding) {
      return;
    }

    if (!quantityValid || sellExceeds) {
      setAttemptedSave(true);
      scrollToField(
        scrollableRef,
        quantityFieldRef,
        { currentOffset: scrollOffset.value, headerInset, contentHeight: contentHeightRef.current },
        () => quantityInputRef.current?.focus(),
      );

      return;
    }

    let lot: Lot;

    if (direction === 'buy') {
      if (!costValid) {
        setAttemptedSave(true);
        scrollToField(
          scrollableRef,
          costFieldRef,
          {
            currentOffset: scrollOffset.value,
            headerInset,
            contentHeight: contentHeightRef.current,
          },
          () => costInputRef.current?.focus(),
        );

        return;
      }
      lot = {
        day: dayKeyOf(date),
        quantityDelta: quantity,
        costMinorUnits: Money.fromMajor(currency, parseAmount(costText)).minorUnits,
      };
    } else {
      // The cost basis removed by this sale, proportional to the share of the
      // currently-held quantity being sold — e.g. selling half the held
      // quantity removes half the stored cost basis. `costBasisMinorAt`
      // returns an INTEGER minor-units amount, so it is expanded back to a
      // major decimal string first (`shiftDecimal`) before going through
      // `multiplyToMinorUnits`'s BigInt-backed multiply/divide (the same
      // major-decimal-in, minor-units-out contract every other price/quantity
      // multiplication in the app follows) — feeding it a bare minor-units
      // integer would double-apply the currency's scale. Stored NEGATIVE,
      // mirroring `quantityDelta`'s own sign on a sale (lots.ts's documented
      // contract).
      const costBasisBeforeMajor = shiftDecimal(
        String(costBasisMinorAt(existingLots, date)),
        -currencyScale[currency],
      );
      const costRemovedMinor = multiplyToMinorUnits(
        [costBasisBeforeMajor, quantity],
        currency,
        heldQuantity,
      );
      lot = {
        day: dayKeyOf(date),
        quantityDelta: `-${quantity}`,
        costMinorUnits: -costRemovedMinor,
      };
    }

    try {
      await holdingsRepo.update(holding.id, {
        metadata: { ...rawMetadata, lots: [...existingLots, lot] },
      });
    } catch {
      // The SAME shared save-error Alert every other form's write failure
      // uses (account-form, holding-form, price-point-form, transaction-form)
      // — a write failure keeps the screen open with the entered values intact.
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
              error={attemptedSave && !costValid ? t('forms.lot.totalCostError') : undefined}
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
