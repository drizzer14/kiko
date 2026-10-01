import { match } from 'ts-pattern';
import type { TFunction } from 'i18next';
import type { Lot } from '@kiko/holdings/lots';
import { compareDecimal } from '@kiko/currency/decimal';
import type { DerivedEntry, DerivedEntryKind, EntryTone } from '@kiko/holdings/derived-entries';

// The ledger tone a derived entry reads in: withholding lines are `negative`
// (red), interest/coupon accruals are `positive` (green), and the principal
// movements (a deposit contribution, a bond purchase/redemption) stay `neutral`
// so only genuine gains and taxes carry color. Classified by KIND, not by the
// sign of the amount, so an entry always reads the same regardless of sign.
const toneForKind = (kind: DerivedEntryKind): EntryTone =>
  match(kind)
    .with('income-tax', 'military-levy', 'tax', (): EntryTone => 'negative')
    .with('accrual', 'interest', 'capitalization', 'coupon', (): EntryTone => 'positive')
    .with('contribution', 'purchase', 'redemption', 'sale', (): EntryTone => 'neutral')
    .exhaustive();

export const makeEntry = (
  holdingId: string,
  kind: DerivedEntryKind,
  index: number,
  time: number,
  amountMinorUnits: number,
  label: string,
  now: number,
): DerivedEntry => ({
  id: `derived:${holdingId}:${kind}:${index}`,
  time,
  amountMinorUnits,
  label,
  kind,
  tone: toneForKind(kind),
  isFuture: time > now,
  derived: true,
});

// A lot-held holding's buy/sell history as ledger rows: a buy lot (positive
// `quantityDelta`) reads as a 'purchase', a sell lot as a 'sale'. Both
// amounts are the NEGATION of the lot's own `costMinorUnits`: `lots.ts`
// stores a buy's cost positive (money paid) and a sell's negative (cost basis
// removed), so one negation gives the money-out/money-in sign the bond
// purchase/redemption entries already use.
export const lotEntries = (
  lots: readonly Lot[],
  holdingId: string,
  now: number,
  t: TFunction,
): DerivedEntry[] =>
  lots.map((lot, index) => {
    const isSale = compareDecimal(lot.quantityDelta, '0') < 0;

    return {
      ...makeEntry(
        holdingId,
        isSale ? 'sale' : 'purchase',
        index,
        lot.day,
        -lot.costMinorUnits,
        isSale ? t('holdingDetail.sale') : t('holdingDetail.purchase'),
        now,
      ),
      lotIndex: index,
    };
  });
