import { canConvert } from '../net-worth-view';
import { currencyOptions, isFiat } from '../../currency/currency';

import { FIAT_RATE_SEED_TABLE, FIAT_UAH_PRICE_SEED } from './fiat-rate-seed';

describe('FIAT_UAH_PRICE_SEED', () => {
  it('has a positive price for every fiat currency in currencyOptions (full coverage)', () => {
    for (const currency of currencyOptions) {
      if (!isFiat(currency)) {
        continue;
      }

      expect(FIAT_UAH_PRICE_SEED[currency]).toBeGreaterThan(0);
    }
  });

  it('has no entry for a crypto currency — this seed is fiat-only', () => {
    expect(FIAT_UAH_PRICE_SEED.BTC).toBeUndefined();
    expect(FIAT_UAH_PRICE_SEED.ETH).toBeUndefined();
    expect(FIAT_UAH_PRICE_SEED.USDT).toBeUndefined();
  });
});

describe('FIAT_RATE_SEED_TABLE', () => {
  it('composes a convertible UAH pair for every fiat currency (via canConvert)', () => {
    for (const currency of currencyOptions) {
      if (!isFiat(currency) || currency === 'UAH') {
        continue;
      }

      expect(canConvert(currency, 'UAH', FIAT_RATE_SEED_TABLE)).toBe(true);
    }
  });

  it('composes a convertible cross pair between two non-UAH fiat currencies', () => {
    expect(canConvert('EUR', 'USD', FIAT_RATE_SEED_TABLE)).toBe(true);
    expect(canConvert('GBP', 'PLN', FIAT_RATE_SEED_TABLE)).toBe(true);
  });

  it('never composes a pair a currency against itself', () => {
    expect(FIAT_RATE_SEED_TABLE['USD:USD']).toBeUndefined();
  });
});
