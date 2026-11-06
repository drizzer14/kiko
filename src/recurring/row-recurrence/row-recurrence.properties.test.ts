import {
  type ChargeGroups,
  type RecurringMark,
  type RecurringPeriod,
  type RecurringSeries,
  chargeGroupsOf,
  seriesOfGroups,
  detectRecurringSeries,
} from '@kiko/recurring/detection';
import {
  type MarkedEntry,
  markedSeriesOf,
  detectedBesideMarked,
} from '@kiko/recurring/marked-series';
import {
  nowOf,
  monthly,
  randomLedgerOf,
  type Ledger,
  type LedgerRow,
} from '@kiko/test-support/recurring-ledger';
import type { Currency } from '@kiko/currency/currency';
import { sweep } from '@kiko/test-support/property-sweep';
import type { RecurringMerchantChoice } from '@kiko/settings';
import { seededRandom } from '@kiko/test-support/seeded-random';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { RECURRING_PERIODS } from '@kiko/recurring/recurring-periods';
import { entryOf, randomEntriesOf } from '@kiko/test-support/marked-series-world';

type Choices = ReadonlyMap<string, RecurringMerchantChoice>;
type Shown =
  | { kind: 'marked'; period: RecurringPeriod; marks: readonly RecurringMark[] }
  | { kind: 'detected'; period: RecurringPeriod }
  | { kind: 'none' };
type RowRecurrenceModule = {
  rowRecurrenceOf: (input: {
    chargeGroups: ChargeGroups;
    key: string;
    currency: Currency;
    rowId: string;
    choices: Choices;
    today: number;
  }) => Shown;
};

// A runtime lookup, so the pin fails by itself while the module is missing and the file still
// typechecks.
const rowRecurrenceModule = (): RowRecurrenceModule => jest.requireActual('./row-recurrence');

const SEED_SPREAD = 104_729;
const FIRST_SEED = 3;
const HIDE_SHARE = 0.4;
const STEPPED_MARK_SHARE = 0.7;
const STEPPED_NAME = 'Stepped Gym';
const FULL_SEEDS = Array.from({ length: 24 }, (_unused, index) => index + FIRST_SEED);
const SEEDS = sweep(FULL_SEEDS);
const NOW = nowOf();
const MIN_PER_RUN = 1;

const markedEntriesOf = (choices: Choices): MarkedEntry[] =>
  [...choices].flatMap(([key, { name, marks = [] }]) =>
    marks.length > 0 ? [{ key, name, marks }] : [],
  );

// A hide drawn per detected key, whether or not the key also holds a mark.
const choicesOf = (
  entries: readonly MarkedEntry[],
  detected: readonly RecurringSeries[],
  random: () => number,
): Choices => {
  const choices = new Map<string, RecurringMerchantChoice>(
    entries.map(({ key, name, marks }) => [key, { name, marks: [...marks] }]),
  );

  for (const { merchantKey, name } of detected) {
    if (random() < HIDE_SHARE) {
      choices.set(merchantKey, { ...(choices.get(merchantKey) ?? { name }), hidden: true });
    }
  }

  return choices;
};

// The list's own path, as `useRecurringSeries` composes it: the detected series that share no row
// with a marked chain stand beside the chains.
const standingOf = (groups: ChargeGroups, choices: Choices) => {
  const detected = seriesOfGroups(groups, NOW);
  const marked = markedSeriesOf(groups, markedEntriesOf(choices), NOW).series;

  return {
    marked,
    detected,
    series: marked.length > 0 ? detectedBesideMarked(detected, marked) : detected,
  };
};

// The list screen's filter: a hide leaves out detected series only.
const listShownOf = (groups: ChargeGroups, choices: Choices): RecurringSeries[] => {
  const { marked, series } = standingOf(groups, choices);

  return [
    ...series.filter(({ merchantKey }) => choices.get(merchantKey)?.hidden !== true),
    ...marked,
  ];
};

const listAnswerOf = (shown: readonly RecurringSeries[], rowId: string): Shown => {
  const holder = shown.find(({ chargeIds }) => chargeIds.includes(rowId));

  if (holder === undefined) {
    return { kind: 'none' };
  }

  return holder.marks === undefined
    ? { kind: 'detected', period: holder.period }
    : { kind: 'marked', period: holder.period, marks: holder.marks };
};

const currencyOf = (ledger: Ledger, row: LedgerRow): Currency =>
  ledger.holdings.find(({ id }) => id === row.holdingId)?.currency ?? 'UAH';

// A subscription that rose by 30 percent for its newest three charges: detection reads one monthly
// series over both prices, and a mark on the lower price chains only the older charges, so the
// series overlaps the chain in some rows and not in others.
const steppedMerchantOf = (random: () => number) => {
  const low = 100 + Math.floor(random() * 400);
  const count = 6 + Math.floor(random() * 5);
  const day = 1 + Math.floor(random() * 28);
  const period = RECURRING_PERIODS[Math.floor(random() * RECURRING_PERIODS.length)] ?? 'monthly';

  return {
    rows: monthly(count, day, (index) => (index < 3 ? Math.round(low * 1.3) : low), {
      description: STEPPED_NAME,
      prefix: 'stepped',
    }),
    entry: entryOf(STEPPED_NAME, [[period, low]]),
    isMarked: random() < STEPPED_MARK_SHARE,
  };
};

const worlds = SEEDS.map((seed) => {
  const random = seededRandom(seed * SEED_SPREAD);
  const base = randomLedgerOf(random);
  const stepped = steppedMerchantOf(random);
  const ledger = { ...base, rows: [...base.rows, ...stepped.rows] };
  const detected = detectRecurringSeries(ledger, NOW);
  const entries = [
    ...randomEntriesOf(base, detectRecurringSeries(base, NOW), random),
    ...(stepped.isMarked ? [stepped.entry] : []),
  ];
  const choices = choicesOf(entries, detected, random);
  const groups = chargeGroupsOf(ledger, NOW);

  return { ledger, choices, groups, shown: listShownOf(groups, choices) };
});

describe('rowRecurrenceOf over random ledgers, marks and hides', () => {
  it('gives every row the answer the list shows for it', () => {
    for (const { ledger, choices, groups, shown } of worlds) {
      for (const row of ledger.rows) {
        const answer = rowRecurrenceModule().rowRecurrenceOf({
          chargeGroups: groups,
          key: merchantNameOf(row.description).key,
          currency: currencyOf(ledger, row),
          rowId: row.id,
          choices,
          today: NOW,
        });

        expect({ id: row.id, answer }).toEqual({ id: row.id, answer: listAnswerOf(shown, row.id) });
      }
    }
  });

  it('draws worlds that reach each answer, a hide that removes a series and an overlap that removes one', () => {
    const kinds = worlds.flatMap(({ ledger, shown }) =>
      ledger.rows.map((row) => listAnswerOf(shown, row.id).kind),
    );
    const standing = worlds.map(({ groups, choices }) => standingOf(groups, choices));
    const hiddenAway = worlds.flatMap(({ choices }, index) =>
      (standing[index]?.series ?? []).filter(
        ({ merchantKey }) => choices.get(merchantKey)?.hidden === true,
      ),
    );
    // Rows of a detected series that a marked chain removed, which the chain does not hold itself:
    // only the overlap rule gives them none.
    const rowsOnlyOverlapRemoves = standing.flatMap(({ marked, detected, series }) =>
      detected
        .filter((removed) => !series.includes(removed))
        .flatMap(({ chargeIds }) => chargeIds)
        .filter((id) => !marked.some(({ chargeIds }) => chargeIds.includes(id))),
    );

    expect(new Set(kinds)).toEqual(new Set(['marked', 'detected', 'none']));
    expect(hiddenAway.length).toBeGreaterThanOrEqual(MIN_PER_RUN);
    expect(rowsOnlyOverlapRemoves.length).toBeGreaterThanOrEqual(MIN_PER_RUN);
    expect(new Set(worlds.map(({ ledger }) => ledger.rows.length)).size).toBeGreaterThan(1);
  });
});
