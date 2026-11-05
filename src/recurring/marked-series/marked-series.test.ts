import {
  type RecurringMark,
  type RecurringSeries,
  amountPiecesOf,
  detectRecurringSeries,
} from '@kiko/recurring/detection';
import {
  nowOf,
  timesOf,
  dayKeyOf,
  shuffled,
  randomLedgerOf,
  foldBucketsOf,
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
import { sweep } from '@kiko/test-support/property-sweep';
import { seededRandom } from '@kiko/test-support/seeded-random';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { withDeviceZoneOffset } from '@kiko/test-support/device-zone-offset';
import { AMOUNT_CHAIN_WORLDS } from '@kiko/test-support/marked-series-chain-worlds';
import { isRecurringCandidate, recurringExcludedIds } from '@kiko/recurring/eligibility';

import { type MarkedEntry, markedChainOfAmount } from './marked-series';

const SEED_SPREAD = 104_729;
const AMOUNT_STEP = 1.25;
const DEFAULT_NAME = 'Netflix';

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

describe('markedSeriesOf over random ledgers and marks', () => {
  const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + 1);
  const SEEDS = sweep(FULL_SEEDS);
  const MIN_PER_RUN = 1;

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
        // A stored amount sits in the cut like a charge, so it may bridge two charges.
        const amounts = [
          ...series.chargeIds.map((id) => amountOfRow(ledger, id)),
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

  it('equals the piece of amountPiecesOf for one mark on a charge', () => {
    let checkedCount = 0;

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
        expect(new Set(seriesAmounts)).toEqual(new Set(piece));
        checkedCount += 1;
      }
    }

    expect(checkedCount).toBeGreaterThanOrEqual(MIN_PER_RUN);
  });

  it('never leaves fewer charges on a day and amount than the largest count of one source', () => {
    const buckets = outcomes().flatMap(({ ledger, outcome }) =>
      outcome.marked.flatMap((series) => foldBucketsOf(ledger, series)),
    );

    expect(buckets.filter(({ kept, largestOfOneSource }) => kept < largestOfOneSource)).toEqual([]);
    expect(buckets.length).toBeGreaterThanOrEqual(MIN_PER_RUN);
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
    ['a bridge in the middle', [10_000, 15_000, 11_500], [[10_000, 11_500, 15_000]]],
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

  const chargesOf = (...amounts: number[]) =>
    amounts.map((amountMinorUnits) => ({ amountMinorUnits }));

  it('finds the chain whose lowest and highest amounts span the amount', () => {
    const marks = [markOf('monthly', 10_000), markOf('everyThreeMonths', 40_000)];
    const charges = chargesOf(10_000, 11_000, 12_500, 40_000);

    expect(markedChainOfAmount(charges, marks, 11_000, 'UAH')).toEqual({
      period: 'monthly',
      marks: [marks[0]],
    });
    expect(markedChainOfAmount(charges, marks, 40_000, 'UAH')).toEqual({
      period: 'everyThreeMonths',
      marks: [marks[1]],
    });
  });

  it('finds a stored amount that no charge sits at', () => {
    const marks = [markOf('yearly', 10_000)];

    expect(markedChainOfAmount(chargesOf(12_000), marks, 10_000, 'UAH')).toEqual({
      period: 'yearly',
      marks,
    });
    expect(markedChainOfAmount(chargesOf(12_000), marks, 12_000, 'UAH')).toEqual({
      period: 'yearly',
      marks,
    });
  });

  it('finds a charge between two stored amounts, in the period of the lower one', () => {
    const marks = [markOf('everyThreeMonths', 13_000), markOf('monthly', 10_000)];

    expect(markedChainOfAmount(chargesOf(11_500), marks, 11_500, 'UAH')).toEqual({
      period: 'monthly',
      marks: [markOf('monthly', 10_000), markOf('everyThreeMonths', 13_000)],
    });
  });

  it('gives the same chain for any order of the marks and of the charges', () => {
    const marks = [markOf('monthly', 10_000), markOf('weekly', 10_000), markOf('yearly', 12_000)];
    const charges = chargesOf(10_500, 12_000, 11_000);
    const original = markedChainOfAmount(charges, marks, 11_000, 'UAH');

    expect(original).toEqual({ period: 'weekly', marks: [marks[1], marks[0], marks[2]] });
    expect(
      markedChainOfAmount([...charges].reverse(), [...marks].reverse(), 11_000, 'UAH'),
    ).toEqual(original);
  });

  it('gives null for an amount outside every chain, and for a chain with no stored amount', () => {
    const marks = [markOf('monthly', 10_000)];
    const charges = chargesOf(10_000, 40_000);

    expect(markedChainOfAmount(charges, marks, 10_000, 'UAH')).not.toBeNull();
    expect(markedChainOfAmount(charges, marks, 25_000, 'UAH')).toBeNull();
    expect(markedChainOfAmount(charges, marks, 40_000, 'UAH')).toBeNull();
    expect(markedChainOfAmount(charges, marks, 9000, 'UAH')).toBeNull();
    expect(markedChainOfAmount(charges, [], 10_000, 'UAH')).toBeNull();
  });

  it('does not read the marks of another currency', () => {
    const marks = [markOf('monthly', 10_000), markOf('yearly', 12_000, 'USD')];
    const charges = chargesOf(15_000);

    expect(markedChainOfAmount(charges, marks, 15_000, 'UAH')).toBeNull();
    expect(markedChainOfAmount(charges, marks, 15_000, 'USD')).toEqual({
      period: 'yearly',
      marks: [marks[1]],
    });
    expect(markedChainOfAmount(charges, marks, 10_000, 'UAH')).toEqual({
      period: 'monthly',
      marks: [marks[0]],
    });
  });
});
