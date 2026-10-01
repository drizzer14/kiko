import {
  addDecimal,
  compareDecimal,
  multiplyToMinorUnits,
  shiftDecimal,
} from '@kiko/currency/decimal';
import { match } from 'ts-pattern';
import { currencyScale, type Currency } from '@kiko/currency/currency';

import type { Lot } from './lots';

/**
 * One change to a holding's lots. `index` is the lot's position in the stored
 * array. A sell's `costMinorUnits` is ignored: it is always worked out again.
 */
export type LotChange =
  | { kind: 'add'; lot: Lot }
  | { kind: 'edit'; index: number; lot: Lot }
  | { kind: 'remove'; index: number };

const isSale = (lot: Lot): boolean => compareDecimal(lot.quantityDelta, '0') < 0;

const assertLotAt = (lots: readonly Lot[], index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= lots.length) {
    throw new Error(`withLotChange: no lot at index ${index}`);
  }
};

const appliedChange = (lots: readonly Lot[], change: LotChange): Lot[] =>
  match(change)
    .with({ kind: 'add' }, ({ lot }) => [...lots, lot])
    .with({ kind: 'edit' }, ({ index, lot }) => {
      assertLotAt(lots, index);

      return lots.map((stored, position) => (position === index ? lot : stored));
    })
    .with({ kind: 'remove' }, ({ index }) => {
      assertLotAt(lots, index);

      return lots.filter((_stored, position) => position !== index);
    })
    .exhaustive();

// A sell removes the average cost of what is held before it, so every sell is
// worked out again in day order whenever any lot changes: a backdated or
// edited buy moves the average of every later sell. Lots of one day keep the
// order they were recorded in, so a list recorded in day order keeps every
// stored sell cost.
const recostedSales = (lots: readonly Lot[], currency: Currency): Lot[] => {
  const recosted = [...lots];
  const ordered = lots
    .map((lot, index) => ({ lot, index }))
    .sort((first, second) => first.lot.day - second.lot.day || first.index - second.index);
  let heldQuantity = '0';
  let costBasisMinorUnits = 0;

  for (const { lot, index } of ordered) {
    const costMinorUnits =
      isSale(lot) && compareDecimal(heldQuantity, '0') > 0
        ? multiplyToMinorUnits(
            [
              shiftDecimal(String(costBasisMinorUnits), -currencyScale[currency]),
              lot.quantityDelta,
            ],
            currency,
            heldQuantity,
          )
        : lot.costMinorUnits;

    recosted[index] = { ...lot, costMinorUnits };
    heldQuantity = addDecimal(heldQuantity, lot.quantityDelta);
    costBasisMinorUnits += costMinorUnits;
  }

  return recosted;
};

/** The lots after `change`, with every sell's cost worked out again. */
export const withLotChange = (lots: readonly Lot[], change: LotChange, currency: Currency): Lot[] =>
  recostedSales(appliedChange(lots, change), currency);

/** Whether any day holds less than zero once its own lots are counted. */
export const hasNegativeHolding = (lots: readonly Lot[]): boolean => {
  const days = [...new Set(lots.map((lot) => lot.day))].sort((first, second) => first - second);
  let heldQuantity = '0';

  return days.some((day) => {
    heldQuantity = lots
      .filter((lot) => lot.day === day)
      .reduce((sum, lot) => addDecimal(sum, lot.quantityDelta), heldQuantity);

    return compareDecimal(heldQuantity, '0') < 0;
  });
};
