let mockSettingsRows: { baseCurrency: string }[] = [{ baseCurrency: 'UAH' }];
let mockCurrencyRows: { currency: string }[] = [];

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => Promise.resolve(mockSettingsRows) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { openCurrenciesQuery: () => Promise.resolve(mockCurrencyRows) },
}));

import { openCurrencies } from './open-currencies-gate';

describe('openCurrencies', () => {
  beforeEach(() => {
    mockSettingsRows = [{ baseCurrency: 'UAH' }];
    mockCurrencyRows = [];
  });

  it('reports needsFiat=false and no crypto when no currency is active', async () => {
    await expect(openCurrencies()).resolves.toEqual({ needsFiat: false, cryptoCurrencies: [] });
  });

  it('reports needsFiat=false when every active currency matches the base', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }];

    await expect(openCurrencies()).resolves.toEqual({ needsFiat: false, cryptoCurrencies: [] });
  });

  it('reports needsFiat=true when an active currency differs from the base', async () => {
    mockCurrencyRows = [{ currency: 'USD' }];

    await expect(openCurrencies()).resolves.toEqual({ needsFiat: true, cryptoCurrencies: [] });
  });

  it('reports needsFiat=true (via the fiat anchor a crypto pair needs) for a held crypto currency', async () => {
    mockCurrencyRows = [{ currency: 'BTC' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC'],
    });
  });

  it('lists every distinct held crypto currency, dropping fiat', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }, { currency: 'BTC' }, { currency: 'ETH' }];

    // needsFiat is true here too: BTC/ETH both differ from the UAH base, which
    // is exactly the fiat leg's own USD:UAH anchor these crypto pairs need.
    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC', 'ETH'],
    });
  });

  it('defaults the base currency to UAH when settings has no row yet', async () => {
    mockSettingsRows = [];
    mockCurrencyRows = [{ currency: 'USD' }];

    await expect(openCurrencies()).resolves.toEqual({ needsFiat: true, cryptoCurrencies: [] });
  });
});
