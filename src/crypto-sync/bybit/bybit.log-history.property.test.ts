import { DAY_MS } from '@kiko/dates';
import { sweep } from '@kiko/test-support/property-sweep';
import { walkStateFake } from '@kiko/test-support/walk-marks';
import { type Random, seededRandom } from '@kiko/test-support/seeded-random';

import {
  logWalkOf,
  quoteLegAt,
  silencedWarnings,
  spotAt,
  sumsByHolding,
} from './bybit.log-test-fixtures';
import { NOW } from './bybit.client-test-fixtures';
import { ACCOUNT_ID } from './bybit.capital-test-fixtures';

// Random fills of one trade, read as one row per fill or as one row per order, in any page order
// and any page size, read twice, with a summary row that has an empty tradeId added at random. The
// sum per coin is the sum of `change`, whatever the form, and a row with an empty tradeId never
// adds.
const FULL_SEEDS = Array.from({ length: 30 }, (_unused, position) => 3 + position * 7);
const SEEDS = sweep(FULL_SEEDS);

// Small consecutive seeds of the Lehmer generator draw the same first value, so each seed is
// spread before it is used.
const SEED_SPREAD = 1_000_003;

const CURSOR = NOW - 3 * DAY_MS;
const AT = NOW - 2 * DAY_MS;
const SECOND_MS = 1_000;
const UNITS_PER_COIN = 100_000_000;
const MOST_FILLS = 8;
const ORDERS = ['ascending', 'descending', 'scrambled'] as const;
const PAGE_SIZES = [1, 2, 3, 50];

type Fill = { qty: number; fee: number; quote: number };

type World = {
  fills: Fill[];
  order: (typeof ORDERS)[number];
  pageSize: number;
  withSummary: boolean;
};

const pick = <Entry>(random: Random, entries: readonly Entry[]): Entry =>
  entries[Math.floor(random() * entries.length)] as Entry;

const worldOf = (seed: number): World => {
  const random = seededRandom(seed * SEED_SPREAD);
  const fills = Array.from({ length: 1 + Math.floor(random() * MOST_FILLS) }, () => {
    const qty = 1_000 + Math.floor(random() * 990_000);

    return {
      qty,
      fee: Math.floor(qty * random() * 0.01),
      quote: UNITS_PER_COIN * (1 + Math.floor(random() * 500)),
    };
  });

  return {
    fills,
    order: pick(random, ORDERS),
    pageSize: pick(random, PAGE_SIZES),
    withSummary: random() < 0.5,
  };
};

/** Exact decimal text of whole minor units of a coin of 8 decimals. */
const textOf = (units: number): string => {
  const magnitude = Math.abs(units);
  const text = `${Math.floor(magnitude / UNITS_PER_COIN)}.${String(magnitude % UNITS_PER_COIN).padStart(8, '0')}`;

  return units < 0 ? `-${text}` : text;
};

const totalOf = (fills: readonly Fill[], field: keyof Fill): number =>
  fills.reduce((sum, fill) => sum + fill[field], 0);

const baseRowAt = (id: string, time: number, qty: number, fee: number) =>
  spotAt(time, {
    id,
    orderId: 'order-1',
    tradeId: `trade-${id}`,
    qty: textOf(qty),
    fee: textOf(fee),
    change: textOf(qty - fee),
  });

const quoteRowAt = (id: string, time: number, quote: number) =>
  quoteLegAt(time, {
    id,
    orderId: 'order-1',
    tradeId: `trade-${id}`,
    qty: textOf(-quote),
    change: textOf(-quote),
  });

const perFill = ({ fills }: World) =>
  fills.flatMap((fill, index) => [
    baseRowAt(`fill-${index}`, AT + (index + 1) * SECOND_MS, fill.qty, fill.fee),
    quoteRowAt(`quote-${index}`, AT + (index + 1) * SECOND_MS, fill.quote),
  ]);

const perOrder = ({ fills }: World) => [
  baseRowAt('order', AT + SECOND_MS, totalOf(fills, 'qty'), totalOf(fills, 'fee')),
  quoteRowAt('quote', AT + SECOND_MS, totalOf(fills, 'quote')),
];

const summaryOf = ({ fills }: World) =>
  spotAt(AT + (MOST_FILLS + 1) * SECOND_MS, {
    id: 'summary',
    orderId: 'order-1',
    tradeId: '',
    qty: textOf(totalOf(fills, 'qty')),
    fee: textOf(totalOf(fills, 'fee')),
    change: textOf(totalOf(fills, 'qty') - totalOf(fills, 'fee')),
  });

const sumsOf = async (world: World, rows: ReturnType<typeof perFill>) => {
  const walk = logWalkOf({
    state: walkStateFake({ accountId: ACCOUNT_ID, marks: { log: { cursor: CURSOR } } }),
    fake: { pageSize: world.pageSize, order: world.order },
  });
  walk.world.log = world.withSummary ? [...rows, summaryOf(world)] : rows;

  await walk.run();
  walk.clock.now = NOW + DAY_MS;
  await walk.run();

  return { sums: sumsByHolding(walk.rows()), pending: walk.marks().pending as unknown[] };
};

describe('the log walk, over random fills of one trade', () => {
  silencedWarnings();

  it.each(SEEDS)(
    'the sum per coin holds under any form and any read order, and an empty tradeId row never adds: seed %i',
    async (seed) => {
      const world = worldOf(seed);
      const expected = {
        'holding-BTC:unified': totalOf(world.fills, 'qty') - totalOf(world.fills, 'fee'),
        'holding-USDT:unified': -totalOf(world.fills, 'quote'),
      };

      const fills = await sumsOf(world, perFill(world));
      const order = await sumsOf(world, perOrder(world));

      expect(fills.sums).toEqual(expected);
      expect(order.sums).toEqual(expected);
      expect(fills.pending).toHaveLength(world.withSummary ? 1 : 0);
      expect(order.pending).toHaveLength(world.withSummary ? 1 : 0);
    },
  );

  it('draws worlds that differ from seed to seed and reach every form of the property', () => {
    const worlds = FULL_SEEDS.map((seed) => worldOf(seed));

    expect(new Set(worlds.map((world) => JSON.stringify(world))).size).toBe(FULL_SEEDS.length);
    expect(Math.max(...worlds.map(({ fills }) => fills.length))).toBeGreaterThan(2);
    expect(new Set(worlds.map(({ withSummary }) => withSummary))).toEqual(new Set([true, false]));
    expect(new Set(worlds.map(({ order }) => order)).size).toBeGreaterThan(1);
    expect(new Set(worlds.map(({ pageSize }) => pageSize)).size).toBeGreaterThan(1);
  });
});
