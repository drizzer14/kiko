import { seedCounterpartMinorUnits } from './exchange-prefill';

describe('seedCounterpartMinorUnits', () => {
  it('seeds 1:1 (magnitude) when the source and counterpart currencies match', () => {
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -500_00,
      sourceCurrency: 'UAH',
      counterpartCurrency: 'UAH',
      rateTable: {},
    });

    expect(seeded).toBe(500_00);
  });

  it('converts the withdrawal magnitude via the cached cross-rate', () => {
    // 20.00 USD withdrawn, USD:UAH = 41.5 → 830.00 UAH counterpart.
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'UAH',
      rateTable: { 'USD:UAH': 41.5 },
    });

    expect(seeded).toBe(830_00);
  });

  it('returns null when no cached rate exists for the cross pair (leave the field blank)', () => {
    const seeded = seedCounterpartMinorUnits({
      sourceAmountMinorUnits: -20_00,
      sourceCurrency: 'USD',
      counterpartCurrency: 'EUR',
      rateTable: { 'USD:UAH': 41.5 },
    });

    expect(seeded).toBeNull();
  });
});
