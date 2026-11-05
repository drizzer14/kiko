import { sweep } from '@kiko/test-support/property-sweep';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { ruleRow } from './__fixtures__/rule-row';
import { subjectOfStoredRow } from './rule-subject';
import { planReviewGroups } from './plan-review-groups';
import { matchesRule, prepareRules } from './prepare-rules';
import type { ReviewCandidate, ReviewGroup, StoredCategoryRule } from './category-rules.d';

const KNOWN_CATEGORY_KEYS: ReadonlySet<string> = new Set([
  'groceries',
  'food',
  'transport',
  'shopping',
  'travel',
]);

const CONTROL_NAME = 'Control Shop';

const rowOf = (
  id: string,
  description: string,
  overrides: Partial<ReviewCandidate> = {},
): ReviewCandidate => ({
  id,
  description,
  amountMinorUnits: -100,
  time: 1_000,
  currency: 'UAH',
  category: null,
  categorySetByHand: false,
  setsBalance: false,
  changeGroupId: null,
  mcc: null,
  counterIban: null,
  accountId: 'account',
  exchangeCounterpartHoldingId: null,
  untrackedCounterpart: null,
  ...overrides,
});

const rowsOf = (descriptions: readonly string[]): ReviewCandidate[] =>
  descriptions.map((description, index) => rowOf(`row-${index}`, description));

const plan = (rows: readonly ReviewCandidate[], rules: readonly StoredCategoryRule[] = []) =>
  planReviewGroups(prepareRules(rules), rows, KNOWN_CATEGORY_KEYS);

const namesOf = (groups: readonly ReviewGroup[]): string[] =>
  groups.flatMap((group) => [...group.names]).sort();

describe('planReviewGroups keeps and drops', () => {
  it('keeps NULL, empty, other and orphan rows', () => {
    const rows = [
      rowOf('null', 'Null Shop', { category: null }),
      rowOf('empty', 'Empty Shop', { category: '' }),
      rowOf('other', 'Other Shop', { category: 'Other' }),
      rowOf('orphan', 'Orphan Shop', { category: 'ghost' }),
    ];

    expect(namesOf(plan(rows))).toEqual(['Empty Shop', 'Null Shop', 'Orphan Shop', 'Other Shop']);
  });

  it.each<[string, Partial<ReviewCandidate>[]]>([
    ['drops a hand-set row', [{ categorySetByHand: true }]],
    [
      'drops a balance-setting and a split-change row',
      [{ setsBalance: true }, { changeGroupId: 'change-group' }],
    ],
    [
      'drops an exchange leg by either marker',
      [{ exchangeCounterpartHoldingId: 'other-holding' }, { untrackedCounterpart: 'untracked' }],
    ],
    ['drops a real category', [{ category: 'groceries' }]],
  ])('%s', (_title, overrides) => {
    const dropped = overrides.map((override, index) =>
      rowOf(`dropped-${index}`, `Dropped ${index}`, override),
    );
    const twins = overrides.map((_override, index) => rowOf(`twin-${index}`, `Dropped ${index}`));

    expect(namesOf(plan([...dropped, rowOf('control', CONTROL_NAME)]))).toEqual([CONTROL_NAME]);
    expect(namesOf(plan(twins))).toHaveLength(twins.length);
  });

  it.each(['', '   '])('drops a blank description %j', (description) => {
    expect(namesOf(plan([rowOf('blank', description), rowOf('control', CONTROL_NAME)]))).toEqual([
      CONTROL_NAME,
    ]);
  });

  it.each<[string, string | null, string]>([
    ['drops a row a rule wins', null, 'other'],
    ['drops a row in other won by a rule that targets another category', 'other', 'groceries'],
  ])('%s', (_title, storedCategory, ruleCategory) => {
    const rows = [
      rowOf('won', 'Won Shop', { category: storedCategory }),
      rowOf('control', CONTROL_NAME),
    ];
    const rule = ruleRow({
      category: ruleCategory,
      matchers: [{ type: 'nameIs', text: 'won shop' }],
    });

    expect(namesOf(plan(rows, [rule]))).toEqual([CONTROL_NAME]);
    expect(namesOf(plan(rows))).toEqual([CONTROL_NAME, 'Won Shop']);
  });
});

describe('planReviewGroups grouping', () => {
  it('groups ATB, ATB 0212 and atb 0340 under one key', () => {
    const groups = plan(rowsOf(['ATB', 'ATB 0212', 'atb 0340']));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'atb', rowCount: 3 });
  });

  it('keeps АТБ and ATB apart', () => {
    const groups = plan(rowsOf(['ATB 0212', 'АТБ 0212']));

    expect(groups.map((group) => group.key).sort()).toEqual(['atb', 'атб']);
  });

  it('treats ATB 0212 and atb  0212 as one name', () => {
    const groups = plan(rowsOf(['ATB 0212', 'atb  0212']));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.names).toEqual(['ATB 0212']);
    expect(groups[0]?.rule.kind).toBe('nameIs');
  });
});

describe('planReviewGroups names and rule text', () => {
  it('offers nameIs on the full name for one distinct name', () => {
    const [group] = plan(rowsOf(['ATB 0212', 'atb  0212']));

    expect(group?.names).toEqual(['ATB 0212']);
    expect(group?.rule).toEqual({ kind: 'nameIs', text: 'ATB 0212' });
  });

  it('offers nameStartsWith on the prefix and lists the names in full', () => {
    const [group] = plan(rowsOf(['ATB 0212', 'ATB 0340']));

    expect(group?.names).toEqual(['ATB 0212', 'ATB 0340']);
    expect(group?.rule).toEqual({ kind: 'nameStartsWith', text: 'ATB' });
  });

  it.each<[string[], string[], ReviewGroup['rule']]>([
    [['atb 0340', 'ATB 0340'], ['ATB 0340'], { kind: 'nameIs', text: 'ATB 0340' }],
    [
      ['atb 0340', 'ATB 0340', 'atb 0212'],
      ['ATB 0340', 'atb 0212'],
      { kind: 'nameStartsWith', text: 'ATB' },
    ],
  ])('spells the same whatever the row order: %j', (descriptions, names, rule) => {
    const forward = plan(rowsOf(descriptions));
    const backward = plan(rowsOf([...descriptions].reverse()));

    expect(forward).toHaveLength(1);
    expect(forward[0]?.names).toEqual(names);
    expect(forward[0]?.rule).toEqual(rule);
    expect(backward[0]?.names).toEqual(names);
    expect(backward[0]?.rule).toEqual(rule);
  });
});

const ORDER_WORLD: [string, number][] = [
  ['Echo', 1_000],
  ['Delta', 1_000],
  ['Bravo', 500],
  ['Bravo', 400],
  ['Charlie', 900],
  ['Charlie', 100],
  ['Alpha', 10],
  ['Alpha', 20],
  ['Alpha', 30],
];

const orderWorldRows = (): ReviewCandidate[] =>
  ORDER_WORLD.map(([description, time], index) => rowOf(`row-${index}`, description, { time }));

const SHUFFLES: [string, (rows: ReviewCandidate[]) => ReviewCandidate[]][] = [
  ['reversed', (rows) => [...rows].reverse()],
  ['rotated', (rows) => [...rows.slice(4), ...rows.slice(0, 4)]],
  [
    'even then odd',
    (rows) => [
      ...rows.filter((_row, index) => index % 2 === 0),
      ...rows.filter((_row, index) => index % 2 === 1),
    ],
  ],
];

describe('planReviewGroups order', () => {
  it('sorts by row count, then newest time, then key', () => {
    expect(
      plan(orderWorldRows()).map((group) => [group.key, group.rowCount, group.newestTime]),
    ).toEqual([
      ['alpha', 3, 30],
      ['charlie', 2, 900],
      ['bravo', 2, 500],
      ['delta', 1, 1_000],
      ['echo', 1, 1_000],
    ]);
  });

  it.each(SHUFFLES)('is the same for shuffled rows: %s', (_title, shuffle) => {
    expect(plan(shuffle(orderWorldRows()))).toEqual(plan(orderWorldRows()));
  });
});

const SEED_SPREAD = 1_000_003;
const SEEDS = sweep(Array.from({ length: 20 }, (_unused, position) => 7 + position * 13));
const NAMES_PER_WORLD = 80;
const NON_BREAKING_SPACE = ' ';
const DECOMPOSED_SHORT_I = 'й';
const SAMPLE_NAMES = [
  'Silpo Market 12',
  'ATB 0212',
  'ATB',
  'ATB Market',
  'АТБ 0212',
  'ATB #0212',
  'ATB № 0212',
  'ATB - 0212',
  'ATB-0212',
  '7-Eleven',
  '7-Eleven 0212',
  '7 11',
  'BP 1234',
  '0212',
  'ATB 0212 Kyiv',
  'Top up 1',
  'Рахунок створений автоматично для поповнення балансу 380670000000',
  'Visa Signature 4111xxxxxxx1111',
  '537541******1234',
  'Виведення кешбеку 464.40₴',
  'WFP.OPENDATABOTM',
  '   ',
];
const WORDS = [
  'ATB',
  'Silpo',
  'Market',
  'Сільпо',
  'АТБ',
  'KFC',
  'BP',
  '7-Eleven',
  'İstanbul',
  'ΣΑΣ',
  `${DECOMPOSED_SHORT_I}ога`,
  'Kyiv',
];
const MARKERS = ['#', '№', '-'];
const SPACINGS = [' ', '  ', NON_BREAKING_SPACE, ` ${NON_BREAKING_SPACE}`];

const pickFrom = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const generatedNameOf = (random: Random): string => {
  const words = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pickFrom(random, WORDS));
  const marker = random() < 0.3 ? pickFrom(random, MARKERS) : '';
  const number = String(Math.floor(random() * 10 ** (1 + Math.floor(random() * 7))));
  const suffix = random() < 0.7 ? [`${marker}${number}`] : [];
  const cased = random() < 0.3 ? words.map((word) => word.toUpperCase()) : words;

  return [...cased, ...suffix].join(pickFrom(random, SPACINGS));
};

const worldOf = (seed: number): ReviewCandidate[] => {
  // The first draw of this generator on a seed this small is near zero, so every plain seed would
  // draw the same first name; the spread seed draws different worlds.
  const random = seededRandom(seed * SEED_SPREAD);
  const drawn = Array.from({ length: NAMES_PER_WORLD }, () => generatedNameOf(random));

  return rowsOf([...SAMPLE_NAMES, ...drawn]);
};

const groupRuleMatches = (group: ReviewGroup, row: ReviewCandidate): boolean => {
  const [rule] = prepareRules([
    ruleRow({ matchers: [{ type: group.rule.kind, text: group.rule.text }] }),
  ]).ordered;

  return rule !== undefined && matchesRule(rule, subjectOfStoredRow(row));
};

describe('every listed row matches its group rule', () => {
  it.each(SEEDS)('holds for every group of the world of seed %s', (seed) => {
    const rows = worldOf(seed);
    const groups = plan(rows);
    const listed = rows.filter((row) => merchantNameOf(row.description).key !== '');

    expect(groups.reduce((total, group) => total + group.rowCount, 0)).toBe(listed.length);

    for (const group of groups) {
      const members = listed.filter((row) => merchantNameOf(row.description).key === group.key);

      expect(members).toHaveLength(group.rowCount);
      expect(members.filter((row) => !groupRuleMatches(group, row))).toEqual([]);
    }

    expect(groups.some((group) => group.rule.kind === 'nameStartsWith')).toBe(true);
    expect(groups.some((group) => group.rule.kind === 'nameIs')).toBe(true);
  });

  it('draws worlds that differ from each other', () => {
    const worlds = SEEDS.map((seed) =>
      worldOf(seed)
        .map((row) => row.description)
        .join('|'),
    );

    expect(new Set(worlds).size).toBe(SEEDS.length);
  });
});
