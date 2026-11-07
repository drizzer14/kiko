import maybe, { foldMap } from 'fnts/maybe';
import {
  CARD_SWITCH_EXTRAS,
  type LedgerRow,
  cardSwitchLedger,
  ledgerOf,
  monthly,
  nowOf,
  shuffled,
  weekly,
} from '@kiko/test-support/recurring-ledger';
import type { Currency } from '@kiko/currency/currency';
import { sweep } from '@kiko/test-support/property-sweep';
import { chargeGroupsOf, seriesOfGroups } from '@kiko/recurring/detection';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { cardSwitchesJoinedOf } from './card-switch';

type Month = readonly [year: number, month: number];

type Shown = { id: string; currency: Currency; partIds?: string[] };

const NOW = nowOf();

const worldOf = (rows: readonly LedgerRow[]) => {
  const groups = chargeGroupsOf(ledgerOf(rows, CARD_SWITCH_EXTRAS), NOW);

  return { groups, detected: seriesOfGroups(groups, NOW) };
};

const paid = (
  prefix: string,
  holdingId: string,
  count: number,
  newest: Month,
  shape: { amount?: number; day?: number; hour?: number; minute?: number } = {},
): LedgerRow[] =>
  monthly(count, shape.day ?? 15, shape.amount ?? 10, {
    newest,
    prefix,
    holdingId,
    hour: shape.hour,
    minute: shape.minute,
  });

const shownOf = (series: ReturnType<typeof cardSwitchesJoinedOf>): Shown[] =>
  series.map(({ id, currency, parts }) => ({
    id,
    currency,
    ...foldMap(maybe(parts), (found) => ({ partIds: found.map((part) => part.id) })),
  }));

const WORLDS: { title: string; rows: LedgerRow[]; detected: number; shown: Shown[] }[] = [
  {
    title: 'a card switch: the UAH part stopped in May, the USD part began in June',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400 }),
      ...paid('usd', 'usd', 5, [2026, 10]),
    ],
    detected: 2,
    shown: [{ id: 'uah-4', currency: 'USD', partIds: ['usd-4', 'uah-4'] }],
  },
  {
    title: 'a gap of one local day',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400 }),
      ...paid('usd', 'usd', 5, [2026, 9], { day: 16 }),
    ],
    detected: 2,
    shown: [{ id: 'uah-4', currency: 'USD', partIds: ['usd-4', 'uah-4'] }],
  },
  {
    title: 'the same local day, which counts as an overlap',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400, hour: 9, minute: 0 }),
      ...paid('usd', 'usd', 5, [2026, 9], { hour: 18, minute: 0 }),
    ],
    detected: 2,
    shown: [
      { id: 'usd-4', currency: 'USD' },
      { id: 'uah-4', currency: 'UAH' },
    ],
  },
  {
    title: 'the same local day on two UTC days, which counts as an overlap',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400, hour: 2, minute: 0 }),
      ...paid('usd', 'usd', 5, [2026, 9], { hour: 10, minute: 0 }),
    ],
    detected: 2,
    shown: [
      { id: 'usd-4', currency: 'USD' },
      { id: 'uah-4', currency: 'UAH' },
    ],
  },
  {
    title: 'two local days on one UTC day, which join',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400, hour: 10, minute: 0 }),
      ...paid('usd', 'usd', 5, [2026, 9], { day: 16, hour: 2, minute: 0 }),
    ],
    detected: 2,
    shown: [{ id: 'uah-4', currency: 'USD', partIds: ['usd-4', 'uah-4'] }],
  },
  {
    title: 'an overlap of June and July',
    rows: [
      ...paid('uah', 'card', 7, [2026, 7], { amount: 400 }),
      ...paid('usd', 'usd', 5, [2026, 10]),
    ],
    detected: 2,
    shown: [
      { id: 'usd-4', currency: 'USD' },
      { id: 'uah-6', currency: 'UAH' },
    ],
  },
  {
    title: 'three currencies, none overlapping: one row of three parts',
    rows: [
      ...paid('uah', 'card', 5, [2024, 12], { amount: 400 }),
      ...paid('usd', 'usd', 5, [2025, 12]),
      ...paid('eur', 'eur', 5, [2026, 7]),
    ],
    detected: 3,
    shown: [{ id: 'uah-4', currency: 'EUR', partIds: ['eur-4', 'usd-4', 'uah-4'] }],
  },
  {
    title: 'three currencies with one overlap: all three apart',
    rows: [
      ...paid('uah', 'card', 5, [2024, 12], { amount: 400 }),
      ...paid('usd', 'usd', 5, [2025, 12]),
      ...paid('eur', 'eur', 5, [2026, 3]),
    ],
    detected: 3,
    shown: [
      { id: 'eur-4', currency: 'EUR' },
      { id: 'usd-4', currency: 'USD' },
      { id: 'uah-4', currency: 'UAH' },
    ],
  },
  {
    title: 'two series in one currency: nothing joins',
    rows: [
      ...paid('low', 'card', 5, [2026, 5], { amount: 100 }),
      ...paid('high', 'card', 5, [2026, 5], { amount: 300, day: 20 }),
      ...paid('usd', 'usd', 5, [2026, 10]),
    ],
    detected: 3,
    shown: [
      { id: 'usd-4', currency: 'USD' },
      { id: 'high-4', currency: 'UAH' },
      { id: 'low-4', currency: 'UAH' },
    ],
  },
  {
    title: 'two periods: a weekly series does not join a monthly one',
    rows: [
      ...paid('uah', 'card', 5, [2026, 5], { amount: 400 }),
      ...weekly(8, [2026, 10, 15], 10, { prefix: 'week', holdingId: 'usd' }),
    ],
    detected: 2,
    shown: [
      { id: 'week-7', currency: 'USD' },
      { id: 'uah-4', currency: 'UAH' },
    ],
  },
];

describe('cardSwitchesJoinedOf', () => {
  it.each(WORLDS)('$title', ({ rows, detected, shown }) => {
    const world = worldOf(rows);

    expect(world.detected).toHaveLength(detected);
    expect(shownOf(cardSwitchesJoinedOf(world.detected, world.groups))).toEqual(shown);
  });

  it('gives the joined row the fields of its newest part and the charges of every part', () => {
    const world = worldOf(cardSwitchLedger().rows);
    const [row] = cardSwitchesJoinedOf(world.detected, world.groups);
    const newest = world.detected.find(({ currency }) => currency === 'USD');

    expect(row).toMatchObject({
      id: 'uah-4',
      merchantKey: 'netflix',
      name: 'Netflix',
      currency: 'USD',
      period: 'monthly',
      lastChargeTime: newest?.lastChargeTime,
      lastChargeAmountMinorUnits: 1_000,
      lastChargeHoldingId: 'usd',
      isStopped: false,
    });
    expect(row?.chargeIds).toEqual([
      ...['usd-0', 'usd-1', 'usd-2', 'usd-3', 'usd-4'],
      ...['uah-0', 'uah-1', 'uah-2', 'uah-3', 'uah-4'],
    ]);
    expect(row?.parts?.map(({ currency, chargeIds }) => [currency, chargeIds.length])).toEqual([
      ['USD', 5],
      ['UAH', 5],
    ]);
    expect(row).not.toHaveProperty('marks');
    expect(row).not.toHaveProperty('markedSpan');
  });
});

const SEEDS = Array.from({ length: 24 }, (_unused, index) => (index + 1) * 7_919);

const HOLDING_OF_PREFIX = [
  ['uah', 'card'],
  ['usd', 'usd'],
  ['eur', 'eur'],
] as const;

const NEWEST_MONTH_INDEX = 2026 * 12 + 9;

const monthOfIndex = (index: number): Month => [Math.floor(index / 12), (index % 12) + 1];

// Two or three currencies of one name, each a run of three to five months, laid end to end from
// the newest backwards: a part ends a month or two before the next begins (a card switch), or
// one in four ends in the month the next begins (an overlap), so most seeds join.
const randomRowsOf = (random: Random): LedgerRow[] => {
  const currencies = HOLDING_OF_PREFIX.slice(0, 2 + Math.floor(random() * 2));
  let end = NEWEST_MONTH_INDEX - Math.floor(random() * 3);

  return currencies
    .map(() => {
      const count = 3 + Math.floor(random() * 3);
      const newest = end;

      end = newest - count + 1 - (random() < 0.25 ? -1 : 1 + Math.floor(random() * 2));

      return { count, newest };
    })
    .reverse()
    .flatMap(({ count, newest }, index) => {
      const [prefix, holdingId] = HOLDING_OF_PREFIX[index];

      return paid(prefix, holdingId, count, monthOfIndex(newest));
    });
};

describe('cardSwitchesJoinedOf, over random worlds', () => {
  it.each(sweep(SEEDS))('gives the same rows for any input order (seed %s)', (seed) => {
    const random = seededRandom(seed);
    const world = worldOf(randomRowsOf(random));
    const joined = cardSwitchesJoinedOf(world.detected, world.groups);

    expect(cardSwitchesJoinedOf(shuffled(world.detected, random), world.groups)).toEqual(joined);
    expect(cardSwitchesJoinedOf([...world.detected].reverse(), world.groups)).toEqual(joined);
  });

  it.each(sweep(SEEDS))(
    'shows every charge of the input once, and no charge in two rows (seed %s)',
    (seed) => {
      const world = worldOf(randomRowsOf(seededRandom(seed)));
      const shownIds = cardSwitchesJoinedOf(world.detected, world.groups)
        .flatMap(({ chargeIds }) => chargeIds)
        .sort();

      expect(shownIds).toEqual(world.detected.flatMap(({ chargeIds }) => chargeIds).sort());
    },
  );
});
