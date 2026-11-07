import { at } from '@kiko/test-support/recurring-ledger';

import { onePerSlotOf } from './detection';
import type { Charge, RecurringPeriod } from './detection.types.d';

type World = {
  title: string;
  period: RecurringPeriod;
  // Major units, as the marks of a world are written.
  stored: number[];
  kept: Charge[];
  dropped: Charge[];
};

type Month = readonly [year: number, month: number];

const MINOR_UNITS_PER_MAJOR = 100;
const DEFAULT_NEWEST: Month = [2026, 10];

const twoDigits = (value: number): string => String(value).padStart(2, '0');

// The id is the local date, so a row of the table names a charge by the day it sits on.
const charge = (year: number, month: number, day: number, amount: number): Charge => {
  const time = at(year, month, day);
  const date = new Date(time);

  return {
    id: `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`,
    time,
    amount: Math.round(amount * MINOR_UNITS_PER_MAJOR),
    source: 'monobank',
    holdingId: 'card',
    holdingName: 'card',
    description: 'Netflix',
  };
};

const lastDayOf = (year: number, month: number): number => new Date(year, month, 0).getDate();

// Oldest first, the newest in `newest`; a day past a month's end clamps.
const monthlyRun = (
  count: number,
  day: number,
  amount: number,
  [year, newestMonth]: Month = DEFAULT_NEWEST,
): Charge[] =>
  Array.from({ length: count }, (_unused, index) => {
    const month = newestMonth - (count - 1 - index);

    return charge(year, month, Math.min(day, lastDayOf(year, month)), amount);
  });

const chargesOn = (amount: number, ...dates: Array<readonly [number, number, number]>): Charge[] =>
  dates.map(([year, month, day]) => charge(year, month, day, amount));

const splitAt = (
  charges: readonly Charge[],
  keptIndexes: readonly number[],
): Pick<World, 'kept' | 'dropped'> => ({
  kept: charges.filter((_unused, index) => keptIndexes.includes(index)),
  dropped: charges.filter((_unused, index) => !keptIndexes.includes(index)),
});

const FIVES = monthlyRun(6, 5, 100);
const AUGUST_98 = charge(2026, 8, 20, 98);
const OCTOBER_102 = charge(2026, 10, 12, 102);
const TWELVE_FIVES = monthlyRun(12, 5, 100);
const THIRDS = monthlyRun(12, 3, 199);
const BILLS = [
  charge(2026, 1, 3, 1210),
  charge(2026, 2, 10, 1385),
  charge(2026, 3, 3, 1302),
  charge(2026, 4, 25, 1150),
  charge(2026, 5, 12, 1099),
  charge(2026, 6, 2, 1240),
  charge(2026, 7, 20, 1330),
];
const FX_EARLY = [
  charge(2026, 1, 5, 412.35),
  charge(2026, 2, 5, 415.1),
  charge(2026, 3, 6, 409.8),
  charge(2026, 4, 5, 417),
  charge(2026, 5, 5, 413),
];
const FX_TAPPED = charge(2026, 6, 21, 414);
// Apple's 99 on the 5th among purchases that sit in its amount cut but are not near it.
const PURCHASE_DAYS = [3, 9, 17, 22, 28, 2, 11, 19, 25, 7, 13, 21, 27, 1, 16];
const PURCHASE_AMOUNTS = [89, 109, 119, 399, 29];
const PIECE_PURCHASES = PURCHASE_DAYS.map((day, index) =>
  charge(
    2026,
    DEFAULT_NEWEST[1] - index,
    day,
    PURCHASE_AMOUNTS[index % PURCHASE_AMOUNTS.length] ?? 0,
  ),
).filter(({ amount }) => amount >= 8900 && amount <= 11_900);
// Stored 100: 105 sits on the 5 percent line, 105.01 one minor unit past it.
const NEAR_LINE = 105;
const PAST_NEAR_LINE = 105.01;

// Three charges on the 5th at `fifthAmount` against four on the 20th past the line: the 20 Jul
// charge sits 16 days before 5 Aug, so a run of the fifths can take it too.
const boundaryWorld = (
  title: string,
  fifthAmount: number,
  winner: 'fifths' | 'twentieths',
): World => {
  const fifths = monthlyRun(3, 5, fifthAmount);
  const twentieths = monthlyRun(4, 20, PAST_NEAR_LINE);

  return {
    title,
    period: 'monthly',
    stored: [100],
    ...(winner === 'fifths'
      ? { kept: [...twentieths.slice(0, 1), ...fifths], dropped: twentieths.slice(1) }
      : { kept: twentieths, dropped: fifths }),
  };
};

// Two charges this many days apart stay; one day closer, the later one stays alone.
const FLOORS: Array<[RecurringPeriod, number]> = [
  ['weekly', 4],
  ['monthly', 16],
  ['everyThreeMonths', 46],
  ['everySixMonths', 92],
  ['yearly', 183],
];

const floorWorlds = (): World[] =>
  FLOORS.flatMap(([period, gap]): World[] => [
    {
      title: `${period}: two charges ${gap} days apart both stay`,
      period,
      stored: [100],
      kept: [charge(2026, 1, 1, 100), charge(2026, 1, 1 + gap, 100)],
      dropped: [],
    },
    {
      title: `${period}: two charges ${gap - 1} days apart keep the later one`,
      period,
      stored: [100],
      kept: [charge(2026, 1, gap, 100)],
      dropped: [charge(2026, 1, 1, 100)],
    },
  ]);

const WORLDS: World[] = [
  {
    title: 'world A marked at 100: the 98 and the 102 drop',
    period: 'monthly',
    stored: [100],
    kept: FIVES,
    dropped: [AUGUST_98, OCTOBER_102],
  },
  {
    title: 'world A marked at 98: the tapped 98 drops with the 102',
    period: 'monthly',
    stored: [98],
    kept: FIVES,
    dropped: [AUGUST_98, OCTOBER_102],
  },
  {
    title: 'world A marked at 102: the tapped 102 drops with the 98',
    period: 'monthly',
    stored: [102],
    kept: FIVES,
    dropped: [AUGUST_98, OCTOBER_102],
  },
  {
    title: 'world B: a 98 in one of twelve months drops',
    period: 'monthly',
    stored: [100],
    kept: TWELVE_FIVES,
    dropped: [AUGUST_98],
  },
  {
    title: 'world C: a 100 on the 20th, 15 days after the 5th, drops',
    period: 'monthly',
    stored: [100],
    kept: monthlyRun(3, 5, 100),
    dropped: [charge(2026, 10, 20, 100)],
  },
  {
    title: 'world D: a second run at 98 on the 20th drops whole',
    period: 'monthly',
    stored: [100],
    kept: TWELVE_FIVES,
    dropped: monthlyRun(12, 20, 98),
  },
  {
    title: 'a due date drifting at a month end keeps every charge',
    period: 'monthly',
    stored: [100],
    kept: chargesOn(100, [2026, 6, 30], [2026, 7, 31], [2026, 9, 1], [2026, 9, 30], [2026, 10, 31]),
    dropped: [],
  },
  {
    title: 'a billing day moved from the 5th to the 20th keeps every charge',
    period: 'monthly',
    stored: [100],
    kept: [...monthlyRun(6, 5, 100, [2026, 6]), ...monthlyRun(6, 20, 100, [2026, 12])],
    dropped: [],
  },
  {
    title: 'a billing day moved from the 20th to the 5th drops the 20th 15 days before it',
    period: 'monthly',
    stored: [100],
    kept: [...monthlyRun(5, 20, 100, [2026, 5]), ...monthlyRun(6, 5, 100, [2026, 12])],
    dropped: [charge(2026, 6, 20, 100)],
  },
  {
    title: 'a billing day moved from the 20th to the 6th keeps the 16-day gap',
    period: 'monthly',
    stored: [100],
    kept: [...monthlyRun(6, 20, 100, [2026, 6]), ...monthlyRun(6, 6, 100, [2026, 12])],
    dropped: [],
  },
  ...[1150, 1385, 1099].map(
    (tapped): World => ({
      title: `bills 17 days apart and more all stay, marked at ${tapped}`,
      period: 'monthly',
      stored: [tapped],
      kept: BILLS,
      dropped: [],
    }),
  ),
  {
    title: 'an FX series: the tapped charge 16 days late drops beside the next one on its day',
    period: 'monthly',
    stored: [414],
    kept: [...FX_EARLY, charge(2026, 7, 5, 414.5)],
    dropped: [FX_TAPPED],
  },
  {
    title: 'twelve charges on the last day of each month all stay',
    period: 'monthly',
    stored: [100],
    kept: monthlyRun(12, 31, 100),
    dropped: [],
  },
  {
    title: 'weekend shifts of a due date all stay',
    period: 'monthly',
    stored: [100],
    kept: chargesOn(
      100,
      [2026, 1, 30],
      [2026, 3, 2],
      [2026, 3, 31],
      [2026, 4, 30],
      [2026, 6, 1],
      [2026, 6, 30],
    ),
    dropped: [],
  },
  {
    title: 'a paused month costs nothing',
    period: 'monthly',
    stored: [100],
    kept: chargesOn(
      100,
      [2026, 1, 10],
      [2026, 2, 10],
      [2026, 3, 10],
      [2026, 5, 10],
      [2026, 6, 10],
      [2026, 7, 10],
    ),
    dropped: [],
  },
  {
    title: 'weekly charges 6 to 8 days apart all stay',
    period: 'weekly',
    stored: [10],
    kept: chargesOn(10, [2026, 1, 5], [2026, 1, 12], [2026, 1, 20], [2026, 1, 26], [2026, 2, 2]),
    dropped: [],
  },
  {
    title: 'twelve monthly charges marked yearly keep the first and the last',
    period: 'yearly',
    stored: [199],
    ...splitAt(THIRDS, [0, 11]),
  },
  {
    title: 'the same twelve marked every 6 months keep four, 92 days or more apart',
    period: 'everySixMonths',
    stored: [199],
    ...splitAt(THIRDS, [0, 3, 7, 11]),
  },
  {
    title: '20 Dec and 15 Jan marked yearly keep the later one',
    period: 'yearly',
    stored: [400],
    kept: [charge(2026, 1, 15, 400)],
    dropped: [charge(2025, 12, 20, 400)],
  },
  {
    title: '7 Aug, 7 Sep and 7 Oct every 3 months keep the outer two',
    period: 'everyThreeMonths',
    stored: [130],
    ...splitAt(monthlyRun(3, 7, 130), [0, 2]),
  },
  {
    title: 'Apple 99 x12 among purchases in its cut: every purchase drops',
    period: 'monthly',
    stored: [99],
    kept: monthlyRun(12, 5, 99),
    dropped: PIECE_PURCHASES,
  },
  boundaryWorld(
    'a run on the 5 percent line is near: it beats a longer run past it',
    NEAR_LINE,
    'fifths',
  ),
  boundaryWorld(
    'a run one minor unit past the line is not near: the longer run wins',
    PAST_NEAR_LINE,
    'twentieths',
  ),
  ...floorWorlds(),
];

const oldestFirst = (left: Charge, right: Charge): number =>
  left.time - right.time || left.id.localeCompare(right.id);

const idsOf = (charges: readonly Charge[]): string[] => charges.map(({ id }) => id).sort();

describe('onePerSlotOf', () => {
  it.each(WORLDS)('$title', ({ period, stored, kept, dropped }) => {
    const result = onePerSlotOf(
      [...kept, ...dropped].sort(oldestFirst),
      period,
      stored.map((amount) => Math.round(amount * MINOR_UNITS_PER_MAJOR)),
    );

    expect({ kept: idsOf(result.kept), dropped: idsOf(result.dropped) }).toEqual({
      kept: idsOf(kept),
      dropped: idsOf(dropped),
    });
  });

  it('answers nothing for no charges', () => {
    expect(onePerSlotOf([], 'monthly', [10_000])).toEqual({ kept: [], dropped: [] });
  });
});
