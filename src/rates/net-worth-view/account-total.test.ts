import type { Currency } from '@kiko/currency/currency';

import { accountTotal } from './account-total';
import { guardedNetWorth } from './net-worth-view';

const NOW = Date.UTC(2026, 0, 1);

const cash = (currency: Currency, balanceMinorUnits: number, id = `cash-${currency}`) => ({
  id,
  currency,
  balanceMinorUnits,
  type: 'cash' as const,
  metadata: null,
});

const rates = { USD: 40 };

describe('accountTotal', () => {
  it('shows no base caption when the account currency is the base currency', () => {
    const { total, inBase } = accountTotal(
      [cash('UAH', 100_000), cash('USD', 5_000)],
      'UAH',
      'UAH',
      rates,
      NOW,
    );

    expect(total).toMatchObject({ currency: 'UAH', minorUnits: 300_000 });
    expect(inBase).toBeNull();
  });

  it('totals a foreign-currency account in its own currency with the base figure beside it', () => {
    const holdings = [cash('USD', 10_000)];
    const { total, inBase } = accountTotal(holdings, 'USD', 'UAH', rates, NOW);

    expect(total).toMatchObject({ currency: 'USD', minorUnits: 10_000 });
    expect(inBase).toEqual(guardedNetWorth(holdings, 'UAH', rates, NOW));
    expect(inBase).toMatchObject({ currency: 'UAH', minorUnits: 400_000 });
  });

  it('converts mixed holdings into the account currency and the base currency', () => {
    const holdings = [cash('USD', 10_000), cash('UAH', 40_000)];
    const { total, inBase } = accountTotal(holdings, 'USD', 'UAH', rates, NOW);

    expect(total).toMatchObject({ currency: 'USD', minorUnits: 11_000 });
    expect(inBase).toMatchObject({ currency: 'UAH', minorUnits: 440_000 });
  });

  it('shows a crypto account its own sum with no caption and no throw when it has no rate', () => {
    const { total, inBase } = accountTotal(
      [cash('BTC', 50_000_000, 'btc')],
      'BTC',
      'UAH',
      rates,
      NOW,
    );

    expect(total).toMatchObject({ currency: 'BTC', minorUnits: 50_000_000 });
    expect(inBase).toBeNull();
  });

  it('leaves out a holding with no rate to a crypto account currency', () => {
    const { total, inBase } = accountTotal(
      [cash('BTC', 50_000_000, 'btc'), cash('UAH', 10_000)],
      'BTC',
      'UAH',
      rates,
      NOW,
    );

    expect(total).toMatchObject({ currency: 'BTC', minorUnits: 50_000_000 });
    expect(inBase).toBeNull();
  });

  it('totals an empty account as zero in its currency with no caption', () => {
    const { total, inBase } = accountTotal([], 'USD', 'UAH', rates, NOW);

    expect(total).toMatchObject({ currency: 'USD', minorUnits: 0 });
    expect(inBase).toEqual(expect.objectContaining({ currency: 'UAH', minorUnits: 0 }));
  });

  it('shows no caption for an empty account in the base currency', () => {
    const { total, inBase } = accountTotal([], 'UAH', 'UAH', rates, NOW);

    expect(total).toMatchObject({ currency: 'UAH', minorUnits: 0 });
    expect(inBase).toBeNull();
  });
});
