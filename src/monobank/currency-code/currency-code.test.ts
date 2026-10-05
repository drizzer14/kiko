import { currencyFromCode } from './currency-code';

describe('currency-code', () => {
  it('maps ISO numeric codes to currencies', () => {
    expect(currencyFromCode(980)).toBe('UAH');
    expect(currencyFromCode(840)).toBe('USD');
    expect(currencyFromCode(978)).toBe('EUR');
  });

  it('returns undefined for a code the app does not support', () => {
    // 643 (RUB) is not in Monobank's UAH-priced fiat set; 999 is unassigned.
    expect(currencyFromCode(643)).toBeUndefined();
    expect(currencyFromCode(999)).toBeUndefined();
  });

  it('maps GBP and CHF codes', () => {
    expect(currencyFromCode(826)).toBe('GBP');
    expect(currencyFromCode(756)).toBe('CHF');
  });

  it('maps the additional Monobank fiats', () => {
    expect(currencyFromCode(392)).toBe('JPY');
    expect(currencyFromCode(985)).toBe('PLN');
  });
});
