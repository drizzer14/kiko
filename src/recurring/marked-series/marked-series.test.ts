import {
  type Charge,
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  foldTwins,
  groupKeyOf,
  amountPiecesOf,
  chargeGroupsOf,
  detectRecurringSeries,
} from '@kiko/recurring/detection';
import { DAY_MS } from '@kiko/dates';
import { minOf } from '@kiko/numbers';
import maybe, { foldMap } from 'fnts/maybe';
import {
  at,
  nowOf,
  timesOf,
  rangeOf,
  ledgerOf,
  chargeOf,
  dayKeyOf,
  shuffled,
  randomLedgerOf,
  type Ledger,
} from '@kiko/test-support/recurring-ledger';
import {
  entryOf,
  outcomeOf,
  chainViewsOf,
  shownViewsOf,
  shownDayViewsOf,
  randomEntriesOf,
  expectedChainViewsOf,
  expectedShownViewsOf,
  type Outcome,
} from '@kiko/test-support/marked-series-world';
import {
  exclusionWorlds,
  ONE_AMOUNT_WORLDS,
  type MarkedWorld,
} from '@kiko/test-support/marked-series-worlds';
import { daysBetween } from '@kiko/holdings/interest';
import { sweep } from '@kiko/test-support/property-sweep';
import { buildRateTable } from '@kiko/rates/net-worth-view';
import type { RecurringMerchantChoice } from '@kiko/settings';
import { rowRecurrenceOf } from '@kiko/recurring/row-recurrence';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';
import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';
import { paidSoFarOf, recurringGroupsOf } from '@kiko/recurring/recurring-groups';
import { AMOUNT_CHAIN_WORLDS } from '@kiko/test-support/marked-series-chain-worlds';
import { isRecurringCandidate, recurringExcludedIds } from '@kiko/recurring/eligibility';

import { type MarkedEntry, markedChainOfAmount as markedChainOfRow } from './marked-series';

const SEED_SPREAD = 104_729;
const AMOUNT_STEP = 1.25;
const DEFAULT_NAME = 'Netflix';
// Two charges in one slot sit less than one step apart; a day of slack covers a daylight shift.
const STEP_REACH_DAYS: Record<RecurringPeriod, number> = {
  weekly: 8,
  monthly: 32,
  everyThreeMonths: 93,
  everySixMonths: 185,
  yearly: 367,
};

// Two kept charges sit more than half a step apart, in whole local days: half of 7, 30.44, 91.31,
// 182.62 and 365.24 days, rounded up.
const MIN_GAP_DAYS: Record<RecurringPeriod, number> = {
  weekly: 4,
  monthly: 16,
  everyThreeMonths: 46,
  everySixMonths: 92,
  yearly: 183,
};

const WORLDS: readonly MarkedWorld[] = [
  ...AMOUNT_CHAIN_WORLDS,
  ...ONE_AMOUNT_WORLDS,
  ...exclusionWorlds(),
];

const entriesOf = (world: MarkedWorld): MarkedEntry[] => [
  entryOf(world.name ?? DEFAULT_NAME, world.marks),
];

const reversedEntries = (entries: readonly MarkedEntry[]): MarkedEntry[] =>
  [...entries].reverse().map((entry) => ({ ...entry, marks: [...entry.marks].reverse() }));

const currencyOfHolding = (ledger: Ledger, holdingId: string): string | undefined =>
  ledger.holdings.find(({ id }) => id === holdingId)?.currency;

const amountOfRow = (ledger: Ledger, rowId: string): number =>
  -(ledger.rows.find(({ id }) => id === rowId)?.amountMinorUnits ?? 0);

const idsOf = (series: readonly RecurringSeries[]): string[] =>
  series.flatMap(({ chargeIds }) => chargeIds);

const shownDetectedOf = (outcome: Outcome): RecurringSeries[] =>
  outcome.shown.filter(({ marks }) => marks === undefined);

const ascending = (left: number, right: number): number => left - right;

describe('the marked matrix', () => {
  describe('the exclusion worlds', () => {
    it.each(exclusionWorlds())('$title: reads as the rule says before any mark', (world) => {
      const { rows, holdings, accounts } = world.ledger();
      const row = rows.find(({ id }) => id === world.rowId);
      const holding = holdings.find(({ id }) => id === row?.holdingId);
      const account = accounts.find(({ id }) => id === holding?.accountId);
      const isCharge =
        row !== undefined &&
        !recurringExcludedIds(rows, holdings, accounts).has(world.rowId) &&
        isRecurringCandidate(row, holding, account);

      expect(isCharge).toBe(!world.isExcluded);
    });
  });

  describe.each(WORLDS)('$title', (world) => {
    it('shows the expected series and chains', () => {
      const outcome = outcomeOf(world.ledger(), entriesOf(world), nowOf());

      expect(shownViewsOf(outcome.shown)).toEqual(expectedShownViewsOf(world.shown));
      expect(chainViewsOf(outcome.withoutCharges)).toEqual(
        expectedChainViewsOf(world.withoutCharges ?? []),
      );
    });

    const noEntryViews = expectedShownViewsOf(
      world.noEntry.map((entry) => ({ ...entry, isMarked: false })),
    );

    it('is detected as its No entry column says', () => {
      expect(shownViewsOf(detectRecurringSeries(world.ledger(), nowOf()))).toEqual(noEntryViews);
    });

    it('with no entry shows the detected series alone', () => {
      const outcome = outcomeOf(world.ledger(), [], nowOf());

      expect(outcome.marked).toEqual([]);
      expect(outcome.withoutCharges).toEqual([]);
      expect(outcome.shown).toEqual(outcome.detected);
      expect(shownViewsOf(outcome.shown)).toEqual(noEntryViews);
    });

    it('gives the same result with the rows shuffled and the marks reordered', () => {
      const ledger = world.ledger();
      const entries = entriesOf(world);
      const original = outcomeOf(ledger, entries, nowOf());

      for (const rows of [
        [...ledger.rows].reverse(),
        shuffled(ledger.rows, seededRandom(SEED_SPREAD)),
      ]) {
        expect(outcomeOf({ ...ledger, rows }, entries, nowOf())).toEqual(original);
      }

      expect(outcomeOf(ledger, reversedEntries(entries), nowOf())).toEqual(original);
    });

    it('gives the same result on a device in a fixed-offset zone', () => {
      const kyiv = outcomeOf(world.ledger(), entriesOf(world), nowOf());
      const fixedOffset = withDeviceZoneOffset(2, () =>
        outcomeOf(world.ledger(), entriesOf(world), nowOf()),
      );

      expect(shownDayViewsOf(fixedOffset.shown)).toEqual(shownDayViewsOf(kyiv.shown));
      expect(chainViewsOf(fixedOffset.withoutCharges)).toEqual(chainViewsOf(kyiv.withoutCharges));
      expect(fixedOffset.shown.map(({ chargeIds }) => chargeIds.length).sort(ascending)).toEqual(
        world.shown.map(({ count }) => count).sort(ascending),
      );
    });

    it('puts no output day after today', () => {
      const todayKey = dayKeyOf(nowOf());
      const outcome = outcomeOf(world.ledger(), entriesOf(world), nowOf());
      const outputKeys = outcome.shown.flatMap(timesOf).map(dayKeyOf);

      expect(outputKeys.filter((key) => key > todayKey)).toEqual([]);
    });
  });
});

const DROPPED_WORLDS = WORLDS.flatMap(
  (world) => foldMap(maybe(world.dropped), (dropped) => [{ world, dropped }]) ?? [],
);

const choicesOf = (world: MarkedWorld): Map<string, RecurringMerchantChoice> =>
  new Map(
    entriesOf(world).map(({ key, name, marks }): [string, RecurringMerchantChoice] => [
      key,
      { name, marks: [...marks] },
    ]),
  );

describe('one charge per period in a marked chain', () => {
  const chargedRowsOf = (ledger: Ledger) =>
    ledger.rows.map(({ id, amountMinorUnits }) => ({
      id,
      amountMinorUnits,
      currency: 'UAH' as const,
      category: null,
    }));

  describe.each(DROPPED_WORLDS)('$world.title', ({ world, dropped }) => {
    const outcome = () => outcomeOf(world.ledger(), entriesOf(world), nowOf());

    it('leaves the dropped rows out of the marked series', () => {
      const rowIds = world.ledger().rows.map(({ id }) => id);

      expect(dropped.rowIds.filter((id) => !rowIds.includes(id))).toEqual([]);
      expect(idsOf(outcome().marked).filter((id) => dropped.rowIds.includes(id))).toEqual([]);
    });

    it('reads "All paid so far" over the kept charges alone', () => {
      const paid = outcome().marked.map(
        (series) => paidSoFarOf(series, chargedRowsOf(world.ledger())).minorUnits,
      );

      expect(paid).toEqual([dropped.paidSoFar * 100]);
    });

    it('adds the last charge of each shown series to the group total', () => {
      const { total } = recurringGroupsOf({
        shown: outcome().shown,
        rows: chargedRowsOf(world.ledger()),
        categories: [{ key: 'general', title: 'General', icon: 'star', color: null }],
        defaultCategoryKey: 'general',
        baseCurrency: 'UAH',
        rateTable: buildRateTable([]),
        scheme: 'dark',
      });
      const lastAmounts = world.shown.map(({ lastAmount }) => lastAmount ?? 0);

      expect(total?.minorUnits).toBe(100 * lastAmounts.reduce((sum, amount) => sum + amount, 0));
    });

    it('reads the form on each dropped row as no marked chain holds it', () => {
      const chargeGroups = chargeGroupsOf(world.ledger(), nowOf());
      const [{ key }] = entriesOf(world);
      const reads = dropped.rowIds.map((rowId) =>
        rowRecurrenceOf({
          chargeGroups,
          key,
          currency: 'UAH',
          rowId,
          choices: choicesOf(world),
          today: nowOf(),
        }),
      );

      expect(reads).toEqual(dropped.rowIds.map(() => dropped.reads));
    });
  });
});

describe('the order of the chains without a charge', () => {
  // Apple's three pieces (two amounts in hryvnias, one in dollars) and ATB's one, with no charge.
  const GHOST_ENTRIES: MarkedEntry[] = [
    entryOf('Apple', [
      ['monthly', 99],
      ['yearly', 499],
      ['everyThreeMonths', 5, 'USD'],
    ]),
    entryOf('ATB', [['weekly', 1]]),
  ];
  const ORDER = [
    ['apple', 'UAH', 9_900],
    ['apple', 'UAH', 49_900],
    ['apple', 'USD', 500],
    ['atb', 'UAH', 100],
  ];

  const orderOf = (entries: readonly MarkedEntry[]) =>
    outcomeOf(ledgerOf([]), entries, nowOf()).withoutCharges.map(({ key, currency, marks }) => [
      key,
      currency,
      marks[0].amountMinorUnits,
    ]);

  it.each([
    ['as given', GHOST_ENTRIES],
    ['reversed', reversedEntries(GHOST_ENTRIES)],
    ['rotated', [...GHOST_ENTRIES.slice(1), ...GHOST_ENTRIES.slice(0, 1)]],
  ])(
    'lists them by key, currency and lowest stored amount, given the entries %s',
    (_title, entries) => {
      expect(orderOf(entries)).toEqual(ORDER);
    },
  );
});

const timeOfRow = (ledger: Ledger, rowId: string): number =>
  ledger.rows.find(({ id }) => id === rowId)?.time ?? 0;

// The charges of a series' piece after the twin fold: the ones it keeps and the ones it drops.
const pieceChargesOf = (ledger: Ledger, series: RecurringSeries): Charge[] => {
  const { lowest, highest } = series.markedSpan ?? { lowest: 0, highest: 0 };
  const group = chargeGroupsOf(ledger, nowOf()).groups.get(
    groupKeyOf(series.merchantKey, series.currency),
  );

  return foldTwins(group?.charges ?? []).filter(
    ({ amount }) => amount >= lowest && amount <= highest,
  );
};

const goneChargesOf = (ledger: Ledger, series: RecurringSeries): Charge[] =>
  pieceChargesOf(ledger, series).filter(({ id }) => !series.chargeIds.includes(id));

const isBesideKept = (ledger: Ledger, series: RecurringSeries, { time }: Charge): boolean =>
  series.chargeIds.some(
    (id) => Math.abs(timeOfRow(ledger, id) - time) <= STEP_REACH_DAYS[series.period] * DAY_MS,
  );

describe('markedSeriesOf over random ledgers and marks', () => {
  // Seeds 1, 13 and 24 (the first, middle and last of 1 to 24) reach no one-mark chain, so
  // the list starts at 3, where the development seeds 3, 15 and 26 reach five.
  const FIRST_SEED = 3;
  const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + FIRST_SEED);
  const SEEDS = sweep(FULL_SEEDS);
  const MIN_PER_RUN = 1;
  const MIN_MARKED_CHAINS_FULL = 24;
  const MIN_MARKED_CHAINS = Math.floor((MIN_MARKED_CHAINS_FULL * SEEDS.length) / FULL_SEEDS.length);

  const worlds = SEEDS.map((seed) => {
    const random = seededRandom(seed * SEED_SPREAD);
    const ledger = randomLedgerOf(random);
    const detected = detectRecurringSeries(ledger, nowOf());

    return { seed, ledger, entries: randomEntriesOf(ledger, detected, random) };
  });
  const outcomes = () =>
    worlds.map((world) => ({
      ...world,
      outcome: outcomeOf(world.ledger, world.entries, nowOf()),
    }));
  const todayKey = dayKeyOf(nowOf());

  it('finds marked series, and detected series that a mark removes', () => {
    const results = outcomes();
    const markedCount = results.flatMap(({ outcome }) => outcome.marked).length;
    const removedCount = results.reduce(
      (total, { outcome }) => total + outcome.detected.length - shownDetectedOf(outcome).length,
      0,
    );

    expect(new Set(worlds.map(({ ledger }) => ledger.rows.length)).size).toBeGreaterThan(1);
    expect(markedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
    expect(removedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  it('puts no output day after today, with rows on every side of it', () => {
    for (const { ledger, outcome } of outcomes()) {
      const sides = ledger.rows.map(({ time }) => Math.sign(dayKeyOf(time) - todayKey));
      const outputKeys = outcome.shown.flatMap(timesOf).map(dayKeyOf);

      expect(sides).toEqual(expect.arrayContaining([-1, 0, 1]));
      expect(outputKeys.filter((key) => key > todayKey)).toEqual([]);
    }
  });

  it('gives a deep-equal result for any row order and any mark order', () => {
    for (const { seed, ledger, entries, outcome } of outcomes()) {
      for (const rows of [
        [...ledger.rows].reverse(),
        shuffled(ledger.rows, seededRandom(seed * SEED_SPREAD)),
      ]) {
        expect(outcomeOf({ ...ledger, rows }, entries, nowOf())).toEqual(outcome);
      }

      const reordered = shuffled(
        entries.map((entry) => ({
          ...entry,
          marks: shuffled(entry.marks, seededRandom(seed * SEED_SPREAD)),
        })),
        seededRandom(seed * SEED_SPREAD),
      );

      expect(outcomeOf(ledger, reordered, nowOf())).toEqual(outcome);
    }
  });

  it('shares no charge between two shown series, marked and detected together', () => {
    for (const { outcome } of outcomes()) {
      const ids = idsOf(outcome.shown);

      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('shows a detected series only when it shares no row with a marked one', () => {
    for (const { outcome } of outcomes()) {
      const markedIds = new Set(idsOf(outcome.marked));
      const standing = outcome.detected.filter(
        ({ chargeIds }) => !chargeIds.some((id) => markedIds.has(id)),
      );

      expect(outcome.detected.every(({ marks }) => marks === undefined)).toBe(true);
      expect(
        shownDetectedOf(outcome)
          .map(({ id }) => id)
          .sort(),
      ).toEqual(standing.map(({ id }) => id).sort());
    }
  });

  it('shows every detected series when there are no marks', () => {
    for (const { ledger } of worlds) {
      const outcome = outcomeOf(ledger, [], nowOf());

      expect(outcome.marked).toEqual([]);
      expect(outcome.shown).toEqual(outcome.detected);
    }
  });

  it('keeps the charges of a marked series in its currency', () => {
    let checkedCount = 0;

    for (const { ledger, outcome } of outcomes()) {
      const holdingByRow = new Map(ledger.rows.map(({ id, holdingId }) => [id, holdingId]));

      for (const series of outcome.marked) {
        const currencies = series.chargeIds.map((id) =>
          currencyOfHolding(ledger, holdingByRow.get(id) ?? ''),
        );

        expect(new Set(currencies)).toEqual(new Set([series.currency]));
        checkedCount += 1;
      }
    }

    expect(checkedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  it('never lets two consecutive amounts of a marked series differ by more than 1.25', () => {
    let pairCount = 0;

    for (const { ledger, outcome } of outcomes()) {
      for (const series of outcome.marked) {
        // The piece holds the dropped charges too: a dropped bridge may leave two kept amounts
        // over 1.25 apart, and a stored amount sits in the cut like a charge.
        const amounts = [
          ...pieceChargesOf(ledger, series).map(({ amount }) => amount),
          ...(series.marks ?? []).map(({ amountMinorUnits }) => amountMinorUnits),
        ].sort(ascending);

        for (const [index, amount] of amounts.slice(1).entries()) {
          expect(amount).toBeLessThanOrEqual((amounts[index] ?? 0) * AMOUNT_STEP);
          pairCount += 1;
        }
      }
    }

    expect(pairCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  it('keeps only amounts of the piece, and drops a charge only beside a kept one', () => {
    let checkedCount = 0;
    let droppedCount = 0;

    for (const { ledger, entries, outcome } of outcomes()) {
      const excludedIds = recurringExcludedIds(ledger.rows, ledger.holdings, ledger.accounts);

      for (const entry of entries) {
        const [mark] = entry.marks;

        if (entry.marks.length !== 1 || mark === undefined) {
          continue;
        }

        const amounts = ledger.rows
          .filter(
            (row) =>
              row.amountMinorUnits < 0 &&
              !excludedIds.has(row.id) &&
              dayKeyOf(row.time) <= todayKey &&
              merchantNameOf(row.description).key === entry.key &&
              currencyOfHolding(ledger, row.holdingId) === mark.currency,
          )
          .map(({ amountMinorUnits }) => -amountMinorUnits);
        const piece = amountPiecesOf(amounts).find((candidate) =>
          candidate.includes(mark.amountMinorUnits),
        );

        if (piece === undefined) {
          continue;
        }

        const holding = outcome.marked.filter(
          (series) => series.merchantKey === entry.key && series.currency === mark.currency,
        );
        const seriesAmounts = holding.flatMap(({ chargeIds }) =>
          chargeIds.map((id) => amountOfRow(ledger, id)),
        );

        expect(holding).toHaveLength(1);
        expect(seriesAmounts.filter((amount) => !piece.includes(amount))).toEqual([]);

        const gone = goneChargesOf(ledger, holding[0]);

        expect(gone.filter((charge) => !isBesideKept(ledger, holding[0], charge))).toEqual([]);
        droppedCount += gone.length;
        checkedCount += 1;
      }
    }

    expect(checkedCount).toBeGreaterThanOrEqual(MIN_MARKED_CHAINS);
    expect(droppedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  const PERIODS: readonly RecurringPeriod[] = [
    'weekly',
    'monthly',
    'everyThreeMonths',
    'everySixMonths',
    'yearly',
  ];
  const DENSE_AMOUNTS = [98, 100, 102, 120];
  const DENSE_MIN_ROWS = 20;
  const DENSE_EXTRA_ROWS = 21;
  const DENSE_SPAN_DAYS = 600;

  // One merchant, rows on random days at four amounts of one amount cut, one random mark: the
  // charges often sit a few days apart at a near or a far amount, which is what the keys decide.
  const denseWorlds = SEEDS.map((seed) => {
    const random = seededRandom(seed * SEED_SPREAD);
    const amountOf = (): number =>
      DENSE_AMOUNTS.at(Math.floor(random() * DENSE_AMOUNTS.length)) ?? DENSE_AMOUNTS[0] ?? 0;
    const period = PERIODS.at(Math.floor(random() * PERIODS.length)) ?? 'monthly';
    const rows = Array.from(
      { length: DENSE_MIN_ROWS + Math.floor(random() * DENSE_EXTRA_ROWS) },
      (_unused, index) =>
        chargeOf(
          `dense-${index}`,
          at(2025, 1, 1 + Math.floor(random() * DENSE_SPAN_DAYS)),
          amountOf(),
        ),
    );

    return {
      seed,
      ledger: ledgerOf(rows),
      entries: [entryOf(DEFAULT_NAME, [[period, amountOf()]])],
    };
  });
  const denseOutcomes = () =>
    denseWorlds.map((world) => ({
      ...world,
      outcome: outcomeOf(world.ledger, world.entries, nowOf()),
    }));

  it('never keeps two charges half a step or less apart', () => {
    let closePairCount = 0;

    for (const { ledger, outcome } of [...outcomes(), ...denseOutcomes()]) {
      for (const series of outcome.marked) {
        const keptDays = series.chargeIds.map((id) => timeOfRow(ledger, id)).sort(ascending);
        const pieceDays = pieceChargesOf(ledger, series)
          .map(({ time }) => time)
          .sort(ascending);

        for (const [index, time] of keptDays.slice(1).entries()) {
          expect(daysBetween(keptDays[index] ?? 0, time)).toBeGreaterThanOrEqual(
            MIN_GAP_DAYS[series.period],
          );
        }

        closePairCount += pieceDays
          .slice(1)
          .filter(
            (time, index) => daysBetween(pieceDays[index] ?? 0, time) < MIN_GAP_DAYS[series.period],
          ).length;
      }
    }

    expect(closePairCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  it('gives a deep-equal result for any input order of a dense ledger', () => {
    for (const { seed, ledger, entries, outcome } of denseOutcomes()) {
      for (const rows of [
        [...ledger.rows].reverse(),
        shuffled(ledger.rows, seededRandom(seed * SEED_SPREAD)),
      ]) {
        expect(outcomeOf({ ...ledger, rows }, entries, nowOf())).toEqual(outcome);
      }
    }

    expect(
      denseOutcomes().filter(
        ({ ledger, outcome }) => idsOf(outcome.marked).length < ledger.rows.length,
      ),
    ).not.toHaveLength(0);
  });

  const MONTHLY_JITTER_DAYS = 6;
  const WEEKLY_JITTER_DAYS = 1;
  const MONTHLY_SLOTS = 24;
  const WEEKLY_SLOTS = 40;
  const MONTHLY_DAY_RANGE = 28;
  const SKIPPED_SHARE = 0.2;
  const WEEK_DAYS = 7;
  // A world must reach gaps near the floor, or the property would also pass a floor that is too
  // high: 16 days monthly and 4 weekly.
  const NARROW_GAP_DAYS = { monthly: 20, weekly: 6 };

  const jitteredRowsOf = (period: 'monthly' | 'weekly', random: Random) => {
    const jitter = period === 'monthly' ? MONTHLY_JITTER_DAYS : WEEKLY_JITTER_DAYS;
    const day = 1 + Math.floor(random() * MONTHLY_DAY_RANGE);
    const slots = period === 'monthly' ? MONTHLY_SLOTS : WEEKLY_SLOTS;

    return rangeOf(0, slots)
      .filter(() => random() >= SKIPPED_SHARE)
      .map((index) => {
        const shift = Math.floor(random() * (2 * jitter + 1)) - jitter;
        const time =
          period === 'monthly'
            ? at(2024, 10 + index, day + shift)
            : at(2025, 1, 1 + WEEK_DAYS * index + shift);

        return chargeOf(`${period}-${index}`, time, 100);
      });
  };

  it.each(['monthly', 'weekly'] as const)(
    'keeps every charge of a jittered %s rhythm',
    (period) => {
      const gaps: number[] = [];

      for (const seed of SEEDS) {
        const rows = jitteredRowsOf(period, seededRandom(seed * SEED_SPREAD));
        const { marked } = outcomeOf(
          ledgerOf(rows),
          [entryOf(DEFAULT_NAME, [[period, 100]])],
          nowOf(),
        );
        const times = rows.map(({ time }) => time).sort(ascending);

        expect(marked.map(({ chargeIds }) => [...chargeIds].sort())).toEqual([
          rows.map(({ id }) => id).sort(),
        ]);
        gaps.push(...times.slice(1).map((time, index) => daysBetween(times[index] ?? 0, time)));
      }

      expect(minOf(gaps)).toBeLessThan(NARROW_GAP_DAYS[period]);
    },
  );

  it('answers holdsRow false for exactly the charges of the piece its series leaves out', () => {
    let checkedCount = 0;

    for (const { ledger, entries, outcome } of outcomes()) {
      const groups = chargeGroupsOf(ledger, nowOf());

      for (const series of outcome.marked) {
        const marks = entries.find(({ key }) => key === series.merchantKey)?.marks ?? [];
        const charges = groups.groups.get(groupKeyOf(series.merchantKey, series.currency))?.charges;

        for (const { id, amount } of pieceChargesOf(ledger, series)) {
          const chain = markedChainOfRow(
            charges ?? [],
            marks,
            { id, amountMinorUnits: amount },
            series.currency,
          );

          expect(chain?.holdsRow).toBe(series.chargeIds.includes(id));
          checkedCount += 1;
        }
      }
    }

    expect(checkedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });
});

describe('amountPiecesOf', () => {
  const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + 1);
  const SEEDS = sweep(FULL_SEEDS);
  const MIN_AMOUNTS = 5;
  const AMOUNT_COUNT_SPREAD = 36;

  const repeated = (amount: number, count: number): number[] =>
    Array.from({ length: count }, () => amount);

  const repeatedEach = (amounts: readonly number[], count: number): number[] =>
    amounts.flatMap((amount) => repeated(amount, count));

  const randomAmountsOf = (seed: number): number[] => {
    const random = seededRandom(seed * SEED_SPREAD);

    return Array.from({ length: MIN_AMOUNTS + Math.floor(random() * AMOUNT_COUNT_SPREAD) }, () =>
      Math.round(10 ** (2 + random() * 2.5)),
    );
  };

  // The amounts, in minor units, of the worlds that reach the split by amount.
  it.each<[string, number[], number[][]]>([
    [
      'Apple at 99 and at 399',
      [...repeated(9900, 10), ...repeated(39_900, 10)],
      [repeated(9900, 10), repeated(39_900, 10)],
    ],
    [
      'Apple monthly and a yearly charge',
      [...repeated(9900, 24), ...repeated(99_900, 2)],
      [repeated(9900, 24), repeated(99_900, 2)],
    ],
    [
      'Apple among more frequent purchases',
      [...repeated(9900, 12), ...repeatedEach([2900, 4900, 19_900, 39_900, 2900], 3)],
      [
        repeated(2900, 6),
        repeated(4900, 3),
        repeated(9900, 12),
        repeated(19_900, 3),
        repeated(39_900, 3),
      ],
    ],
    [
      'Apple among purchases near its price',
      [...repeated(9900, 12), ...repeatedEach([8900, 10_900, 11_900, 39_900, 2900], 3)],
      [
        repeated(2900, 3),
        [...repeated(8900, 3), ...repeated(9900, 12), ...repeatedEach([10_900, 11_900], 3)],
        repeated(39_900, 3),
      ],
    ],
    [
      'a seasonal bill',
      [
        13_000, 10_000, 10_500, 11_000, 10_000, 10_800, 40_000, 70_000, 90_000, 80_000, 50_000,
        30_000,
      ],
      [
        [10_000, 10_000, 10_500, 10_800, 11_000, 13_000],
        [30_000],
        [40_000, 50_000],
        [70_000, 80_000, 90_000],
      ],
    ],
    [
      'a utility bill with wide amounts',
      repeatedEach([40_000, 90_000, 150_000, 60_000], 3),
      [repeated(40_000, 3), repeated(60_000, 3), repeated(90_000, 3), repeated(150_000, 3)],
    ],
    [
      'two large price changes',
      [...repeated(17_000, 4), ...repeated(13_000, 6), ...repeated(10_000, 8)],
      [repeated(10_000, 8), repeated(13_000, 6), repeated(17_000, 4)],
    ],
    [
      'a price change of 50 percent',
      [...repeated(29_900, 3), ...repeated(19_900, 5)],
      [repeated(19_900, 5), repeated(29_900, 3)],
    ],
    [
      'two changes in two years',
      repeatedEach([40_000, 30_000, 20_000], 8),
      [repeated(20_000, 8), repeated(30_000, 8), repeated(40_000, 8)],
    ],
  ])('cuts the amounts of %s', (_title, amounts, expected) => {
    expect(amountPiecesOf(amounts)).toEqual(expected);
  });

  it.each<[string, number[], number[][]]>([
    ['no amounts', [], []],
    ['one amount', [500], [[500]]],
    ['a rise of exactly 1.25', [10_000, 12_500], [[10_000, 12_500]]],
    ['a rise past 1.25', [10_000, 12_501], [[10_000], [12_501]]],
    ['amounts out of order', [39_900, 9900, 9900], [[9900, 9900], [39_900]]],
    ['a bridge in the middle', [10_000, 14_000, 11_500], [[10_000, 11_500, 14_000]]],
    ['no bridge in the middle', [10_000, 15_000, 11_500], [[10_000, 11_500], [15_000]]],
  ])('cuts %s', (_title, amounts, expected) => {
    expect(amountPiecesOf(amounts)).toEqual(expected);
  });

  it('partitions any amounts into ascending pieces cut exactly where the step is passed', () => {
    let pieceCount = 0;
    let joinCount = 0;

    for (const seed of SEEDS) {
      const amounts = randomAmountsOf(seed);
      const pieces = amountPiecesOf(amounts);

      expect(pieces.flat()).toEqual([...amounts].sort(ascending));
      expect(pieces.every((piece) => piece.length > 0)).toBe(true);

      for (const piece of pieces) {
        for (const [index, amount] of piece.slice(1).entries()) {
          expect(amount).toBeLessThanOrEqual((piece[index] ?? 0) * AMOUNT_STEP);
          joinCount += 1;
        }
      }

      for (const [index, piece] of pieces.slice(1).entries()) {
        expect(piece[0] ?? 0).toBeGreaterThan((pieces[index]?.at(-1) ?? 0) * AMOUNT_STEP);
      }

      pieceCount += pieces.length;
    }

    expect(pieceCount).toBeGreaterThan(SEEDS.length);
    expect(joinCount).toBeGreaterThanOrEqual(1);
  });

  it('gives the same pieces for any order of the amounts', () => {
    for (const seed of SEEDS) {
      const amounts = randomAmountsOf(seed);
      const original = amountPiecesOf(amounts);

      expect(amountPiecesOf([...amounts].reverse())).toEqual(original);
      expect(amountPiecesOf(shuffled(amounts, seededRandom(seed * SEED_SPREAD)))).toEqual(original);
    }
  });
});

describe('markedChainOfAmount', () => {
  const markOf = (
    period: RecurringMark['period'],
    amountMinorUnits: number,
    currency: RecurringMark['currency'] = 'UAH',
  ): RecurringMark => ({ currency, amountMinorUnits, period });

  // One a month, the first in October, so no two share a slot of any period.
  const chargesOf = (...amounts: number[]): Charge[] =>
    amounts.map((amount, index) => ({
      id: `charge-${index}`,
      time: at(2026, 10 - index, 5),
      amount,
      source: 'monobank',
      holdingId: 'card',
      holdingName: 'card',
      description: 'Netflix',
    }));

  // A stored amount with no charge at it is a row outside the read.
  const rowAt = (charges: readonly Charge[], amountMinorUnits: number) => ({
    id: charges.find(({ amount }) => amount === amountMinorUnits)?.id ?? 'stored',
    amountMinorUnits,
  });

  it('finds the chain whose lowest and highest amounts span the amount', () => {
    const marks = [markOf('monthly', 10_000), markOf('everyThreeMonths', 40_000)];
    const charges = chargesOf(10_000, 11_000, 12_500, 40_000);

    expect(markedChainOfRow(charges, marks, rowAt(charges, 11_000), 'UAH')).toEqual({
      period: 'monthly',
      marks: [marks[0]],
      holdsRow: true,
    });
    expect(markedChainOfRow(charges, marks, rowAt(charges, 40_000), 'UAH')).toEqual({
      period: 'everyThreeMonths',
      marks: [marks[1]],
      holdsRow: true,
    });
  });

  it('finds a stored amount that no charge sits at', () => {
    const marks = [markOf('yearly', 10_000)];
    const charges = chargesOf(12_000);

    expect(markedChainOfRow(charges, marks, rowAt(charges, 10_000), 'UAH')).toEqual({
      period: 'yearly',
      marks,
      holdsRow: true,
    });
    expect(markedChainOfRow(charges, marks, rowAt(charges, 12_000), 'UAH')).toEqual({
      period: 'yearly',
      marks,
      holdsRow: true,
    });
  });

  it('finds a charge between two stored amounts, in the period of the lower one', () => {
    const marks = [markOf('everyThreeMonths', 13_000), markOf('monthly', 10_000)];
    const charges = chargesOf(11_500);

    expect(markedChainOfRow(charges, marks, rowAt(charges, 11_500), 'UAH')).toEqual({
      period: 'monthly',
      marks: [markOf('monthly', 10_000), markOf('everyThreeMonths', 13_000)],
      holdsRow: true,
    });
  });

  it('gives the same chain for any order of the marks and of the charges', () => {
    const marks = [markOf('monthly', 10_000), markOf('weekly', 10_000), markOf('yearly', 12_000)];
    const charges = chargesOf(10_500, 12_000, 11_000);
    const row = rowAt(charges, 11_000);
    const original = markedChainOfRow(charges, marks, row, 'UAH');

    expect(original).toEqual({
      period: 'weekly',
      marks: [marks[1], marks[0], marks[2]],
      holdsRow: true,
    });
    expect(markedChainOfRow([...charges].reverse(), [...marks].reverse(), row, 'UAH')).toEqual(
      original,
    );
  });

  it('gives null for an amount outside every chain, and for a chain with no stored amount', () => {
    const marks = [markOf('monthly', 10_000)];
    const charges = chargesOf(10_000, 40_000);

    expect(markedChainOfRow(charges, marks, rowAt(charges, 10_000), 'UAH')).not.toBeNull();
    expect(markedChainOfRow(charges, marks, rowAt(charges, 25_000), 'UAH')).toBeNull();
    expect(markedChainOfRow(charges, marks, rowAt(charges, 40_000), 'UAH')).toBeNull();
    expect(markedChainOfRow(charges, marks, rowAt(charges, 9000), 'UAH')).toBeNull();
    expect(markedChainOfRow(charges, [], rowAt(charges, 10_000), 'UAH')).toBeNull();
  });

  it('does not read the marks of another currency', () => {
    const marks = [markOf('monthly', 10_000), markOf('yearly', 12_000, 'USD')];
    const charges = chargesOf(15_000);
    const chargeRow = rowAt(charges, 15_000);

    expect(markedChainOfRow(charges, marks, chargeRow, 'UAH')).toBeNull();
    expect(markedChainOfRow(charges, marks, chargeRow, 'USD')).toEqual({
      period: 'yearly',
      marks: [marks[1]],
      holdsRow: true,
    });
    expect(markedChainOfRow(charges, marks, rowAt(charges, 10_000), 'UAH')).toEqual({
      period: 'monthly',
      marks: [marks[0]],
      holdsRow: true,
    });
  });

  it.each(DROPPED_WORLDS)(
    'holds no dropped row and every kept one: $world.title',
    ({ world, dropped }) => {
      const ledger = world.ledger();
      const [{ key, marks }] = entriesOf(world);
      const group = chargeGroupsOf(ledger, nowOf()).groups.get(groupKeyOf(key, 'UAH'));
      const holdsRowOf = (id: string) =>
        markedChainOfRow(
          group?.charges ?? [],
          marks,
          { id, amountMinorUnits: amountOfRow(ledger, id) },
          'UAH',
        )?.holdsRow;
      const keptIds = idsOf(outcomeOf(ledger, entriesOf(world), nowOf()).marked);

      expect(dropped.rowIds.map(holdsRowOf)).toEqual(dropped.rowIds.map(() => false));
      expect(keptIds.map(holdsRowOf)).toEqual(keptIds.map(() => true));
    },
  );
});
