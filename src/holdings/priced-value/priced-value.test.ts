import { needsPriceBook } from './priced-value';

describe('needsPriceBook', () => {
  it('is true for property_item, metal, and share (each carries a non-null priced spec)', () => {
    expect(needsPriceBook('property_item')).toBe(true);
    expect(needsPriceBook('metal')).toBe(true);
    expect(needsPriceBook('share')).toBe(true);
  });

  // loan is NOT a priced type (priced: null) but reads its own holding:<id>
  // manual-correction series through the SAME price_points table
  // (kiko-pricing) — an explicit exception, not a pattern gap.
  it('is true for loan, though it is not itself a priced type', () => {
    expect(needsPriceBook('loan')).toBe(true);
  });

  it('is false for every ledger-backed type', () => {
    for (const type of ['card', 'cash', 'crypto_asset', 'jar', 'term_deposit', 'bond'] as const) {
      expect(needsPriceBook(type)).toBe(false);
    }
  });
});
