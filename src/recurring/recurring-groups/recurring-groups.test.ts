import maybe, { foldMap } from 'fnts/maybe';
import { Money } from '@kiko/currency/money';
import { convert } from '@kiko/rates/conversion';
import type { Currency } from '@kiko/currency/currency';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import { cardSwitchesJoinedOf } from '@kiko/recurring/card-switch';
import { neutralCategory } from '@kiko/categories/category-display';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import { cardSwitchLedger, nowOf } from '@kiko/test-support/recurring-ledger';
import { categoryColorsLight, entityColorsDark } from '@kiko/design-system/palette';
import { type RecurringSeries, chargeGroupsOf, seriesOfGroups } from '@kiko/recurring/detection';

import {
  type RecurringGroup,
  paidSoFarByCurrencyOf,
  paidSoFarOf,
  recurringGroupsOf,
} from './recurring-groups';

type GroupsInput = Parameters<typeof recurringGroupsOf>[0];

type ChargeRow = GroupsInput['rows'][number];

type CategoryEntry = GroupsInput['categories'][number];

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

const keysOf = (groups: RecurringGroup[]): string[] => groups.map((group) => group.key);

const idsOf = (series: RecurringSeries[]): string[] => series.map((entry) => entry.id);

describe('recurringGroupsOf: the category of a series', () => {
  it('is the newest charge`s, where two charges sit in two categories', () => {
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
        seriesOf('null-category', { lastChargeAmountMinorUnits: 100 }),
        seriesOf('empty-category', { lastChargeAmountMinorUnits: 200 }),
        seriesOf('no-rows', { chargeIds: ['absent'], lastChargeAmountMinorUnits: 50 }),
        seriesOf('stored-under-default', { lastChargeAmountMinorUnits: 400 }),
        seriesOf('in-media', { lastChargeAmountMinorUnits: 800 }),
        seriesOf('in-bills', { lastChargeAmountMinorUnits: 1_600 }),
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
    const { groups } = recurringGroupsOf(worldOf());
    const defaultGroup = groups.find((group) => group.key === 'general');

    expect(keysOf(groups)).toEqual(['media', 'general', 'bills']);
    expect(idsOf(defaultGroup?.series ?? []).sort()).toEqual([
      'empty-category',
      'no-rows',
      'null-category',
      'stored-under-default',
    ]);
    expect(plain(defaultGroup?.total)).toEqual({ currency: 'UAH', minorUnits: 750 });
  });

  it('heads that group with the default`s title, icon and resolved color', () => {
    const defaultGroup = recurringGroupsOf(worldOf()).groups.find(({ key }) => key === 'general');

    expect(defaultGroup).toMatchObject({ title: 'Mango', icon: 'star' });
    expect(defaultGroup?.color).toBe(resolveCategoryColor('#445566', 'general', 'dark'));
  });

  it('paints a group heading through the category map in the light scheme', () => {
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
    const { groups } = recurringGroupsOf(worldOf());

    for (const group of groups) {
      expect(group.key).not.toMatch(/uncategori[sz]ed|^null$|^$/i);
      expect(group.title).not.toBe(neutralCategory().title);
    }
    expect(groups).toHaveLength(3);
  });

  it('puts the default`s group last, with the neutral display, when the categories lack its key', () => {
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
    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [
          seriesOf('general-series', { lastChargeAmountMinorUnits: 50_000 }),
          seriesOf('bills-series', { lastChargeAmountMinorUnits: 90_000 }),
          seriesOf('media-series', { lastChargeAmountMinorUnits: 10_000 }),
        ],
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
    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [
          seriesOf('shown-series', {
            chargeIds: ['shown-series-charge', 'shown-series-older'],
            lastChargeAmountMinorUnits: 100,
          }),
        ],
        rows: [
          rowOf('shown-series-charge', -100, 'media'),
          rowOf('shown-series-older', -60, 'media'),
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
  it('adds the last charge of a series of three charges to its group, not the three', () => {
    const series = seriesOf('netflix', {
      chargeIds: ['newest', 'middle', 'oldest'],
      lastChargeAmountMinorUnits: 300,
    });

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [series],
        rows: [
          rowOf('newest', -300, 'media'),
          rowOf('middle', -200, 'media'),
          rowOf('oldest', -100, 'media'),
        ],
      }),
    );

    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 300 });
  });

  it('counts `lastChargeAmountMinorUnits` when the newest row is missing from the rows', () => {
    const series = seriesOf('netflix', {
      chargeIds: ['missing', 'middle', 'oldest'],
      lastChargeAmountMinorUnits: 300,
    });

    const { groups } = recurringGroupsOf(
      inputOf({
        shown: [series],
        rows: [rowOf('middle', -200, 'media'), rowOf('oldest', -150, 'media')],
      }),
    );

    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 300 });
  });

  it('converts the last charge of a USD series once, at the rate table, and adds Money', () => {
    const series = seriesOf('spotify', {
      currency: 'USD',
      chargeIds: ['cent-2', 'cent-1'],
      lastChargeAmountMinorUnits: 3,
    });

    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [seriesOf('netflix', { lastChargeAmountMinorUnits: 5_000 }), series],
        rows: [
          rowOf('netflix-charge', -5_000, 'media'),
          rowOf('cent-2', -1, 'media', 'USD'),
          rowOf('cent-1', -1, 'media', 'USD'),
        ],
      }),
    );
    const expected = Money.of('UAH', 5_000).add(convert(Money.of('USD', 3), 'UAH', RATE_TABLE));

    expect(plain(groups[0].total)).toEqual(plain(expected));
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 5_121 });
    expect(idsOf(groups[0].series).sort()).toEqual(['netflix', 'spotify']);
  });

  it('counts the last charge of a stopped series', () => {
    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [
          seriesOf('netflix', { lastChargeAmountMinorUnits: 5_000 }),
          seriesOf('old-gym', { isStopped: true, lastChargeAmountMinorUnits: 700 }),
        ],
        rows: [rowOf('netflix-charge', -5_000, 'media'), rowOf('old-gym-charge', -700, 'media')],
      }),
    );

    expect(plain(groups[0].total)).toEqual({ currency: 'UAH', minorUnits: 5_700 });
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 5_700 });
  });

  it('makes the total of all the sum of the group totals', () => {
    const shown = [
      seriesOf('media-usd-first', { currency: 'USD', lastChargeAmountMinorUnits: 1 }),
      seriesOf('media-usd-second', { currency: 'USD', lastChargeAmountMinorUnits: 1 }),
      seriesOf('bills-usd', { currency: 'USD', lastChargeAmountMinorUnits: 1 }),
      seriesOf('general-uah', { lastChargeAmountMinorUnits: 300 }),
    ];

    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown,
        rows: [
          rowOf('media-usd-first-charge', -1, 'media', 'USD'),
          rowOf('media-usd-second-charge', -1, 'media', 'USD'),
          rowOf('bills-usd-charge', -1, 'bills', 'USD'),
          rowOf('general-uah-charge', -300, 'general'),
        ],
      }),
    );

    expect(groups.map((group) => group.total.minorUnits)).toEqual([80, 40, 300]);
    expect(plain(total)).toEqual({
      currency: 'UAH',
      minorUnits: groups.reduce((sum, group) => sum + group.total.minorUnits, 0),
    });
    expect(total?.minorUnits).toBe(420);
  });

  it('leaves a currency the rate table cannot convert out of the totals, its series still listed', () => {
    const { groups, total } = recurringGroupsOf(
      inputOf({
        shown: [
          seriesOf('netflix', { lastChargeAmountMinorUnits: 5_000 }),
          seriesOf('coin-subscription', { currency: 'BTC', lastChargeAmountMinorUnits: 100_000 }),
        ],
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
    const result = recurringGroupsOf(inputOf({ rows: [rowOf('orphan', -100, 'media')] }));

    expect(result.groups).toEqual([]);
    expect(result.total).toBeUndefined();
  });
});

describe('paidSoFarOf', () => {
  it('sums the listed rows in the series currency, skipping a row of another currency', () => {
    const series = seriesOf('spotify', { currency: 'USD', chargeIds: ['a', 'b', 'c'] });

    const paid = paidSoFarOf(series, [
      rowOf('a', -999, 'media', 'USD'),
      rowOf('b', -1_001, 'media', 'USD'),
      rowOf('c', -5_000, 'media', 'UAH'),
    ]);

    expect(plain(paid)).toEqual({ currency: 'USD', minorUnits: 2_000 });
  });

  it('is zero in the series currency with no rows', () => {
    expect(plain(paidSoFarOf(seriesOf('netflix'), []))).toEqual({
      currency: 'UAH',
      minorUnits: 0,
    });
  });

  it('takes the series and the rows, and no rate table', () => {
    expect(paidSoFarOf.length).toBe(2);
  });
});

describe('a card switch between currencies', () => {
  const ledger = cardSwitchLedger();
  const groups = chargeGroupsOf(ledger, nowOf());
  const shown = cardSwitchesJoinedOf(seriesOfGroups(groups, nowOf()), groups);
  const currencyOfHolding = new Map(ledger.holdings.map(({ id, currency }) => [id, currency]));
  const rows = ledger.rows.map(({ id, holdingId, amountMinorUnits }) =>
    rowOf(id, amountMinorUnits, 'media', currencyOfHolding.get(holdingId) ?? 'UAH'),
  );
  // 1 USD is 41.50 UAH: the 10.00 USD last charge is 415.00 UAH, the 400.00 UAH one is 400.00.
  const rateTable = buildRateTable([{ base: 'USD', quote: 'UAH', rate: '41.5' }]);

  it('counts a joined row once, by its newest part`s last charge, in its group and in the total', () => {
    const { groups: shownGroups, total } = recurringGroupsOf(inputOf({ shown, rows, rateTable }));

    expect(idsOf(shownGroups[0].series)).toHaveLength(1);
    expect(plain(shownGroups[0].total)).toEqual({ currency: 'UAH', minorUnits: 41_500 });
    expect(plain(total)).toEqual({ currency: 'UAH', minorUnits: 41_500 });
  });

  it('gives one paid figure per currency, newest part first', () => {
    expect(paidSoFarByCurrencyOf(shown[0], rows).map(plain)).toEqual([
      { currency: 'USD', minorUnits: 5_000 },
      { currency: 'UAH', minorUnits: 200_000 },
    ]);
  });

  it('gives one figure for a series with no parts, as `paidSoFarOf` does', () => {
    const series = seriesOf('spotify', { currency: 'USD', chargeIds: ['a', 'b'] });
    const spotifyRows = [rowOf('a', -999, 'media', 'USD'), rowOf('b', -1_001, 'media', 'USD')];

    expect(paidSoFarByCurrencyOf(series, spotifyRows).map(plain)).toEqual([
      { currency: 'USD', minorUnits: 2_000 },
    ]);
  });
});
