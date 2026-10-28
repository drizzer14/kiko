import {
  type Currency,
  cryptoCurrencyOptions,
  currencyOptions,
  fiatCurrencyOptions,
  isCrypto,
  isFiat,
} from '@kiko/currency/currency';
import { i18n } from '@kiko/i18n/init';

import { holdingTypes } from '../holding-type';
import { isCurrencyExpectedForHoldingType } from '../holding-currency';

import { currencyPickerGroups } from './currency-picker-groups';

const nameOf = (code: Currency): string => i18n.t(`currencyNames.${code}`, { lng: 'en' });

const groupsFor = (
  context: Parameters<typeof currencyPickerGroups>[0],
  held: readonly Currency[] = [],
) => currencyPickerGroups(context, { held, nameOf, language: 'en' });

const kindsOf = (groups: ReturnType<typeof groupsFor>) => groups.map((group) => group.kind);

const currenciesOf = (groups: ReturnType<typeof groupsFor>, kind: string): readonly Currency[] =>
  groups.find((group) => group.kind === kind)?.currencies ?? [];

describe('currencyPickerGroups', () => {
  describe('a fiat context (cash account, base currency)', () => {
    it('is one fiat group with no coin', () => {
      const groups = groupsFor({ kind: 'fiat' });

      expect(kindsOf(groups)).toEqual(['fiat']);
      expect([...groups[0].currencies].sort()).toEqual([...fiatCurrencyOptions].sort());
      expect(groups[0].currencies.some(isCrypto)).toBe(false);
    });

    it('lists the held fiat first, then UAH, USD, EUR, and never a held coin', () => {
      const groups = groupsFor({ kind: 'fiat' }, ['CHF', 'BTC']);

      expect(groups[0].currencies.slice(0, 4)).toEqual(['CHF', 'UAH', 'USD', 'EUR']);
      expect(groups[0].currencies).not.toContain('BTC');
    });
  });

  describe('a holding context', () => {
    it.each(holdingTypes)('%s offers the groups its type expects', (type) => {
      const groups = groupsFor({ kind: 'holding', type });

      expect(kindsOf(groups)).toEqual(type === 'crypto_asset' ? ['crypto', 'fiat'] : ['fiat']);
    });

    it.each(holdingTypes)('%s leads with exactly the currencies it expects', (type) => {
      const [first] = groupsFor({ kind: 'holding', type });
      const expected = currencyOptions.filter((code) =>
        isCurrencyExpectedForHoldingType(type, code),
      );

      expect([...first.currencies].sort()).toEqual([...expected].sort());
    });

    it('lists a crypto asset coins first, then every fiat currency', () => {
      const groups = groupsFor({ kind: 'holding', type: 'crypto_asset' }, ['USD', 'BTC']);

      expect(currenciesOf(groups, 'crypto').slice(0, 1)).toEqual(['BTC']);
      expect([...currenciesOf(groups, 'crypto')].sort()).toEqual([...cryptoCurrencyOptions].sort());
      expect(currenciesOf(groups, 'fiat').slice(0, 3)).toEqual(['USD', 'UAH', 'EUR']);
      expect(currenciesOf(groups, 'fiat').every(isFiat)).toBe(true);
    });

    it('offers a term deposit no coin, with the held fiat first', () => {
      const groups = groupsFor({ kind: 'holding', type: 'term_deposit' }, ['USD', 'BTC']);

      expect(currenciesOf(groups, 'fiat').slice(0, 3)).toEqual(['USD', 'UAH', 'EUR']);
      expect(groups.flatMap((group) => group.currencies).some(isCrypto)).toBe(false);
    });
  });

  describe('the crypto-first context (a crypto account)', () => {
    it('lists the coins, then the fiat currencies, as a crypto holding does', () => {
      const held: readonly Currency[] = ['USD', 'BTC'];

      expect(groupsFor({ kind: 'crypto-first' }, held)).toEqual(
        groupsFor({ kind: 'holding', type: 'crypto_asset' }, held),
      );
    });

    it('orders each group with the held codes first, and has no held group', () => {
      const groups = groupsFor({ kind: 'crypto-first' }, ['USD', 'BTC']);

      expect(kindsOf(groups)).toEqual(['crypto', 'fiat']);
      expect(currenciesOf(groups, 'crypto').slice(0, 1)).toEqual(['BTC']);
      expect(currenciesOf(groups, 'fiat').slice(0, 3)).toEqual(['USD', 'UAH', 'EUR']);
    });
  });

  describe('a statement context', () => {
    it('puts the target first and not below', () => {
      const groups = groupsFor({ kind: 'statement', target: { currency: 'EUR', type: 'cash' } }, [
        'USD',
        'BTC',
      ]);

      expect(kindsOf(groups)).toEqual(['target', 'fiat']);
      expect(groups[0].currencies).toEqual(['EUR']);
      expect(currenciesOf(groups, 'fiat').slice(0, 2)).toEqual(['USD', 'UAH']);
      expect(currenciesOf(groups, 'fiat')).not.toContain('EUR');
    });

    it('groups the rest as the target holding type does, for a crypto asset', () => {
      const groups = groupsFor({
        kind: 'statement',
        target: { currency: 'BTC', type: 'crypto_asset' },
      });

      expect(kindsOf(groups)).toEqual(['target', 'crypto', 'fiat']);
      expect(groups[0].currencies).toEqual(['BTC']);
      expect(currenciesOf(groups, 'crypto')).not.toContain('BTC');
      expect(currenciesOf(groups, 'crypto').length).toBe(cryptoCurrencyOptions.length - 1);
    });

    it('removes a pinned target code from the group below', () => {
      const groups = groupsFor({ kind: 'statement', target: { currency: 'UAH', type: 'loan' } });

      expect(kindsOf(groups)).toEqual(['target', 'fiat']);
      expect(currenciesOf(groups, 'fiat').slice(0, 2)).toEqual(['USD', 'EUR']);
      expect(currenciesOf(groups, 'fiat')).not.toContain('UAH');
    });

    it('without a target equals any', () => {
      const held: readonly Currency[] = ['USD', 'BTC'];

      expect(groupsFor({ kind: 'statement', target: undefined }, held)).toEqual(
        groupsFor({ kind: 'any' }, held),
      );
    });
  });

  describe('the any context', () => {
    it('lists held, then fiat and coins without the held codes', () => {
      const groups = groupsFor({ kind: 'any' }, ['USD', 'BTC']);

      expect(kindsOf(groups)).toEqual(['held', 'fiat', 'crypto']);
      expect(currenciesOf(groups, 'held')).toEqual(['BTC', 'USD']);
      expect(currenciesOf(groups, 'fiat').slice(0, 2)).toEqual(['UAH', 'EUR']);
      expect(currenciesOf(groups, 'fiat')).not.toContain('USD');
      expect(currenciesOf(groups, 'crypto')).not.toContain('BTC');
      expect(currenciesOf(groups, 'crypto').length).toBe(cryptoCurrencyOptions.length - 1);
    });

    it('lists every supported code exactly once', () => {
      const groups = groupsFor({ kind: 'any' }, ['USD', 'BTC']);
      const all = groups.flatMap((group) => group.currencies);

      expect(all.length).toBe(currencyOptions.length);
      expect([...new Set(all)].sort()).toEqual([...currencyOptions].sort());
    });

    it('drops an empty group', () => {
      expect(kindsOf(groupsFor({ kind: 'any' }))).toEqual(['fiat', 'crypto']);
      expect(kindsOf(groupsFor({ kind: 'any' }, ['USD']))).toEqual(['held', 'fiat', 'crypto']);
    });
  });
});
