import { en, uk } from '@kiko/i18n/locales';

import { currencyOptions } from './currency';

// Currency display names now live in the i18n catalogues under `currencyNames`,
// keyed by ISO letter code, not in currency.ts. Both catalogues must name every
// supported currency so the CurrencyField label, rows, and search work in either
// language. English names are carried verbatim from the retired `currencyName`
// map; Ukrainian names are the official NBU names where the NBU feed quotes the
// currency, and authored fallbacks otherwise (see item3-report).
describe('currencyNames i18n coverage', () => {
  it('names every supported currency in English', () => {
    for (const code of currencyOptions) {
      expect(en.currencyNames[code].length).toBeGreaterThan(0);
    }
  });

  it('names every supported currency in Ukrainian', () => {
    for (const code of currencyOptions) {
      expect(uk.currencyNames[code].length).toBeGreaterThan(0);
    }
  });

  it('keeps the English names of the originally shipped set', () => {
    expect(en.currencyNames.USD).toBe('US Dollar');
    expect(en.currencyNames.GBP).toBe('British Pound');
    expect(en.currencyNames.CHF).toBe('Swiss Franc');
    expect(en.currencyNames.JPY).toBe('Japanese Yen');
    expect(en.currencyNames.PLN).toBe('Polish Zloty');
    expect(en.currencyNames.BTC).toBe('Bitcoin');
  });

  it('uses the official NBU Ukrainian names', () => {
    expect(uk.currencyNames.USD).toBe('Долар США');
    expect(uk.currencyNames.EUR).toBe('Євро');
    expect(uk.currencyNames.GBP).toBe('Фунт стерлінгів');
    expect(uk.currencyNames.CHF).toBe('Швейцарський франк');
  });

  it('hand-authors the Ukrainian hryvnia and Bitcoin names', () => {
    expect(uk.currencyNames.UAH).toBe('Українська гривня');
    expect(uk.currencyNames.BTC).toBe('Біткоїн');
  });

  it('hand-authors the new crypto names in both languages', () => {
    expect(en.currencyNames.ETH).toBe('Ethereum');
    expect(en.currencyNames.USDT).toBe('Tether');
    expect(uk.currencyNames.ETH.length).toBeGreaterThan(0);
    expect(uk.currencyNames.USDT.length).toBeGreaterThan(0);
  });
});
