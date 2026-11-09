import { i18n } from '@kiko/i18n/init';
import { balanceProviderIds } from '@kiko/crypto-sync/provider';
import { exchangeProviderRegistry } from '@kiko/crypto-sync/exchange/registry';

import { exchangeCatalog, exchangeCatalogIdOf, exchangeLabelOf, visibleExchangeEntries } from '.';

describe('exchangeCatalogIdOf', () => {
  it.each(['binance', 'bybit', 'btc_wallet', 'other'] as const)(
    "reads the catalog id from a crypto account's bank id (%s)",
    (bankId) => {
      expect(exchangeCatalogIdOf({ bankId, institution: null })).toBe(bankId);
    },
  );

  it.each(['binance', 'bybit', 'btc_wallet'] as const)(
    'reads the catalog id from the institution when the bank id is null (%s)',
    (institution) => {
      expect(exchangeCatalogIdOf({ bankId: null, institution })).toBe(institution);
    },
  );

  it('prefers the bank id over the institution', () => {
    expect(exchangeCatalogIdOf({ bankId: 'other', institution: 'binance' })).toBe('other');
  });

  it.each([
    { bankId: 'monobank', institution: null },
    { bankId: null, institution: null },
    { bankId: null, institution: 'monobank' },
  ])('reads no catalog id from an unknown bank id and no institution (%j)', (account) => {
    expect(exchangeCatalogIdOf(account)).toBeNull();
  });
});

describe('exchangeCatalog', () => {
  it('lists Binance, Bybit, the Bitcoin wallet and Other, Other last', () => {
    expect(exchangeCatalog.map((entry) => entry.id)).toEqual([
      'binance',
      'bybit',
      'btc_wallet',
      'other',
    ]);
  });

  it('marks every entry connectable except Other', () => {
    expect(exchangeCatalog.filter((entry) => entry.connectable).map((entry) => entry.id)).toEqual([
      'binance',
      'bybit',
      'btc_wallet',
    ]);
  });

  it('names Bybit in plain text and captions it as an API key connection', () => {
    const entry = exchangeCatalog.find(({ id }) => id === 'bybit');

    expect(entry?.displayName).toBe('Bybit');
    expect(entry?.captionKey).toBe('forms.account.exchangeConnectable');
  });

  it.each(balanceProviderIds)(
    'every balance provider has a catalog entry and a registry entry (%s)',
    (providerId) => {
      expect(exchangeCatalog.map((entry) => entry.id)).toContain(providerId);
      expect(exchangeProviderRegistry[providerId]?.id).toBe(providerId);
    },
  );
});

describe.each(['en', 'uk'] as const)('exchangeCatalog copy in %s', (language) => {
  beforeEach(async () => {
    await i18n.changeLanguage(language);
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it.each(exchangeCatalog)("resolves $id's label and caption to non-empty text", (entry) => {
    expect(exchangeLabelOf(entry, i18n.t).length).toBeGreaterThan(0);
    expect(i18n.t(entry.captionKey).length).toBeGreaterThan(0);
  });
});

describe('visibleExchangeEntries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists only the connectable entries the registry wires', () => {
    expect(visibleExchangeEntries().map((entry) => entry.id)).toEqual([
      'binance',
      'bybit',
      'btc_wallet',
    ]);
  });

  it('leaves out a connectable entry the registry does not wire', () => {
    jest.replaceProperty(exchangeProviderRegistry, 'binance', undefined);

    expect(visibleExchangeEntries().map((entry) => entry.id)).toEqual(['bybit', 'btc_wallet']);
  });

  it('leaves out Bybit while the registry wires no entry for it', () => {
    jest.replaceProperty(exchangeProviderRegistry, 'bybit', undefined);

    expect(visibleExchangeEntries().map((entry) => entry.id)).toEqual(['binance', 'btc_wallet']);
  });
});
