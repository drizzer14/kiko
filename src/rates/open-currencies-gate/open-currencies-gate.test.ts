let mockSettingsRows: { baseCurrency: string }[] = [{ baseCurrency: 'UAH' }];
let mockCurrencyRows: { currency: string }[] = [];

jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => Promise.resolve(mockSettingsRows) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: {
    openCurrenciesQuery: () => Promise.resolve(mockCurrencyRows),
    historyCurrenciesQuery: () => Promise.resolve(mockCurrencyRows),
  },
}));

import { openCurrencies, historyCurrencies } from './open-currencies-gate';

describe('openCurrencies', () => {
  beforeEach(() => {
    mockSettingsRows = [{ baseCurrency: 'UAH' }];
    mockCurrencyRows = [];
  });

  it('reports needsFiat=false and no crypto when no currency is active', async () => {
    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: false,
      cryptoCurrencies: [],
      nonBaseCurrencies: [],
    });
  });

  it('reports needsFiat=false when every active currency matches the base', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: false,
      cryptoCurrencies: [],
      nonBaseCurrencies: [],
    });
  });

  it('reports needsFiat=true when an active currency differs from the base', async () => {
    mockCurrencyRows = [{ currency: 'USD' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: [],
      nonBaseCurrencies: ['USD'],
    });
  });

  it('reports needsFiat=true (via the fiat anchor a crypto pair needs) for a held crypto currency', async () => {
    mockCurrencyRows = [{ currency: 'BTC' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC'],
      nonBaseCurrencies: ['BTC'],
    });
  });

  it('lists every distinct held crypto currency, dropping fiat', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }, { currency: 'BTC' }, { currency: 'ETH' }];

    // needsFiat is true here too: BTC/ETH both differ from the UAH base, which
    // is exactly the fiat leg's own USD:UAH anchor these crypto pairs need.
    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC', 'ETH'],
      nonBaseCurrencies: ['BTC', 'ETH'],
    });
  });

  it('defaults the base currency to UAH when settings has no row yet', async () => {
    mockSettingsRows = [];
    mockCurrencyRows = [{ currency: 'USD' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: [],
      nonBaseCurrencies: ['USD'],
    });
  });

  it('lists every distinct held non-base currency, fiat and crypto together', async () => {
    // `nonBaseCurrencies` is the raw set `needsFiat`'s own boolean is derived
    // from — `refreshRates` reads it directly to check which held currency
    // (crypto OR fiat) still needs its own `currency_rates` row.
    mockCurrencyRows = [{ currency: 'UAH' }, { currency: 'USD' }, { currency: 'BTC' }];

    await expect(openCurrencies()).resolves.toEqual({
      needsFiat: true,
      cryptoCurrencies: ['BTC'],
      nonBaseCurrencies: ['USD', 'BTC'],
    });
  });
});

describe('historyCurrencies', () => {
  beforeEach(() => {
    mockSettingsRows = [{ baseCurrency: 'UAH' }];
    mockCurrencyRows = [];
  });

  it('reports nothing when every held currency (or none at all) already matches the UAH base', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: [],
      cryptoCurrencies: [],
    });
  });

  it('needs the foreign held currency, base UAH', async () => {
    mockCurrencyRows = [{ currency: 'UAH' }, { currency: 'GBP' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: ['GBP'],
      cryptoCurrencies: [],
    });
  });

  it("needs the base currency's own history to convert a foreign holding into it", async () => {
    mockSettingsRows = [{ baseCurrency: 'GBP' }];
    mockCurrencyRows = [{ currency: 'UAH' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: ['GBP'],
      cryptoCurrencies: [],
    });
  });

  it('adds USD as the crypto anchor even with no other fiat held', async () => {
    mockCurrencyRows = [{ currency: 'BTC' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: ['USD'],
      cryptoCurrencies: ['BTC'],
    });
  });

  it('reports nothing when every held fiat currency already matches a non-UAH base', async () => {
    mockSettingsRows = [{ baseCurrency: 'EUR' }];
    mockCurrencyRows = [{ currency: 'EUR' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: [],
      cryptoCurrencies: [],
    });
  });

  it('still needs the base currency when held crypto is the only currency that differs from it', async () => {
    mockSettingsRows = [{ baseCurrency: 'EUR' }];
    mockCurrencyRows = [{ currency: 'EUR' }, { currency: 'BTC' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: ['EUR', 'USD'],
      cryptoCurrencies: ['BTC'],
    });
  });

  it('needs the base currency for a crypto-only holder with no fiat held at all', async () => {
    mockSettingsRows = [{ baseCurrency: 'GBP' }];
    mockCurrencyRows = [{ currency: 'BTC' }];

    await expect(historyCurrencies()).resolves.toEqual({
      fiatCurrencies: ['GBP', 'USD'],
      cryptoCurrencies: ['BTC'],
    });
  });
});
