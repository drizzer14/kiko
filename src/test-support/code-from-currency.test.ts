import { currencyFromCode } from '@kiko/monobank/currency-code';
import { currencyOptions, isCrypto } from '@kiko/currency/currency';

import { codeFromCurrency } from './code-from-currency';

describe('codeFromCurrency', () => {
  it('maps currencies back to codes', () => {
    expect(codeFromCurrency('UAH')).toBe(980);
    expect(codeFromCurrency('GBP')).toBe(826);
    expect(codeFromCurrency('CHF')).toBe(756);
    expect(codeFromCurrency('JPY')).toBe(392);
    expect(codeFromCurrency('PLN')).toBe(985);
  });

  it('gives crypto currencies no ISO numeric code (BTC/ETH/USDT are not Monobank fiats)', () => {
    expect(codeFromCurrency('BTC')).toBeUndefined();
    expect(codeFromCurrency('ETH')).toBeUndefined();
    expect(codeFromCurrency('USDT')).toBeUndefined();
  });

  it('gives every fiat currency a code that maps back to it', () => {
    for (const currency of currencyOptions) {
      if (isCrypto(currency)) {
        continue;
      }

      const code = codeFromCurrency(currency);
      expect(code).toBeDefined();
      expect(currencyFromCode(code as number)).toBe(currency);
    }
  });
});
