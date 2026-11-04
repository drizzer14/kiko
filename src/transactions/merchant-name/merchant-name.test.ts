import { sweep } from '@kiko/test-support/property-sweep';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';
import { normalizeTransactionName } from '@kiko/transactions/normalize-name';

type MerchantNameModule = {
  merchantNameOf: (name: string) => { key: string; prefix: string | null };
  tidiedNameOf: (name: string) => string;
  merchantSpellingOf: (name: string) => string;
  smallestSpelling: (spellings: Iterable<string>) => string;
};

// The module does not exist yet, so a static import would fail the whole file at load; a lookup at
// call time fails each test on its own.
const merchantName = (): MerchantNameModule => require('./merchant-name');

const SEED_SPREAD = 1_000_003;
const SEEDS = sweep(Array.from({ length: 20 }, (_unused, position) => 11 + position * 17));
const NAMES_PER_WORLD = 80;
const NON_BREAKING_SPACE = ' ';
const DECOMPOSED_SHORT_I = 'й';
const WORD_TOKENS = [
  'ATB',
  'Silpo',
  'Market',
  'Сільпо',
  'АТБ',
  'Кафе',
  'BP',
  'KFC',
  'Top',
  'up',
  '7-Eleven',
  'İstanbul',
  'ΣΑΣ',
  `${DECOMPOSED_SHORT_I}ога`,
  'Kyiv',
];
const SEPARATOR_TOKENS = ['#', '№', '-', ',', '.'];
const SEPARATORS = [' ', '  ', NON_BREAKING_SPACE, ` ${NON_BREAKING_SPACE}`];

const NAME_TABLE: [string, string, string | null][] = [
  ['Silpo Market 12', 'silpo market', 'Silpo Market'],
  ['ATB 0212', 'atb', 'ATB'],
  ['ATB', 'atb', null],
  ['ATB Market', 'atb market', null],
  ['АТБ 0212', 'атб', 'АТБ'],
  ['ATB #0212', 'atb', 'ATB'],
  ['ATB № 0212', 'atb', 'ATB'],
  ['ATB - 0212', 'atb', 'ATB'],
  ['ATB-0212', 'atb-0212', null],
  ['7-Eleven', '7-eleven', null],
  ['7-Eleven 0212', '7-eleven', '7-Eleven'],
  ['7 11', '7 11', null],
  ['BP 1234', 'bp 1234', null],
  ['0212', '0212', null],
  ['ATB 0212 Kyiv', 'atb 0212 kyiv', null],
  ['Top up 1', 'top up 1', null],
  [
    'Рахунок створений автоматично для поповнення балансу 380670000000',
    'рахунок створений автоматично для поповнення балансу 380670000000',
    null,
  ],
  ['Visa Signature 4111xxxxxxx1111', 'visa signature 4111xxxxxxx1111', null],
  ['537541******1234', '537541******1234', null],
  ['Виведення кешбеку 464.40₴', 'виведення кешбеку 464.40₴', null],
  ['WFP.OPENDATABOTM', 'wfp.opendatabotm', null],
  ['   ', '', null],
];

const pickFrom = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const digitsOf = (random: Random): string => {
  const length = 1 + Math.floor(random() * 8);

  return Array.from({ length }, () => String(Math.floor(random() * 10))).join('');
};

const tokenOf = (random: Random): string => {
  const draw = random();

  if (draw < 0.5) {
    return pickFrom(random, WORD_TOKENS);
  }

  if (draw < 0.75) {
    return digitsOf(random);
  }

  if (draw < 0.9) {
    return pickFrom(random, SEPARATOR_TOKENS);
  }

  return `${pickFrom(random, SEPARATOR_TOKENS)}${digitsOf(random)}`;
};

const nameOf = (random: Random): string => {
  const length = 1 + Math.floor(random() * 5);
  const tokens = Array.from({ length }, () => tokenOf(random));
  const closing = random() < 0.5 ? [digitsOf(random)] : [];

  return [...tokens, ...closing].reduce(
    (name, token, index) =>
      index === 0 ? token : `${name}${pickFrom(random, SEPARATORS)}${token}`,
    '',
  );
};

const worldOf = (seed: number): string[] => {
  // The first draw of this generator on a seed this small is near zero, so every plain seed would
  // draw the same first name; the spread seed draws different worlds.
  const random = seededRandom(seed * SEED_SPREAD);

  return Array.from({ length: NAMES_PER_WORLD }, () => nameOf(random));
};

describe('merchantNameOf', () => {
  it.each(NAME_TABLE)('reads %s as key %s and prefix %s', (name, key, prefix) => {
    expect(merchantName().merchantNameOf(name)).toEqual({ key, prefix });
  });

  it('is the same for a name in another case and spacing', () => {
    const { merchantNameOf } = merchantName();

    expect(merchantNameOf('ATB  0212').key).toBe('atb');
    expect(merchantNameOf('ATB  0212').key).toBe(merchantNameOf('atb 0212').key);
    expect(merchantNameOf('atb 0212').key).toBe('atb');
  });
});

describe('the guarantee', () => {
  it.each(SEEDS)('holds for every name of the world of seed %s', (seed) => {
    const { merchantNameOf } = merchantName();
    const names = worldOf(seed);
    const results = names.map((name) => ({ name, ...merchantNameOf(name) }));

    for (const { name, key, prefix } of results) {
      expect(normalizeTransactionName(name).startsWith(key)).toBe(true);

      if (prefix !== null) {
        expect(normalizeTransactionName(prefix)).toBe(key);
      }
    }

    expect(results.some(({ prefix }) => prefix !== null)).toBe(true);
    expect(results.some(({ prefix }) => prefix === null)).toBe(true);
  });

  it('draws worlds that differ from each other', () => {
    const worlds = SEEDS.map((seed) => worldOf(seed).join('|'));

    expect(new Set(worlds).size).toBe(SEEDS.length);
  });
});

describe('smallestSpelling', () => {
  it('takes the smallest by code unit', () => {
    const { smallestSpelling } = merchantName();

    expect(smallestSpelling(['atb', 'ATB'])).toBe('ATB');
    expect(smallestSpelling(['ATB', 'atb'])).toBe('ATB');
  });
});

describe('the spellings of a name', () => {
  it('tidiedNameOf keeps the full name', () => {
    expect(merchantName().tidiedNameOf('ATB  0212')).toBe('ATB 0212');
  });

  it('merchantSpellingOf gives the prefix when cut, else the tidied name', () => {
    const { merchantSpellingOf } = merchantName();

    expect(merchantSpellingOf('ATB 0212')).toBe('ATB');
    expect(merchantSpellingOf('ATB Market')).toBe('ATB Market');
  });
});
