import { i18n } from '@kiko/i18n/init';

import { type ExchangeProviderEntry, exchangeProviderRegistry } from './registry';

const namesAndMessages = (): Record<string, { name: string; message: string }> =>
  Object.fromEntries(
    Object.values(exchangeProviderRegistry)
      .filter((entry): entry is ExchangeProviderEntry => entry !== undefined)
      .map((entry) => [
        entry.id,
        { name: i18n.t(entry.displayNameKey), message: i18n.t(entry.disconnectMessageKey) },
      ]),
  );

const expectedByLanguage = {
  en: {
    btc_wallet: {
      name: 'Wallet',
      message: 'This clears the connection. Your BTC holding stays as a manual snapshot.',
    },
    binance: {
      name: 'Binance',
      message:
        'This clears the connection and the stored API key. Your holdings and transactions stay as a manual snapshot.',
    },
  },
  uk: {
    btc_wallet: {
      name: 'Гаманець',
      message: 'Гаманець буде відʼєднано, але ви можете й надалі керувати ним вручну.',
    },
    binance: {
      name: 'Binance',
      message:
        'Акаунт буде відʼєднано, а збережений API-ключ очищено. Ваші активи й транзакції збережуться, і ви можете й надалі керувати ними вручну.',
    },
  },
} as const;

describe('exchange provider registry not-listed notes', () => {
  it('gives the Binance entry a not-listed note and the wallet entry none', () => {
    expect(exchangeProviderRegistry.binance?.notListedKey).toBe(
      'holdingDetail.exchangeNotListed.binance',
    );
    expect(exchangeProviderRegistry.btc_wallet?.notListedKey).toBeUndefined();
  });
});

describe('exchange provider registry wiring', () => {
  // `syncJobsFor` skips an id with no entry and the connect sheet offers only a wired one, so the
  // Bybit id has no way in until an entry lands with the connect path.
  it('wires no Bybit entry', () => {
    expect(exchangeProviderRegistry.bybit).toBeUndefined();
    expect(Object.keys(exchangeProviderRegistry).sort()).toEqual(['binance', 'btc_wallet']);
  });
});

describe.each(['en', 'uk'] as const)('exchange provider registry in %s', (language) => {
  beforeEach(async () => {
    await i18n.changeLanguage(language);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('names each wired provider and its disconnect message in en and uk', () => {
    expect(namesAndMessages()).toEqual(expectedByLanguage[language]);
  });
});
