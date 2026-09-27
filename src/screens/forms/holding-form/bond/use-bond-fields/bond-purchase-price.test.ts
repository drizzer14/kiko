import {
  bondPurchaseTotal,
  pricePerBondText,
  type SeededPurchasePrice,
} from './bond-purchase-price';

const totalOf = (
  quantity: string,
  pricePerBond: string,
  seeded: SeededPurchasePrice | null = null,
): number | undefined => bondPurchaseTotal({ quantity, pricePerBond, currency: 'UAH', seeded });

describe('bondPurchaseTotal', () => {
  it('stores the price of one bond times the quantity, exactly', () => {
    expect(totalOf('98', '1 076,72')).toBe(10_551_856);
  });

  it('stores no total for a blank or zero price', () => {
    expect(totalOf('98', '')).toBeUndefined();
    expect(totalOf('98', '0')).toBeUndefined();
  });

  it('stores no total without a quantity', () => {
    expect(totalOf('', '1 000')).toBeUndefined();
  });

  // 10 000.00 over 3 bonds seeds 3 333.33 per bond, which times 3 is 9 999.99.
  const seeded = { quantity: '3', pricePerBond: '3 333.33', totalMinorUnits: 1_000_000 };

  it('keeps a stored total the edit left untouched, even when it does not divide by the quantity', () => {
    expect(totalOf('3', '3 333.33', seeded)).toBe(1_000_000);
  });

  it('recomputes the total once the price or the quantity changed', () => {
    expect(totalOf('4', '3 333.33', seeded)).toBe(1_333_332);
    expect(totalOf('3', '3 000', seeded)).toBe(900_000);
  });
});

describe('pricePerBondText', () => {
  it('shows the price of one bond for a stored batch total', () => {
    expect(pricePerBondText(10_551_856, 98, 'UAH')).toBe('1 076.72');
  });

  it('rounds a total that does not divide by the quantity to the minor unit', () => {
    expect(pricePerBondText(1_000_000, 3, 'UAH')).toBe('3 333.33');
  });

  it('shows no price without a quantity', () => {
    expect(pricePerBondText(1_000_000, 0, 'UAH')).toBe('');
  });
});
