import { i18n } from '@kiko/i18n/init';
import { balanceProviderIds } from '@kiko/crypto-sync/provider';

import { type ExchangeProviderEntry, exchangeProviderRegistry, pastLimitsKeysOf } from './registry';

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
    bybit: {
      name: 'Bybit',
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
    bybit: {
      name: 'Bybit',
      message:
        'Акаунт буде відʼєднано, а збережений API-ключ очищено. Ваші активи й транзакції збережуться, і ви можете й надалі керувати ними вручну.',
    },
  },
} as const;

describe('exchange provider registry not-listed notes', () => {
  it('gives the Binance and Bybit entries a not-listed note and the wallet entry none', () => {
    expect(exchangeProviderRegistry.binance?.notListedKey).toBe(
      'holdingDetail.exchangeNotListed.binance',
    );
    expect(exchangeProviderRegistry.bybit?.notListedKey).toBe(
      'holdingDetail.exchangeNotListed.bybit',
    );
    expect(exchangeProviderRegistry.btc_wallet?.notListedKey).toBeUndefined();
  });
});

describe('exchange provider registry earlier-history line', () => {
  it('shows the earlier-history line for Binance only', () => {
    expect(exchangeProviderRegistry.binance?.showsEarlierHistory).toBe(true);
    expect(exchangeProviderRegistry.bybit?.showsEarlierHistory).toBeUndefined();
    expect(exchangeProviderRegistry.btc_wallet?.showsEarlierHistory).toBeUndefined();
  });
});

describe('exchange provider registry past-limits line', () => {
  it('names the Statistics past-limits line for Bybit only', () => {
    expect(exchangeProviderRegistry.bybit?.pastLimitsKey).toBe('statistics.bybitPastLimits');
    expect(exchangeProviderRegistry.binance?.pastLimitsKey).toBeUndefined();
    expect(exchangeProviderRegistry.btc_wallet?.pastLimitsKey).toBeUndefined();
  });
});

describe('pastLimitsKeysOf', () => {
  it.each([
    [['bybit'], ['statistics.bybitPastLimits']],
    [['binance', 'btc_wallet'], []],
    [['binance', 'bybit', 'bybit'], ['statistics.bybitPastLimits']],
    [[null, 'monobank'], []],
    [[], []],
  ])('names the past-limits line of each listed provider once (%j)', (institutions, keys) => {
    expect(pastLimitsKeysOf(institutions)).toEqual(keys);
  });
});

describe('exchange provider registry wiring', () => {
  it('wires an entry for every balance provider id', () => {
    expect(Object.keys(exchangeProviderRegistry).sort()).toEqual([...balanceProviderIds].sort());
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
