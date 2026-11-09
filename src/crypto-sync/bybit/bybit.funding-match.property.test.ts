import { DAY_MS } from '@kiko/dates';
import type { FundingMatchRow } from '@kiko/db';
import { sweep } from '@kiko/test-support/property-sweep';
import { addDecimal, compareDecimal } from '@kiko/currency/decimal';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import { FUNDING_MATCH_WINDOW_MS } from './bybit.funding-match';
import { atDay, ledgerRowOf, sourceRowOf, verdictsOf } from './bybit.funding-test-fixtures';

// Each world is a few sources and ledger rows of equal and near amounts, so pairs cross, and a
// pair needs a repair in many of them.
const FULL_SEEDS = Array.from({ length: 300 }, (_unused, position) => 3 + position * 7);

const SEEDS = sweep(FULL_SEEDS);

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const WINDOW = FUNDING_MATCH_WINDOW_MS;
const SERIES = [
  'deposit',
  'deposit',
  'deposit',
  'internal',
  'withdraw',
  'transfer',
  'convert',
] as const;
const AMOUNTS = ['100', '100', '100', '100.00', '95', '105', '5'];
const FEES = [null, null, '5', ''];
const COINS = ['USDT', 'USDT', 'USDT', 'USDT', 'BTC'];
const DIRECTIONS = ['I', 'I', 'I', 'O'];

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const sourceOf = (random: Random, index: number): FundingMatchRow => {
  const series = pick(random, SERIES);
  const time = atDay(Math.floor(random() * 15));
  const bothWays = series === 'transfer' || series === 'convert';

  return sourceRowOf(`source-${index}`, series, time, {
    coin: pick(random, COINS),
    amount: pick(random, AMOUNTS),
    fee: pick(random, FEES),
    tax: pick(random, FEES),
    until: time + Math.floor(random() * 3) * DAY_MS,
    ...(bothWays ? { direction: pick(random, DIRECTIONS) } : {}),
  });
};

const ledgerOf = (random: Random, index: number): FundingMatchRow =>
  ledgerRowOf(`ledger-${index}`, atDay(Math.floor(random() * 15)), {
    coin: pick(random, COINS),
    amount: pick(random, AMOUNTS),
    direction: pick(random, DIRECTIONS),
  });

const worldOf = (seed: number): FundingMatchRow[] => {
  const random = seededRandom(seed * SEED_SPREAD);
  const sourceCount = 2 + Math.floor(random() * 5);
  const ledgerCount = 2 + Math.floor(random() * 6);

  return [
    ...Array.from({ length: sourceCount }, (_unused, index) => sourceOf(random, index)),
    ...Array.from({ length: ledgerCount }, (_unused, index) => ledgerOf(random, index)),
  ];
};

const shuffled = <Entry>(random: Random, entries: readonly Entry[]): Entry[] => {
  const copy = [...entries];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = copy[index] as Entry;

    copy[index] = copy[other] as Entry;
    copy[other] = held;
  }

  return copy;
};

const readableOf = (text: string | null): string[] => [text ?? ''].filter((read) => read !== '');

/** The texts a source's amount can be equal to, written again with no key and no lookup. */
const formsOf = (source: FundingMatchRow): string[] => {
  const fees = readableOf(source.fee);
  const withFee = fees.map((fee) => addDecimal(source.amount, fee));
  const withTax = withFee.flatMap((total) =>
    readableOf(source.tax).map((tax) => addDecimal(total, tax)),
  );

  if (source.series === 'deposit') {
    return [source.amount, ...fees.map((fee) => addDecimal(source.amount, `-${fee}`)), ...withFee];
  }

  if (source.series === 'withdraw') {
    return [source.amount, ...withFee, ...withTax];
  }

  return [source.amount];
};

const distanceBetween = (ledger: FundingMatchRow, source: FundingMatchRow): number =>
  Math.max(source.timeStart - ledger.timeStart, ledger.timeStart - source.timeEnd, 0);

const canPair = (ledger: FundingMatchRow, source: FundingMatchRow): boolean =>
  ledger.coin === source.coin &&
  ledger.direction === source.direction &&
  distanceBetween(ledger, source) <= WINDOW &&
  formsOf(source).some(
    (form) => compareDecimal(form, '0') === 1 && compareDecimal(form, ledger.amount) === 0,
  );

const ledgersOf = (rows: readonly FundingMatchRow[]): FundingMatchRow[] =>
  rows.filter((row) => row.side === 'ledger');

const sourcesOf = (rows: readonly FundingMatchRow[]): FundingMatchRow[] =>
  rows.filter((row) => row.side === 'source');

/** The most rows any one-to-one pairing can explain, found by trying every pairing. */
const largestPairing = (rows: readonly FundingMatchRow[]): number => {
  const ledgers = ledgersOf(rows);
  const sources = sourcesOf(rows);

  const search = (ledgerIndex: number, taken: ReadonlySet<number>): number => {
    const ledger = ledgers[ledgerIndex];

    if (ledger === undefined) {
      return 0;
    }

    const options = sources.flatMap((source, sourceIndex) =>
      !taken.has(sourceIndex) && canPair(ledger, source)
        ? [1 + search(ledgerIndex + 1, new Set([...taken, sourceIndex]))]
        : [],
    );

    return Math.max(search(ledgerIndex + 1, taken), ...options);
  };

  return search(0, new Set());
};

const latestEnd = (rows: readonly FundingMatchRow[]): number =>
  Math.max(...rows.map((row) => row.timeEnd));

describe('matchFundingLedger over random worlds', () => {
  it('draws a different world from every seed', () => {
    const worlds = SEEDS.map((seed) => JSON.stringify(worldOf(seed)));

    expect(new Set(worlds).size).toBe(SEEDS.length);
  });

  it('reaches the verdicts the worlds are meant to separate: explained, held and listed', () => {
    const verdicts = FULL_SEEDS.flatMap((seed) => Object.values(verdictsOf(worldOf(seed))));

    expect(new Set(verdicts)).toEqual(new Set(['explained', 'held', 'listed']));
  });

  it('gives each ledger row one verdict, and explains a row only if it has a source it can pair', () => {
    for (const seed of SEEDS) {
      const rows = worldOf(seed);
      const verdicts = verdictsOf(rows);

      expect(Object.keys(verdicts).sort()).toEqual(
        ledgersOf(rows)
          .map((ledger) => ledger.recordKey)
          .sort(),
      );

      for (const ledger of ledgersOf(rows)) {
        if (verdicts[ledger.recordKey] === 'explained') {
          expect(sourcesOf(rows).some((source) => canPair(ledger, source))).toBe(true);
        }
      }
    }
  });

  it('does not depend on the order of its input', () => {
    for (const seed of SEEDS) {
      const rows = worldOf(seed);
      const random = seededRandom(seed * SEED_SPREAD + 1);
      const expected = verdictsOf(rows);

      for (const attempt of [0, 1, 2]) {
        expect({ seed, attempt, verdicts: verdictsOf(shuffled(random, rows)) }).toEqual({
          seed,
          attempt,
          verdicts: expected,
        });
      }
    }
  });

  it('pairs one to one, and no other one-to-one pairing explains more rows', () => {
    for (const seed of SEEDS) {
      const rows = worldOf(seed);
      const explained = Object.values(verdictsOf(rows)).filter(
        (verdict) => verdict === 'explained',
      ).length;

      expect({ seed, explained }).toEqual({ seed, explained: largestPairing(rows) });
    }
  });

  it('moves no verdict when a source over the window from every other record is added', () => {
    for (const seed of SEEDS) {
      const rows = worldOf(seed);
      const random = seededRandom(seed * SEED_SPREAD + 2);
      const far = sourceRowOf(
        'source-far',
        pick(random, SERIES),
        latestEnd(rows) + WINDOW + DAY_MS,
        {
          coin: pick(random, COINS),
          amount: pick(random, AMOUNTS),
          direction: pick(random, DIRECTIONS),
        },
      );

      expect({ seed, verdicts: verdictsOf([...rows, far]) }).toEqual({
        seed,
        verdicts: verdictsOf(rows),
      });
    }
  });

  it('moves no verdict when a ledger row over the window from every other record is added', () => {
    for (const seed of SEEDS) {
      const rows = worldOf(seed);
      const random = seededRandom(seed * SEED_SPREAD + 3);
      const far = ledgerRowOf('ledger-far', latestEnd(rows) + WINDOW + DAY_MS, {
        coin: pick(random, COINS),
        amount: pick(random, AMOUNTS),
        direction: pick(random, DIRECTIONS),
      });
      const { 'ledger-far': farVerdict, ...others } = verdictsOf([...rows, far]);

      expect({ seed, others, farVerdict }).toEqual({
        seed,
        others: verdictsOf(rows),
        farVerdict: 'listed',
      });
    }
  });
});
