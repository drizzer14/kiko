import { currencyOptions, isCrypto } from '@kiko/currency/currency';

import { cryptoCoinGeckoId } from './coingecko-ids';

describe('cryptoCoinGeckoId', () => {
  it('maps exactly the crypto currencies (no crypto left without an id)', () => {
    const cryptoCodes = currencyOptions.filter(isCrypto).sort();
    expect(Object.keys(cryptoCoinGeckoId).sort()).toEqual(cryptoCodes);
  });
});
