let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import { DatabaseSync } from 'node:sqlite';
import maybe, { foldMap } from 'fnts/maybe';
import { holdingsRepo } from '@kiko/holdings/repo';
import { buildPriceBook, dayKeyOf } from '@kiko/prices/price-book';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { quantityAt, type Lot, type LotChange } from '@kiko/holdings/lots';
import { asMetalMeta, asShareMeta } from '@kiko/holdings/holding-metadata';
import { holdingInstrument, metalInstrument, shareInstrument } from '@kiko/prices/instrument';
import { database, holdings, pricePoints, type HoldingRow, type PricePointRow } from '@kiko/db';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

// Every money rule a share's lots and prices follow, as one operation x state
// table on the real schema: each cell names the value, cost basis, and
// quantity it must read on the given days afterwards.

const HOLDING_ID = 'share-1';

const january5 = new Date(2026, 0, 5).getTime();
const january10 = new Date(2026, 0, 10).getTime();
const february10 = new Date(2026, 1, 10).getTime();
const february14 = new Date(2026, 1, 14).getTime();
const march1 = new Date(2026, 2, 1).getTime();
const march10 = new Date(2026, 2, 10).getTime();
const april10 = new Date(2026, 3, 10).getTime();

const buy = (instant: number, quantity: string, costMinorUnits: number): Lot => ({
  day: dayKeyOf(instant),
  quantityDelta: quantity,
  costMinorUnits,
});

const sell = (instant: number, quantity: string, costMinorUnits = 0): Lot => ({
  day: dayKeyOf(instant),
  quantityDelta: `-${quantity}`,
  costMinorUnits,
});

const BASE_LOTS = [buy(january10, '10', 100_000), sell(march10, '4', -40_000)];

type Price = { instant: number; price: string };

const AAPL: Price[] = [
  { instant: january10, price: '100' },
  { instant: february10, price: '150' },
  { instant: march10, price: '200' },
  { instant: april10, price: '250' },
];

// A 4:1 split on 1 March: EODHD's close is the raw, unadjusted one.
const SPLIT_AAPL: Price[] = [
  { instant: january10, price: '400' },
  { instant: february10, price: '480' },
  { instant: march1, price: '120' },
  { instant: april10, price: '125' },
];

// Bought 10 for 1,000 in January, sold 4 in March, and bought 10 for 3,000 on
// the day of that sale, recorded after it: the sale is costed after the buy.
const SAME_DAY_LOTS = [BASE_LOTS[0], sell(march10, '4', -80_000), buy(march10, '10', 300_000)];

type State = {
  type?: 'share' | 'metal';
  currency?: string;
  meta?: Record<string, unknown>;
  lots?: Lot[];
  share?: Price[];
  metal?: Price[];
  own?: Price[];
};

type Reading = { at: number; quantity: string; value: number; cost: number };

type Cell = {
  operation: string;
  state: string;
  given: State;
  act: () => Promise<unknown>;
  rejects?: boolean;
  expected: Reading[];
  ownSeries?: Price[];
  storedLots?: Lot[];
};

const eodhd = { quoteSource: 'eodhd', symbol: 'AAPL.US', quoteCurrency: 'USD' };
const manual = { quoteSource: 'manual' };
const gold = { metal: 'XAU', form: 'bar', unit: 'oz', purity: '1' };

// UAH per troy ounce.
const XAU: Price[] = [
  { instant: january10, price: '100' },
  { instant: april10, price: '400' },
];

const openDatabase = (given: State): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('broker-1', 'Broker', 'broker')")
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES (?, 'broker-1', 'Apple', ?, ?, 0, ?)`,
    )
    .run(
      HOLDING_ID,
      given.type ?? 'share',
      given.currency ?? 'USD',
      JSON.stringify({ ...(given.meta ?? eodhd), lots: given.lots ?? BASE_LOTS }),
    );

  const insertPrice = mockDatabase.prepare(
    'INSERT INTO price_points (instrument, day, price, currency, source) VALUES (?, ?, ?, ?, ?)',
  );

  for (const point of given.share ?? AAPL) {
    insertPrice.run(
      shareInstrument('AAPL.US'),
      dayKeyOf(point.instant),
      point.price,
      'USD',
      'eodhd',
    );
  }

  for (const point of given.metal ?? []) {
    insertPrice.run(metalInstrument('XAU'), dayKeyOf(point.instant), point.price, 'UAH', 'nbu');
  }

  // A price the user typed is in the holding's own currency.
  for (const point of given.own ?? []) {
    insertPrice.run(
      holdingInstrument(HOLDING_ID),
      dayKeyOf(point.instant),
      point.price,
      given.currency ?? 'USD',
      'manual',
    );
  }
};

const storedHolding = async (): Promise<HoldingRow> => {
  const rows = await database.select().from(holdings);

  return rows[0];
};

const storedPrices = (): Promise<PricePointRow[]> => database.select().from(pricePoints);

const ownSeries = async (): Promise<Price[]> =>
  (await storedPrices())
    .filter((row) => row.instrument === holdingInstrument(HOLDING_ID))
    .sort((first, second) => first.day - second.day)
    .map((row) => ({ instant: row.day, price: row.price }));

const lotsOf = (holding: HoldingRow): Lot[] =>
  asShareMeta(holding.metadata)?.lots ?? asMetalMeta(holding.metadata)?.lots ?? [];

const reading = async (at: number): Promise<Reading> => {
  const holding = await storedHolding();
  const breakdown = holdingValueBreakdown(holding, at, buildPriceBook(await storedPrices()));

  return {
    at,
    quantity: quantityAt(lotsOf(holding), at),
    value: breakdown.gross.minorUnits,
    cost: breakdown.principalOrCost.minorUnits,
  };
};

const changeLots = (change: LotChange) => () => holdingsRepo.changeLots(HOLDING_ID, change);

// The share form's own rule for an edit: everything but the source and the
// symbol is carried from the row stored at the time of the write.
const editShare = (fields: { quoteSource: 'eodhd' | 'manual'; symbol?: string }) => () =>
  holdingsRepo.updateShareFromStored(HOLDING_ID, { name: 'Apple', color: null }, (stored) => {
    const meta = asShareMeta(stored);
    const sameListing = meta?.quoteSource === 'eodhd' && meta.symbol === fields.symbol;

    return {
      quoteSource: fields.quoteSource,
      ...foldMap(maybe(fields.symbol), (symbol) => ({ symbol })),
      ...foldMap(maybe(sameListing ? meta?.quoteCurrency : undefined), (unit) => ({
        quoteCurrency: unit,
      })),
      lots: meta?.lots ?? [],
    };
  });

const exportAndRestore = async (): Promise<void> => {
  const backup = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

  openDatabase({ lots: [], share: [] });
  mockDatabase.exec('DELETE FROM holdings');
  await restoreDataSnapshot(backup);
};

const unchanged = async (): Promise<void> => undefined;

const BASE_READINGS: Reading[] = [
  { at: february10, quantity: '10', value: 150_000, cost: 100_000 },
  { at: april10, quantity: '6', value: 150_000, cost: 60_000 },
];

const cells: Cell[] = [
  {
    operation: 'none',
    state: 'buy 10 for 1,000 in January, sell 4 in March',
    given: {},
    act: unchanged,
    expected: BASE_READINGS,
  },
  {
    operation: 'create lot',
    state: 'buy 5 for 900 after every lot',
    given: {},
    act: changeLots({ kind: 'add', lot: buy(april10, '5', 90_000) }),
    expected: [{ at: april10, quantity: '11', value: 275_000, cost: 150_000 }],
  },
  {
    operation: 'create lot',
    state: 'buy 10 for 3,000 backdated before the March sell',
    given: {},
    act: changeLots({ kind: 'add', lot: buy(february10, '10', 300_000) }),
    expected: [
      { at: february10, quantity: '20', value: 300_000, cost: 400_000 },
      { at: april10, quantity: '16', value: 400_000, cost: 320_000 },
    ],
  },
  {
    operation: 'create lot',
    state: 'sell 2 of the 6 held',
    given: {},
    act: changeLots({ kind: 'add', lot: sell(april10, '2') }),
    expected: [{ at: april10, quantity: '4', value: 100_000, cost: 40_000 }],
  },
  {
    operation: 'create lot',
    state: 'sell 7 of the 6 held',
    given: {},
    act: changeLots({ kind: 'add', lot: sell(april10, '7') }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'create lot',
    state: 'backdated sell 7 leaves too few for the March sell',
    given: {},
    act: changeLots({ kind: 'add', lot: sell(february10, '7') }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'edit lot quantity',
    state: 'the buy, 10 to 20',
    given: {},
    act: changeLots({ kind: 'edit', index: 0, lot: buy(january10, '20', 100_000) }),
    expected: [{ at: april10, quantity: '16', value: 400_000, cost: 80_000 }],
  },
  {
    operation: 'edit lot quantity',
    state: 'the buy, 10 to 3, below the March sell',
    given: {},
    act: changeLots({ kind: 'edit', index: 0, lot: buy(january10, '3', 100_000) }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'edit lot quantity',
    state: 'the sell, 4 to 5',
    given: {},
    act: changeLots({ kind: 'edit', index: 1, lot: sell(march10, '5') }),
    expected: [{ at: april10, quantity: '5', value: 125_000, cost: 50_000 }],
  },
  {
    operation: 'edit lot quantity',
    state: 'the sell, 4 to 11',
    given: {},
    act: changeLots({ kind: 'edit', index: 1, lot: sell(march10, '11') }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'edit lot cost',
    state: 'the buy, 1,000 to 2,000',
    given: {},
    act: changeLots({ kind: 'edit', index: 0, lot: buy(january10, '10', 200_000) }),
    expected: [{ at: april10, quantity: '6', value: 150_000, cost: 120_000 }],
  },
  {
    operation: 'edit lot date',
    state: 'the buy, January to February',
    given: {},
    act: changeLots({ kind: 'edit', index: 0, lot: buy(february10, '10', 100_000) }),
    expected: [
      { at: january10, quantity: '0', value: 0, cost: 0 },
      { at: february10, quantity: '10', value: 150_000, cost: 100_000 },
    ],
  },
  {
    operation: 'edit lot date',
    state: 'the sell, March to February',
    given: {},
    act: changeLots({ kind: 'edit', index: 1, lot: sell(february10, '4') }),
    expected: [{ at: february10, quantity: '6', value: 90_000, cost: 60_000 }],
  },
  {
    operation: 'delete lot',
    state: 'the sell',
    given: {},
    act: changeLots({ kind: 'remove', index: 1 }),
    expected: [{ at: april10, quantity: '10', value: 250_000, cost: 100_000 }],
  },
  {
    operation: 'delete lot',
    state: 'the buy the March sell needs',
    given: {},
    act: changeLots({ kind: 'remove', index: 0 }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'delete lot',
    state: 'a backdated buy the March sell was re-costed for',
    given: {
      lots: [BASE_LOTS[0], sell(march10, '4', -80_000), buy(february10, '10', 300_000)],
    },
    act: changeLots({ kind: 'remove', index: 2 }),
    expected: BASE_READINGS,
  },
  {
    operation: 'delete lot',
    state: 'the January buy, a same-day buy covers the March sell',
    given: { lots: SAME_DAY_LOTS },
    act: changeLots({ kind: 'remove', index: 0 }),
    expected: [
      { at: february10, quantity: '0', value: 0, cost: 0 },
      { at: april10, quantity: '6', value: 150_000, cost: 180_000 },
    ],
    storedLots: [sell(march10, '4', -120_000), buy(march10, '10', 300_000)],
  },
  {
    operation: 'delete lot',
    state: 'the only buy, no sell',
    given: { lots: [BASE_LOTS[0]] },
    act: changeLots({ kind: 'remove', index: 0 }),
    expected: [{ at: april10, quantity: '0', value: 0, cost: 0 }],
    storedLots: [],
  },
  {
    operation: 'edit lot quantity',
    state: 'the sell recorded before a same-day buy, 4 to 15',
    given: { lots: SAME_DAY_LOTS },
    act: changeLots({ kind: 'edit', index: 1, lot: sell(march10, '15') }),
    expected: [{ at: april10, quantity: '5', value: 125_000, cost: 100_000 }],
    storedLots: [BASE_LOTS[0], sell(march10, '15', -300_000), buy(march10, '10', 300_000)],
  },
  {
    operation: 'edit lot date',
    state: 'the buy, January to after the March sell',
    given: {},
    act: changeLots({ kind: 'edit', index: 0, lot: buy(april10, '10', 100_000) }),
    rejects: true,
    expected: BASE_READINGS,
  },
  {
    operation: 'edit lot date',
    state: 'the January buy to April, a same-day buy covers the March sell',
    given: { lots: SAME_DAY_LOTS },
    act: changeLots({ kind: 'edit', index: 0, lot: buy(april10, '10', 100_000) }),
    expected: [
      { at: march10, quantity: '6', value: 120_000, cost: 180_000 },
      { at: april10, quantity: '16', value: 400_000, cost: 280_000 },
    ],
    storedLots: [
      buy(april10, '10', 100_000),
      sell(march10, '4', -120_000),
      buy(march10, '10', 300_000),
    ],
  },
  {
    operation: 'delete lot',
    state: 'metal: the January buy, a same-day buy covers the March sell',
    given: {
      type: 'metal',
      currency: 'UAH',
      meta: gold,
      lots: SAME_DAY_LOTS,
      share: [],
      metal: XAU,
    },
    act: changeLots({ kind: 'remove', index: 0 }),
    expected: [{ at: april10, quantity: '6', value: 240_000, cost: 180_000 }],
    storedLots: [sell(march10, '4', -120_000), buy(march10, '10', 300_000)],
  },
  {
    operation: 'none',
    state: '4:1 split on 1 March with no split lot',
    given: { lots: [BASE_LOTS[0]], share: SPLIT_AAPL },
    act: unchanged,
    expected: [{ at: april10, quantity: '10', value: 125_000, cost: 100_000 }],
  },
  {
    operation: 'split lot at 0 cost',
    state: '4:1 split on 1 March, buy 30 for 0',
    given: { lots: [BASE_LOTS[0]], share: SPLIT_AAPL },
    act: changeLots({ kind: 'add', lot: buy(march1, '30', 0) }),
    expected: [
      { at: february10, quantity: '10', value: 480_000, cost: 100_000 },
      { at: april10, quantity: '40', value: 500_000, cost: 100_000 },
    ],
  },
  {
    operation: 'split lot at 0 cost',
    state: 'after the split lot, sell 20 of 40',
    given: { lots: [BASE_LOTS[0], buy(march1, '30', 0)], share: SPLIT_AAPL },
    act: changeLots({ kind: 'add', lot: sell(april10, '20') }),
    expected: [{ at: april10, quantity: '20', value: 250_000, cost: 50_000 }],
  },
  {
    operation: 'source switch EODHD to Manual',
    state: 'no manual prices yet',
    given: {},
    act: editShare({ quoteSource: 'manual' }),
    expected: BASE_READINGS,
    ownSeries: AAPL,
  },
  {
    operation: 'source switch EODHD to Manual',
    state: 'the symbol has no close yet',
    given: { share: [] },
    act: editShare({ quoteSource: 'manual' }),
    expected: [{ at: february10, quantity: '10', value: 100_000, cost: 100_000 }],
    ownSeries: [],
  },
  {
    operation: 'source switch EODHD to Manual',
    state: 'manual prices kept from before EODHD, one inside its closes',
    given: {
      own: [
        { instant: january5, price: '80' },
        { instant: february14, price: '97' },
      ],
    },
    act: editShare({ quoteSource: 'manual' }),
    expected: [{ at: february14, quantity: '10', value: 150_000, cost: 100_000 }],
    ownSeries: [{ instant: january5, price: '80' }, ...AAPL],
  },
  {
    operation: 'source switch Manual to EODHD',
    state: 'manual prices on the holding',
    given: {
      meta: manual,
      own: [
        { instant: january10, price: '90' },
        { instant: february10, price: '95' },
      ],
    },
    act: editShare({ quoteSource: 'eodhd', symbol: 'AAPL.US' }),
    expected: BASE_READINGS,
    ownSeries: [
      { instant: january10, price: '90' },
      { instant: february10, price: '95' },
    ],
  },
  {
    operation: 'source switch Manual to Manual',
    state: 'a rename only',
    given: { meta: manual, own: [{ instant: january10, price: '90' }] },
    act: editShare({ quoteSource: 'manual' }),
    expected: [{ at: february10, quantity: '10', value: 90_000, cost: 100_000 }],
    ownSeries: [{ instant: january10, price: '90' }],
  },
  {
    operation: 'source switch EODHD to EODHD',
    state: 'a new ticker with no close yet',
    given: {},
    act: editShare({ quoteSource: 'eodhd', symbol: 'MSFT.US' }),
    expected: [{ at: february10, quantity: '10', value: 100_000, cost: 100_000 }],
    ownSeries: [],
  },
  {
    operation: 'refresh after edit',
    state: "the refresh stored the new ticker's close",
    given: {},
    act: async () => {
      await editShare({ quoteSource: 'eodhd', symbol: 'MSFT.US' })();
      mockDatabase
        .prepare(
          'INSERT INTO price_points (instrument, day, price, currency, source) VALUES (?, ?, ?, ?, ?)',
        )
        .run(shareInstrument('MSFT.US'), dayKeyOf(february10), '300', 'USD', 'eodhd');
    },
    expected: [{ at: february10, quantity: '10', value: 300_000, cost: 100_000 }],
  },
  {
    operation: 'none',
    state: 'currency mismatch: UAH holding, USD closes',
    given: { currency: 'UAH' },
    act: unchanged,
    expected: [{ at: february10, quantity: '10', value: 100_000, cost: 100_000 }],
  },
  {
    operation: 'listing notice on the detail (display only)',
    state: 'currency mismatch: UAH holding, USD unit stored, USD closes',
    given: { currency: 'UAH' },
    act: unchanged,
    expected: [
      { at: february10, quantity: '10', value: 100_000, cost: 100_000 },
      { at: april10, quantity: '6', value: 60_000, cost: 60_000 },
    ],
    ownSeries: [],
    storedLots: BASE_LOTS,
  },
  {
    operation: 'source switch EODHD to Manual',
    state: 'currency mismatch: UAH holding, USD closes',
    given: { currency: 'UAH' },
    act: editShare({ quoteSource: 'manual' }),
    expected: [{ at: february10, quantity: '10', value: 100_000, cost: 100_000 }],
    ownSeries: [],
  },
  {
    operation: 'source switch EODHD to Manual',
    state: 'currency mismatch: UAH holding, USD closes, UAH prices typed inside their span',
    given: {
      currency: 'UAH',
      own: [
        { instant: january10, price: '4000' },
        { instant: february14, price: '4100' },
      ],
    },
    act: editShare({ quoteSource: 'manual' }),
    expected: [{ at: february14, quantity: '10', value: 4_100_000, cost: 100_000 }],
    ownSeries: [
      { instant: january10, price: '4000' },
      { instant: february14, price: '4100' },
    ],
  },
  {
    operation: 'restore from .kiko',
    state: 'a backdated buy and a switch to Manual before the backup',
    given: {},
    act: async () => {
      await changeLots({ kind: 'add', lot: buy(february10, '10', 300_000) })();
      await editShare({ quoteSource: 'manual' })();
      await exportAndRestore();
    },
    expected: [
      { at: february10, quantity: '20', value: 300_000, cost: 400_000 },
      { at: april10, quantity: '16', value: 400_000, cost: 320_000 },
    ],
    ownSeries: AAPL,
  },
];

describe('share lots and prices, operation x state', () => {
  it.each(cells)('$operation · $state', async (cell) => {
    openDatabase(cell.given);

    if (cell.rejects === true) {
      await expect(cell.act()).rejects.toThrow();
    } else {
      await cell.act();
    }

    for (const expected of cell.expected) {
      expect(await reading(expected.at)).toEqual(expected);
    }

    if (cell.ownSeries !== undefined) {
      expect(await ownSeries()).toEqual(
        cell.ownSeries.map((point) => ({ instant: dayKeyOf(point.instant), price: point.price })),
      );
    }

    if (cell.storedLots !== undefined) {
      expect(lotsOf(await storedHolding())).toEqual(cell.storedLots);
    }
  });
});
