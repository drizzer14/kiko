import { codeFromCurrency } from './code-from-currency';

describe('codeFromCurrency', () => {
  it('gives crypto currencies no ISO numeric code (BTC/ETH/USDT are not Monobank fiats)', () => {
    expect(codeFromCurrency('BTC')).toBeUndefined();
    expect(codeFromCurrency('ETH')).toBeUndefined();
    expect(codeFromCurrency('USDT')).toBeUndefined();
  });
});
