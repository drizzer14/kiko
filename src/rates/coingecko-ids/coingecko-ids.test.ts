import { curatedCoins } from '@kiko/currency/coins';
import { currencyOptions, isCrypto } from '@kiko/currency/currency';

import { cryptoCoinGeckoId } from './coingecko-ids';

describe('cryptoCoinGeckoId', () => {
  it('maps exactly the crypto currencies (no crypto left without an id)', () => {
    const cryptoCodes = currencyOptions.filter(isCrypto).sort();
    expect(Object.keys(cryptoCoinGeckoId).sort()).toEqual(cryptoCodes);
  });

  it('takes each id from the registry', () => {
    for (const entry of Object.values(curatedCoins)) {
      expect(cryptoCoinGeckoId[entry.code]).toBe(entry.coinGeckoId);
    }
  });
});
