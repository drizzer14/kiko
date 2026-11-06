import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { convert } from '@kiko/rates/conversion';
import type { Currency } from '@kiko/currency/currency';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import type { RecurringSeries } from '@kiko/recurring/detection';
import { neutralCategory } from '@kiko/categories/category-display';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { categoryColorsLight, entityColorsDark } from '@kiko/design-system/palette';

type ChargeRow = {
  id: string;
  amountMinorUnits: number;
  currency: Currency;
  category: string | null;
};

type CategoryEntry = { key: string; title: string; icon: string; color: string | null };

type GroupsInput = {
  shown: RecurringSeries[];
  rows: ChargeRow[];
  categories: CategoryEntry[];
  defaultCategoryKey: string;
  baseCurrency: Currency;
  rateTable: ReturnType<typeof buildRateTable>;
  scheme: 'dark' | 'light';
};

type Group = {
  key: string;
  title: string;
  icon: string;
  color: string;
  series: RecurringSeries[];
  total: Money;
};

type GroupsModule = {
  recurringGroupsOf: (input: GroupsInput) => { groups: Group[]; total: Money | undefined };
  paidSoFarOf: (series: RecurringSeries, rows: ChargeRow[]) => Money;
};

// A runtime lookup, per test, so each pin fails by itself while the module is missing and the file
// still typechecks.
const groupsModule = (): GroupsModule => jest.requireActual('./recurring-groups');

const CATEGORIES: CategoryEntry[] = [
  { key: 'media', title: 'Zebra', icon: 'tv', color: '#112233' },
  { key: 'bills', title: 'Apple', icon: 'bolt', color: null },
  { key: 'general', title: 'Mango', icon: 'star', color: '#445566' },
];

// 1 cent of USD is 40.4 minor units of UAH: one conversion of three cents gives 121, three of one
// cent give 120.
const RATE_TABLE = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '40.4' }]);

const seriesOf = (id: string, overrides: Partial<RecurringSeries> = {}): RecurringSeries => ({
  id,
  merchantKey: id,
  name: id,
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'none' },
  chargeIds: [`${id}-charge`],
  lastChargeTime: 1_000,
  lastChargeAmountMinorUnits: 0,
  lastChargeHoldingId: 'card',
  isStopped: false,
  quiet: null,
  ...overrides,
});

const rowOf = (
  id: string,
  amountMinorUnits: number,
  category: string | null,
  currency: Currency = 'UAH',
): ChargeRow => ({ id, amountMinorUnits, currency, category });

const inputOf = (overrides: Partial<GroupsInput>): GroupsInput => ({
  shown: [],
  rows: [],
  categories: CATEGORIES,
  defaultCategoryKey: 'general',
  baseCurrency: 'UAH',
  rateTable: RATE_TABLE,
  scheme: 'dark',
  ...overrides,
});

const plain = (money: Money | undefined): { currency: Currency; minorUnits: number } | undefined =>
  foldMap(maybe(money), ({ currency, minorUnits }) => ({ currency, minorUnits }));

const keysOf = (groups: Group[]): string[] => groups.map((group) => group.key);

const idsOf = (series: RecurringSeries[]): string[] => series.map((entry) => entry.id);

describe('recurringGroupsOf: the category of a series', () => {
  it('is the newest charge`s, where two charges sit in two categories', () => {
    const { recurringGroupsOf } = groupsModule();
    const series = seriesOf('netflix', { chargeIds: ['newer', 'older'] });

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [series],
        rows: [rowOf('newer', -100, 'media'), rowOf('older', -100, 'bills')],
      }),
    );

    expect(keysOf(groups)).toEqual(['media']);
  });

  it('takes the next id found when the newest row is not in the rows', () => {
    const { recurringGroupsOf } = groupsModule();
    const series = seriesOf('netflix', { chargeIds: ['newest', 'next', 'oldest'] });

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [series],
        rows: [rowOf('oldest', -100, 'general'), rowOf('next', -100, 'bills')],
      }),
    );

    expect(keysOf(groups)).toEqual(['bills']);
  });

  it('folds an unknown slug to the default category, and reads a slug in any case', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('lost'), seriesOf('loud')],
        rows: [rowOf('lost-charge', -100, 'deleted-slug'), rowOf('loud-charge', -100, 'MEDIA')],
      }),
    );

    expect(keysOf(groups)).toEqual(['media', 'general']);
    expect(idsOf(groups[1].series)).toEqual(['lost']);
  });
});

describe('recurringGroupsOf: the default category group (no "Uncategorized" group)', () => {
  const worldOf = (): GroupsInput =>
    inputOf({
      shown: [
        seriesOf('null-category'),
        seriesOf('empty-category'),
        seriesOf('no-rows', { chargeIds: ['absent'] }),
        seriesOf('stored-under-default'),
        seriesOf('in-media'),
        seriesOf('in-bills'),
      ],
      rows: [
        rowOf('null-category-charge', -100, null),
        rowOf('empty-category-charge', -200, ''),
        rowOf('stored-under-default-charge', -400, 'general'),
        rowOf('in-media-charge', -800, 'media'),
        rowOf('in-bills-charge', -1_600, 'bills'),
      ],
      categories: [CATEGORIES[0], CATEGORIES[2], CATEGORIES[1]],
    });

  it('puts a null, an empty and a rowless series beside the default`s own in one group', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups } = recurringGroupsOf(worldOf());
    const defaultGroup = groups.find((group) => group.key === 'general');

    expect(keysOf(groups)).toEqual(['media', 'general', 'bills']);
    expect(idsOf(defaultGroup?.series ?? []).sort()).toEqual([
      'empty-category',
      'no-rows',
      'null-category',
      'stored-under-default',
    ]);
    expect(plain(defaultGroup?.total)).toEqual({ currency: 'UAH', minorUnits: 700 });
  });

  it('heads that group with the default`s title, icon and resolved color', () => {
    const { recurringGroupsOf } = groupsModule();

    const defaultGroup = recurringGroupsOf(worldOf()).groups.find(({ key }) => key === 'general');

    expect(defaultGroup).toMatchObject({ title: 'Mango', icon: 'star' });
    expect(defaultGroup?.color).toBe(resolveCategoryColor('#445566', 'general', 'dark'));
  });

  it('paints a group heading through the category map in the light scheme', () => {
    const { recurringGroupsOf } = groupsModule();

    const lightGroup = recurringGroupsOf({
      ...worldOf(),
      categories: CATEGORIES.map((category) =>
        category.key === 'general' ? { ...category, color: entityColorsDark.khaki } : category,
      ),
      scheme: 'light',
    }).groups.find(({ key }) => key === 'general');

    expect(lightGroup?.color).toBe(categoryColorsLight.khaki);
    expect(lightGroup?.color).not.toBe(entityColorsDark.khaki);
  });

  it('names no group "Uncategorized", by key or by title', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups } = recurringGroupsOf(worldOf());

    for (const group of groups) {
      expect(group.key).not.toMatch(/uncategori[sz]ed|^null$|^$/i);
      expect(group.title).not.toBe(neutralCategory().title);
    }
    expect(groups).toHaveLength(3);
  });

  it('puts the default`s group last, with the neutral display, when the categories lack its key', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('no-category'), seriesOf('in-media'), seriesOf('in-bills')],
        rows: [
          rowOf('no-category-charge', -100, null),
          rowOf('in-media-charge', -100, 'media'),
          rowOf('in-bills-charge', -100, 'bills'),
        ],
        categories: [CATEGORIES[0], CATEGORIES[1]],
        defaultCategoryKey: 'aaa-default',
      }),
    );

    expect(keysOf(groups)).toEqual(['media', 'bills', 'aaa-default']);
    expect(groups[2]).toMatchObject({
      title: neutralCategory().title,
      icon: neutralCategory().icon,
    });
  });
});

describe('recurringGroupsOf: the order of groups and of series', () => {
  it('follows the categories, not the totals, the titles or the keys', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('general-series'), seriesOf('bills-series'), seriesOf('media-series')],
        rows: [
          rowOf('general-series-charge', -50_000, 'general'),
          rowOf('bills-series-charge', -90_000, 'bills'),
          rowOf('media-series-charge', -10_000, 'media'),
        ],
      }),
    );

    expect(keysOf(groups)).toEqual(['media', 'bills', 'general']);
    expect(groups.map((group) => group.total.minorUnits)).toEqual([10_000, 90_000, 50_000]);
  });

  it('lists only the shown series, and sums none of the rows of another', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('shown-series')],
        rows: [
          rowOf('shown-series-charge', -100, 'media'),
          rowOf('hidden-series-charge', -9_999, 'media'),
          rowOf('hidden-other-charge', -7_777, 'bills'),
        ],
      }),
    );

    expect(keysOf(groups)).toEqual(['media']);
    expect(idsOf(groups[0].series)).toEqual(['shown-series']);
    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 100 });
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 100 });
  });

  it('lists the active series newest first, then the stopped by the same order', () => {
    const { recurringGroupsOf } = groupsModule();
    const shown = [
      seriesOf('stopped-newest', { isStopped: true, lastChargeTime: 900 }),
      seriesOf('active-oldest', { lastChargeTime: 100 }),
      seriesOf('tie-second', { merchantKey: 'e-key', lastChargeTime: 500 }),
      seriesOf('stopped-older', { isStopped: true, lastChargeTime: 200 }),
      seriesOf('tie-first', { merchantKey: 'c-key', lastChargeTime: 500 }),
      seriesOf('same-key-b', { merchantKey: 'd-key', lastChargeTime: 300 }),
      seriesOf('same-key-a', { merchantKey: 'd-key', lastChargeTime: 300 }),
    ];

    const { groups } = recurringGroupsOf(
      inputOf({
        shown,
        rows: shown.map(({ id }) => rowOf(`${id}-charge`, -100, 'media')),
      }),
    );

    expect(idsOf(groups[0].series)).toEqual([
      'tie-first',
      'tie-second',
      'same-key-a',
      'same-key-b',
      'active-oldest',
      'stopped-newest',
      'stopped-older',
    ]);
  });
});

describe('recurringGroupsOf: the totals', () => {
  it('sums `-amountMinorUnits` over the rows of a series, skipping a row of another currency', () => {
    const { recurringGroupsOf } = groupsModule();
    const series = seriesOf('netflix', { chargeIds: ['a', 'b', 'c'] });

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [series],
        rows: [
          rowOf('a', -1_000, 'media'),
          rowOf('b', -2_500, 'media'),
          rowOf('c', -777, 'media', 'USD'),
        ],
      }),
    );

    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 3_500 });
  });

  describe('with a UAH and a USD series in one group', () => {
    const usdSeries = seriesOf('spotify', {
      currency: 'USD',
      chargeIds: ['cent-1', 'cent-2', 'cent-3'],
    });
    const worldOf = (): GroupsInput =>
      inputOf({
        shown: [seriesOf('netflix'), usdSeries],
        rows: [
          rowOf('netflix-charge', -5_000, 'media'),
          rowOf('cent-1', -1, 'media', 'USD'),
          rowOf('cent-2', -1, 'media', 'USD'),
          rowOf('cent-3', -1, 'media', 'USD'),
        ],
      });

    it('proves the world: converting each row differs from converting the series by one unit', () => {
      const perRow = [1, 1, 1]
        .map((cents) => convert(Money.of('USD', cents), 'UAH', RATE_TABLE).minorUnits)
        .reduce((sum, minorUnits) => sum + minorUnits, 0);

      expect(convert(Money.of('USD', 3), 'UAH', RATE_TABLE).minorUnits).toBe(121);
      expect(perRow).toBe(120);
    });

    it('converts the USD sum once, in the base currency, and adds Money', () => {
      const { recurringGroupsOf } = groupsModule();

      const { groups, total } = recurringGroupsOf(worldOf());

      expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 5_121 });
      expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 5_121 });
    });

    it('keeps both series listed in the group', () => {
      const { recurringGroupsOf } = groupsModule();

      const { groups } = recurringGroupsOf(worldOf());

      expect(idsOf(groups[0].series).sort()).toEqual(['netflix', 'spotify']);
    });
  });

  it('makes the total of all the sum of the group totals', () => {
    const { recurringGroupsOf } = groupsModule();
    const shown = [
      seriesOf('media-usd', { currency: 'USD' }),
      seriesOf('bills-usd', { currency: 'USD' }),
      seriesOf('general-uah'),
    ];

    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown,
        rows: [
          rowOf('media-usd-charge', -1, 'media', 'USD'),
          rowOf('bills-usd-charge', -1, 'bills', 'USD'),
          rowOf('general-uah-charge', -300, 'general'),
        ],
      }),
    );

    expect(groups.map((group) => group.total.minorUnits)).toEqual([40, 40, 300]);
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 380 });
  });

  it('leaves a currency the rate table cannot convert out of the totals, its series still listed', () => {
    const { recurringGroupsOf } = groupsModule();

    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('netflix'), seriesOf('coin-subscription', { currency: 'BTC' })],
        rows: [
          rowOf('netflix-charge', -5_000, 'media'),
          rowOf('coin-subscription-charge', -100_000, 'media', 'BTC'),
        ],
      }),
    );

    expect(idsOf(groups[0].series).sort()).toEqual(['coin-subscription', 'netflix']);
    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 5_000 });
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 5_000 });
  });

  it('gives no group and no total with no shown series', () => {
    const { recurringGroupsOf } = groupsModule();

    const result = recurringGroupsOf(inputOf({ rows: [rowOf('orphan', -100, 'media')] }));

    expect(result.groups).toEqual([]);
    expect(result.total).toBeUndefined();
  });
});

describe('paidSoFarOf', () => {
  it('sums the listed rows in the series currency, skipping a row of another currency', () => {
    const { paidSoFarOf } = groupsModule();
    const series = seriesOf('spotify', { currency: 'USD', chargeIds: ['a', 'b', 'c'] });

    const paid = paidSoFarOf(series, [
      rowOf('a', -999, 'media', 'USD'),
      rowOf('b', -1_001, 'media', 'USD'),
      rowOf('c', -5_000, 'media', 'UAH'),
    ]);

    expect(plain(paid)).toEqual({ currency: 'USD', minorUnits: 2_000 });
  });

  it('is zero in the series currency with no rows', () => {
    const { paidSoFarOf } = groupsModule();

    expect(plain(paidSoFarOf(seriesOf('netflix'), []))).toEqual({
      currency: 'UAH',
      minorUnits: 0,
    });
  });

  it('takes the series and the rows, and no rate table', () => {
    const { paidSoFarOf } = groupsModule();

    expect(paidSoFarOf.length).toBe(2);
  });
});
