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

/** A change would leave a sale more than the lots before it hold. */
export class SaleExceedsHoldingError extends Error {
  constructor() {
    super('withLotChange: a sale would take more than is held');
    this.name = 'SaleExceedsHoldingError';
    // A Babel/Hermes-transpiled `extends Error` loses the prototype link that
    // `instanceof` relies on unless it is restored explicitly.
    Object.setPrototypeOf(this, SaleExceedsHoldingError.prototype);
  }
}

const isSale = (lot: Lot): boolean => compareDecimal(lot.quantityDelta, '0') < 0;

// The one order every walk over the lots takes, so the check that refuses a
// change and the cost of each sale never disagree: by day, a day's buys
// before its sells, then the order they were recorded in. A buy recorded
// after a sale of the same day still covers that sale.
const inLotOrder = (lots: readonly Lot[]): { lot: Lot; index: number }[] =>
  lots
    .map((lot, index) => ({ lot, index }))
    .sort(
      (first, second) =>
        first.lot.day - second.lot.day ||
        Number(isSale(first.lot)) - Number(isSale(second.lot)) ||
        first.index - second.index,
    );

const assertLotAt = (lots: readonly Lot[], index: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= lots.length) {
    throw new Error(`withLotChange: no lot at index ${index}`);
  }
};

/** The lots after `change`, every stored sell cost as it was. */
export const changedLots = (lots: readonly Lot[], change: LotChange): Lot[] =>
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
// worked out again whenever any lot changes: a backdated or edited buy moves
// the average of every later sell. A sale is refused rather than costed from
// less than it takes, so no stored cost survives a change unchecked.
const recostedSales = (lots: readonly Lot[], currency: Currency): Lot[] => {
  const recosted = [...lots];
  let heldQuantity = '0';
  let costBasisMinorUnits = 0;

  for (const { lot, index } of inLotOrder(lots)) {
    const heldAfter = addDecimal(heldQuantity, lot.quantityDelta);

    if (compareDecimal(heldAfter, '0') < 0) {
      throw new SaleExceedsHoldingError();
    }

    const costMinorUnits = isSale(lot)
      ? multiplyToMinorUnits(
          [shiftDecimal(String(costBasisMinorUnits), -currencyScale[currency]), lot.quantityDelta],
          currency,
          heldQuantity,
        )
      : lot.costMinorUnits;

    recosted[index] = { ...lot, costMinorUnits };
    heldQuantity = heldAfter;
    costBasisMinorUnits += costMinorUnits;
  }

  return recosted;
};

/**
 * The lots after `change`, with every sell's cost worked out again. Throws
 * `SaleExceedsHoldingError` when a sale would take more than is held before it.
 */
export const withLotChange = (lots: readonly Lot[], change: LotChange, currency: Currency): Lot[] =>
  recostedSales(changedLots(lots, change), currency);

/** Whether a sale takes more than is held before it, in `withLotChange`'s own order. */
export const hasNegativeHolding = (lots: readonly Lot[]): boolean => {
  let heldQuantity = '0';

  return inLotOrder(lots).some(({ lot }) => {
    heldQuantity = addDecimal(heldQuantity, lot.quantityDelta);

    return compareDecimal(heldQuantity, '0') < 0;
  });
};
