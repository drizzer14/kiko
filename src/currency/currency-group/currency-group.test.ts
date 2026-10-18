import { i18n } from '@kiko/i18n/init';

import { type Currency, currencyOptions } from '../currency';

import { orderCurrencies } from './currency-group';

const nameOf = (code: Currency): string => i18n.t(`currencyNames.${code}`, { lng: 'en' });

const order = (codes: readonly Currency[], held: readonly Currency[] = []) =>
  orderCurrencies(codes, { held, nameOf, language: 'en' });

const pinnedTrio: readonly Currency[] = ['UAH', 'USD', 'EUR'];

// A small seeded generator keeps the property table reproducible without a dependency.
const seededRandom = (seed: number) => {
  let state = seed;

  return (): number => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;

    return state / 4_294_967_296;
  };
};

const shuffled = <Item>(items: readonly Item[], random: () => number): Item[] => {
  const copy = [...items];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));

    [copy[index], copy[other]] = [copy[other], copy[index]];
  }

  return copy;
};

describe('orderCurrencies', () => {
  it('orders held, then UAH USD EUR, then by name', () => {
    expect(order(['ARS', 'EUR', 'BTC', 'UAH', 'USD', 'AUD', 'CHF'], ['CHF', 'BTC'])).toEqual([
      'BTC',
      'CHF',
      'UAH',
      'USD',
      'EUR',
      'ARS',
      'AUD',
    ]);
  });

  it('sorts the held codes by name, whatever order they were held in', () => {
    expect(order(['CHF', 'BTC', 'ARS'], ['CHF', 'BTC'])).toEqual(['BTC', 'CHF', 'ARS']);
    expect(order(['CHF', 'BTC', 'ARS'], ['BTC', 'CHF'])).toEqual(['BTC', 'CHF', 'ARS']);
  });

  it('never duplicates a held UAH/USD/EUR', () => {
    expect(order(['EUR', 'USD', 'UAH', 'ARS'], ['EUR'])).toEqual(['EUR', 'UAH', 'USD', 'ARS']);
    expect(order(['EUR', 'USD', 'UAH', 'ARS'], ['USD', 'UAH'])).toEqual([
      'UAH',
      'USD',
      'EUR',
      'ARS',
    ]);
  });

  it('drops held codes not in the input', () => {
    expect(order(['ARS', 'UAH'], ['BTC', 'UAH'])).toEqual(['UAH', 'ARS']);
  });

  it('skips a pinned code the input does not have', () => {
    expect(order(['ARS', 'EUR'])).toEqual(['EUR', 'ARS']);
  });

  it('sorts by localized name, not code (DZD before AOA)', () => {
    expect(order(['AOA', 'DZD'])).toEqual(['DZD', 'AOA']);
  });

  it('sorts by the name in the given language', () => {
    const reversedNames: Record<string, string> = { AOA: 'a', DZD: 'b' };

    expect(
      orderCurrencies(['DZD', 'AOA'], {
        held: [],
        nameOf: (code) => reversedNames[code],
        language: 'en',
      }),
    ).toEqual(['AOA', 'DZD']);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'keeps held first, then the pinned trio, over shuffled slice %i',
    (seed) => {
      const random = seededRandom(seed);
      const codes = shuffled(currencyOptions, random).slice(0, 20 + seed * 8);
      const held = shuffled(currencyOptions, random).slice(0, seed % 5);
      const withPinned = [...new Set([...codes, ...(seed % 2 === 0 ? pinnedTrio : [])])];
      const result = order(withPinned, held);

      const heldInput = withPinned.filter((code) => held.includes(code));
      const trioAfterHeld = pinnedTrio.filter(
        (code) => withPinned.includes(code) && !held.includes(code),
      );

      expect([...result].sort()).toEqual([...withPinned].sort());
      expect(new Set(result.slice(0, heldInput.length))).toEqual(new Set(heldInput));
      expect(result.slice(heldInput.length, heldInput.length + trioAfterHeld.length)).toEqual(
        trioAfterHeld,
      );
    },
  );
});
