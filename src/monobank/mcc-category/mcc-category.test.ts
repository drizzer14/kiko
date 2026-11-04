import { SEEDED_CATEGORIES, TRAVEL_CATEGORY } from '@kiko/db/__fixtures__/seeded-categories';

import {
  ADDED_MCC_CODES,
  ALWAYS_EXCLUDED_MCCS,
  OWN_ACCOUNT_TRANSFER_MCC,
  categoryForMcc,
} from './mcc-category';

// Literal tables, copied from the design and never derived from the module under test.
const ORIGINAL_CODES: Record<string, readonly number[]> = {
  groceries: [5411, 5422, 5451, 5462, 5499],
  dining: [5812, 5813, 5814],
  transport: [4111, 4121, 4131, 4784, 5541, 5542, 7523],
  shopping: [5651, 5691, 5732, 5912, 5941, 5944, 5945, 5977],
  utilities: [4814, 4899, 4900],
  entertainment: [7832, 7922, 7996, 7997],
  health: [8011, 8021, 8042, 8062],
  cash: [6011],
  transfers: [4829, 6012, 6540],
};

const ADDED_SINGLE_CODES: Record<string, readonly number[]> = {
  groceries: [5300, 5441, 5921],
  dining: [5811],
  transport: [4112, 4789, 5532, 5533, 5983, 7512, 7531, 7534, 7535, 7538, 7542, 7549],
  travel: [4511, 4582, 4722, 7011],
  shopping: [
    4812, 5200, 5211, 5231, 5251, 5261, 5310, 5311, 5331, 5399, 5621, 5631, 5641, 5655, 5661, 5699,
    5712, 5713, 5714, 5719, 5722, 5733, 5734, 5735, 5931, 5940, 5942, 5943, 5947, 5948, 5949, 5964,
    5965, 5969, 5992, 5995, 5999,
  ],
  utilities: [4816],
  entertainment: [
    5815, 5816, 5817, 5818, 7829, 7841, 7911, 7929, 7932, 7933, 7941, 7991, 7992, 7993, 7994, 7998,
    7999,
  ],
  health: [4119, 5975, 5976, 7298, 8031, 8041, 8043, 8049, 8050, 8071, 8099],
};

const rangeOf = (first: number, last: number): number[] =>
  Array.from({ length: last - first + 1 }, (_unused, offset) => first + offset);

const ADDED_RANGES: readonly { category: string; codes: number[] }[] = [
  { category: 'transport', codes: rangeOf(3351, 3441) },
  { category: 'travel', codes: rangeOf(3000, 3299) },
  { category: 'travel', codes: rangeOf(3501, 3999) },
];

const withCategory = (category: string, codes: readonly number[]): [number, string][] =>
  codes.map((code): [number, string] => [code, category]);

const tableWithCategory = (table: Record<string, readonly number[]>): [number, string][] =>
  Object.entries(table).flatMap(([category, codes]) => withCategory(category, codes));

const ADDED_SINGLES_WITH_CATEGORY = tableWithCategory(ADDED_SINGLE_CODES);

const ADDED_RANGES_WITH_CATEGORY = ADDED_RANGES.flatMap(({ category, codes }) =>
  withCategory(category, codes),
);

const wronglyMapped = (expected: [number, string][]): string[] =>
  expected
    .filter(([code, category]) => categoryForMcc(code) !== category)
    .map(([code, category]) => `${code}: wanted ${category}, got ${categoryForMcc(code)}`);

describe('categoryForMcc', () => {
  // The returned value is PERSISTED into `transactions.category`, which is
  // keyed by the `categories.key` slug (see 0002_seed_categories.sql) — not by
  // a display title. A capitalized value here never matched the lowercase slug
  // predicates elsewhere (categoriesRepo.delete), so it is the slug that must
  // come back from this mapper.
  it('returns the lowercase categories.key slug, matching the seed migration', () => {
    expect(categoryForMcc(5411)).toBe('groceries');
    expect(categoryForMcc(5812)).toBe('dining');
    expect(categoryForMcc(6011)).toBe('cash');
    expect(categoryForMcc(4829)).toBe('transfers');
    expect(categoryForMcc(9999)).toBe('other');
  });

  it('maps a transport MCC to the transport slug', () => {
    expect(categoryForMcc(4111)).toBe('transport');
  });

  it('never returns a value that differs from its own lowercase form', () => {
    const mccs = [5411, 5422, 5812, 4111, 5651, 4814, 7832, 8011, 6011, 6012, 4829, 9999];

    for (const mcc of mccs) {
      const category = categoryForMcc(mcc);

      expect(category).toBe(category.toLowerCase());
    }
  });
});

describe('the original and the added codes', () => {
  const codesOutsideTables = [
    6300, 8211, 8220, 8299, 8398, 9311, 9399, 7311, 7399, 4215, 7230, 7211, 7216, 5511, 5571, 7995,
    5993, 6010, 6051,
  ];

  it('keeps every one of the 38 original codes in its original category', () => {
    const original = tableWithCategory(ORIGINAL_CODES);

    expect(original).toHaveLength(38);
    expect(original.filter(([code]) => code === 5912)).toEqual([[5912, 'shopping']]);
    expect(wronglyMapped(original)).toEqual([]);
  });

  it('maps each of the 86 added single codes to its table category', () => {
    expect(ADDED_SINGLES_WITH_CATEGORY).toHaveLength(86);
    expect(wronglyMapped(ADDED_SINGLES_WITH_CATEGORY)).toEqual([]);
  });

  it('maps both ends of each brand range and refuses the codes next to them', () => {
    expect(
      wronglyMapped([
        ...withCategory('travel', [3000, 3299, 3501, 3999]),
        ...withCategory('transport', [3351, 3441]),
        ...withCategory('other', [2999, 3300, 3350, 3442, 3500, 4000]),
      ]),
    ).toEqual([]);
  });

  it('maps every code inside each brand range to its table category', () => {
    expect(ADDED_RANGES_WITH_CATEGORY).toHaveLength(890);
    expect(wronglyMapped(ADDED_RANGES_WITH_CATEGORY)).toEqual([]);
  });

  it('sends hotels, agencies, airlines and airports to travel', () => {
    expect(wronglyMapped(withCategory('travel', [7011, 4722, 4511, 4582]))).toEqual([]);
  });

  it('keeps car rental, rail and other land transport in transport', () => {
    expect(wronglyMapped(withCategory('transport', [7512, 3351, 4112, 4789]))).toEqual([]);
  });

  it('leaves the codes outside the tables in other', () => {
    expect(wronglyMapped(withCategory('other', codesOutsideTables))).toEqual([]);
  });

  it('lists 976 distinct added codes, none original and none excluded from spending', () => {
    const added = ADDED_MCC_CODES;
    const original = new Set(tableWithCategory(ORIGINAL_CODES).map(([code]) => code));
    const excluded = new Set<number>([...ALWAYS_EXCLUDED_MCCS, OWN_ACCOUNT_TRANSFER_MCC]);

    expect(added).toHaveLength(976);
    expect(new Set(added).size).toBe(976);
    expect(added.filter((code) => original.has(code) || excluded.has(code))).toEqual([]);
    expect([...added].sort((first, second) => first - second)).toEqual(
      [...ADDED_SINGLES_WITH_CATEGORY, ...ADDED_RANGES_WITH_CATEGORY]
        .map(([code]) => code)
        .sort((first, second) => first - second),
    );
  });

  it('targets only seeded keys and never cash or transfers', () => {
    const seededKeys = new Set([...SEEDED_CATEGORIES.map(({ key }) => key), TRAVEL_CATEGORY.key]);
    const addedTargets = new Set(
      [...ADDED_SINGLES_WITH_CATEGORY, ...ADDED_RANGES_WITH_CATEGORY].map(([code]) =>
        categoryForMcc(code),
      ),
    );

    expect(TRAVEL_CATEGORY.key).toBe('travel');
    expect([...addedTargets].filter((key) => !seededKeys.has(key))).toEqual([]);
    expect([...addedTargets].filter((key) => ['cash', 'transfers', 'other'].includes(key))).toEqual(
      [],
    );
  });
});
