import { type Currency, currencyScale } from '@kiko/currency/currency';

import type {
  CategoryRuleMatcher,
  RewriteCandidate,
  StoredCategoryRule,
} from '../category-rules.d';

const SEED = 20_261_011;
const ROW_COUNT = 50_000;
const DESCRIPTION_COUNT = 2_000;
const NAME_RULE_COUNT = 120;
const PREFIX_RULE_COUNT = 40;
const MULTI_MATCHER_RULE_COUNT = 40;

const HOLDING_CURRENCIES: readonly Currency[] = [
  ...Array<Currency>(8).fill('UAH'),
  ...Array<Currency>(4).fill('USD'),
  ...Array<Currency>(3).fill('EUR'),
  ...Array<Currency>(3).fill('GBP'),
  ...Array<Currency>(2).fill('BTC'),
];

const MERCHANT_WORDS = [
  'Silpo',
  'ATB',
  'Rozetka',
  'Nova Poshta',
  'Uber',
  'Bolt',
  'Netflix',
  'Spotify',
  'Apteka',
  'Fora',
  'Сільпо',
  'Аптека',
  'Київстар',
  'Нова Пошта',
  'Укрзалізниця',
  'Макдональдз',
  'Епіцентр',
  'Пузата хата',
  'Ощадбанк',
  'Метро',
];

const CATEGORIES = [
  'groceries',
  'food',
  'transport',
  'shops',
  'health',
  'entertainment',
  'bills',
  'other',
];

const FIRST_TIME = Date.UTC(2023, 0, 1);
const LAST_TIME = Date.UTC(2026, 0, 1);

// A small deterministic generator, so every run builds the same fixture.
const seededRandom = (seed: number): (() => number) => {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;

    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);

    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
};

const descriptionAt = (index: number): string =>
  `${MERCHANT_WORDS[index % MERCHANT_WORDS.length]} ${Math.floor(index / MERCHANT_WORDS.length) + 1}`;

const ruleIdOf = (index: number): string => `rule-${String(index).padStart(3, '0')}`;

const nameRules = (): StoredCategoryRule[] =>
  Array.from({ length: NAME_RULE_COUNT }, (_unused, index) => {
    const description = descriptionAt((index * 16 + 3) % DESCRIPTION_COUNT);
    const text = index % 2 === 0 ? description.toUpperCase() : description;

    return {
      id: ruleIdOf(index),
      category: CATEGORIES[index % CATEGORIES.length] as string,
      matchers: JSON.stringify([{ type: 'nameIs', text }]),
      createdAt: 1_000 + index,
      updatedAt: 1_000 + Math.floor(index / 2),
    };
  });

const prefixRules = (): StoredCategoryRule[] =>
  Array.from({ length: PREFIX_RULE_COUNT }, (_unused, index) => {
    const word = MERCHANT_WORDS[index % MERCHANT_WORDS.length];
    const digit = Math.floor(index / MERCHANT_WORDS.length) + 1;

    return {
      id: ruleIdOf(NAME_RULE_COUNT + index),
      category: CATEGORIES[(index + 3) % CATEGORIES.length] as string,
      matchers: JSON.stringify([{ type: 'nameStartsWith', text: `${word} ${digit}` }]),
      createdAt: 2_000 + index,
      updatedAt: 2_000 + index,
    };
  });

const AMOUNT_OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const;
const AMOUNT_CURRENCIES: readonly Currency[] = ['UAH', 'USD', 'EUR', 'GBP', 'BTC'];

const multiMatcherRules = (): StoredCategoryRule[] =>
  Array.from({ length: MULTI_MATCHER_RULE_COUNT }, (_unused, index) => {
    const currency = AMOUNT_CURRENCIES[index % AMOUNT_CURRENCIES.length] as Currency;
    const matchers: CategoryRuleMatcher[] = [
      {
        type: 'amount',
        operator: AMOUNT_OPERATORS[index % AMOUNT_OPERATORS.length] as 'gt',
        minorUnits: (100 + index * 25) * 10 ** (currencyScale[currency] - 2),
        currency,
      },
      index % 2 === 0
        ? { type: 'direction', direction: 'expense' }
        : {
            type: 'time',
            operator: index % 4 === 1 ? 'before' : 'after',
            minuteOfDay: 600 + index,
          },
    ];

    if (index % 3 === 0) {
      matchers.push({ type: 'time', operator: 'after', minuteOfDay: 60 + index });
    }

    return {
      id: ruleIdOf(NAME_RULE_COUNT + PREFIX_RULE_COUNT + index),
      category: CATEGORIES[(index + 5) % CATEGORIES.length] as string,
      matchers: JSON.stringify(matchers),
      createdAt: 3_000 + index,
      updatedAt: 3_000 + Math.floor(index / 3),
    };
  });

const buildRows = (): RewriteCandidate[] => {
  const random = seededRandom(SEED);

  return Array.from({ length: ROW_COUNT }, (_unused, index) => {
    const currency = HOLDING_CURRENCIES[
      Math.floor(random() * HOLDING_CURRENCIES.length)
    ] as Currency;
    const magnitude = Math.floor(random() * 500_000) * 10 ** (currencyScale[currency] - 2) + 1;
    const category = random() < 0.2 ? null : (CATEGORIES[Math.floor(random() * 8)] as string);

    return {
      id: `row-${index}`,
      description: descriptionAt(Math.floor(random() * DESCRIPTION_COUNT)),
      amountMinorUnits: random() < 0.8 ? -magnitude : magnitude,
      time: FIRST_TIME + Math.floor(random() * (LAST_TIME - FIRST_TIME)),
      currency,
      category,
      categorySetByHand: random() < 0.1,
      exchangePairId: null,
      exchangeCounterpartHoldingId: null,
      untrackedCounterpart: null,
      setsBalance: false,
      changeGroupId: null,
    };
  });
};

export const buildRulesPerformanceFixture = (): {
  rules: StoredCategoryRule[];
  rows: RewriteCandidate[];
} => ({
  rules: [...nameRules(), ...prefixRules(), ...multiMatcherRules()],
  rows: buildRows(),
});
