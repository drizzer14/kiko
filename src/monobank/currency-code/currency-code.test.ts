import { codeFromCurrency, currencyFromCode } from './currency-code';

describe('currency-code', () => {
  it('maps ISO numeric codes to currencies', () => {
    expect(currencyFromCode(980)).toBe('UAH');
    expect(currencyFromCode(840)).toBe('USD');
    expect(currencyFromCode(978)).toBe('EUR');
  });

  it('returns undefined for an unknown code', () => {
    expect(currencyFromCode(392)).toBeUndefined();
  });

  it('maps currencies back to codes', () => {
    expect(codeFromCurrency('UAH')).toBe(980);
  });

  it('maps GBP and CHF in both directions', () => {
    expect(currencyFromCode(826)).toBe('GBP');
    expect(currencyFromCode(756)).toBe('CHF');
    expect(codeFromCurrency('GBP')).toBe(826);
    expect(codeFromCurrency('CHF')).toBe(756);
  });
});
