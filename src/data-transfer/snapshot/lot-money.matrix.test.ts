let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import {
  database,
  holdings,
  pricePoints,
  type HoldingRow,
  type SettingsRow,
  type PricePointRow,
} from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import { holdingsRepo } from '@kiko/holdings/repo';
import { metalInstrument } from '@kiko/prices/instrument';
import { recostStoredLots } from '@kiko/holdings/lot-recost';
import { asMetalMeta } from '@kiko/holdings/holding-metadata';
import { buildPriceBook, dayKeyOf } from '@kiko/prices/price-book';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { holdingValueBreakdown } from '@kiko/holdings/holding-value';
import { quantityAt, SaleExceedsHoldingError, type Lot, type LotChange } from '@kiko/holdings/lots';

import { readDataSnapshot } from './read-snapshot';
import type { DataSnapshot } from './data-snapshot';
import { restoreDataSnapshot } from './restore-snapshot';

// Every money rule a metal's lots follow, as one operation x state table on
// the real schema: each cell names the value, cost basis, and quantity it must
// read on the given days afterwards.

const HOLDING_ID = 'metal-1';

const january10 = new Date(2026, 0, 10).getTime();
const february10 = new Date(2026, 1, 10).getTime();
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

// UAH per troy ounce.
const XAU: Price[] = [
  { instant: january10, price: '100' },
  { instant: february10, price: '150' },
  { instant: march10, price: '200' },
  { instant: april10, price: '250' },
];

// Bought 10 for 1,000 in January, sold 4 in March, and bought 10 for 3,000 on
// the day of that sale, recorded after it: the sale is costed after the buy.
const SAME_DAY_LOTS = [BASE_LOTS[0], sell(march10, '4', -80_000), buy(march10, '10', 300_000)];

// The March sale as an older build stored it once a February buy of 10 for
// 3,000 was added after it: still costed from the January buy alone.
const STALE_SALE_LOTS = [BASE_LOTS[0], sell(march10, '4', -40_000), buy(february10, '10', 300_000)];
const RECOSTED_SALE_LOTS = [
  BASE_LOTS[0],
  sell(march10, '4', -80_000),
  buy(february10, '10', 300_000),
];
const RECOSTED_SALE_READINGS: Reading[] = [
  { at: february10, quantity: '20', value: 300_000, cost: 400_000 },
  { at: april10, quantity: '16', value: 400_000, cost: 320_000 },
];

type State = {
  lots?: Lot[];
};

type Reading = { at: number; quantity: string; value: number; cost: number };

type Cell = {
  operation: string;
  state: string;
  given: State;
  act: () => Promise<unknown>;
  rejects?: boolean;
  expected: Reading[];
  storedLots?: Lot[];
};

const gold = { metal: 'XAU', form: 'bar', unit: 'oz', purity: '1' };

const openDatabase = (given: State): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('INSERT INTO settings (id) VALUES (1)');
  mockDatabase
    .prepare("INSERT INTO accounts (id, name, kind) VALUES ('metals-1', 'Metals', 'metals')")
    .run();
  mockDatabase
    .prepare(
      `INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units, metadata)
       VALUES (?, 'metals-1', 'Gold', 'metal', 'UAH', 0, ?)`,
    )
    .run(HOLDING_ID, JSON.stringify({ ...gold, lots: given.lots ?? BASE_LOTS }));

  const insertPrice = mockDatabase.prepare(
    'INSERT INTO price_points (instrument, day, price, currency, source) VALUES (?, ?, ?, ?, ?)',
  );

  for (const point of XAU) {
    insertPrice.run(metalInstrument('XAU'), dayKeyOf(point.instant), point.price, 'UAH', 'nbu');
  }
};

const storedHolding = async (): Promise<HoldingRow> => {
  const rows = await database.select().from(holdings);

  return rows[0];
};

const storedPrices = (): Promise<PricePointRow[]> => database.select().from(pricePoints);

const lotsOf = (holding: HoldingRow): Lot[] => asMetalMeta(holding.metadata)?.lots ?? [];

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

const exportAndRestore = async (): Promise<void> => {
  const backup = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;

  openDatabase({ lots: [] });
  mockDatabase.exec('DELETE FROM holdings');
  await restoreDataSnapshot(backup);
};

// A backup made before the one-time recost has no flag key, so it restores
// unrecosted onto a device that already ran its own recost.
const restoreBackupFromBeforeTheRecost = async (): Promise<void> => {
  const backup = JSON.parse(JSON.stringify(await readDataSnapshot())) as DataSnapshot;
  const { lotsRecosted: _flag, ...olderSettings } = backup.settings[0];

  openDatabase({ lots: [] });
  mockDatabase.exec('DELETE FROM holdings');
  await recostStoredLots();
  await restoreDataSnapshot({ ...backup, settings: [olderSettings as SettingsRow] });
  await recostStoredLots();
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
    operation: 'recost at app open',
    state: 'a sale an older build costed before a later-added backdated buy',
    given: { lots: STALE_SALE_LOTS },
    act: recostStoredLots,
    expected: RECOSTED_SALE_READINGS,
    storedLots: RECOSTED_SALE_LOTS,
  },
  {
    operation: 'recost at app open',
    state: 'every sale cost already right',
    given: {},
    act: recostStoredLots,
    expected: BASE_READINGS,
    storedLots: BASE_LOTS,
  },
  {
    operation: 'recost at app open',
    state: 'a sale larger than what is held before it, stored by an older build',
    given: { lots: [buy(january10, '3', 30_000), sell(march10, '5', -30_000)] },
    act: recostStoredLots,
    expected: [
      { at: february10, quantity: '3', value: 45_000, cost: 30_000 },
      { at: april10, quantity: '0', value: 0, cost: 0 },
    ],
    storedLots: [buy(january10, '3', 30_000), sell(march10, '5', -30_000)],
  },
  {
    operation: 'restore from .kiko, then recost',
    state: 'a backup made before the recost, with a stale sale cost',
    given: { lots: STALE_SALE_LOTS },
    act: restoreBackupFromBeforeTheRecost,
    expected: RECOSTED_SALE_READINGS,
    storedLots: RECOSTED_SALE_LOTS,
  },
  {
    operation: 'restore from .kiko',
    state: 'a backdated buy before the backup',
    given: {},
    act: async () => {
      await changeLots({ kind: 'add', lot: buy(february10, '10', 300_000) })();
      await exportAndRestore();
    },
    expected: RECOSTED_SALE_READINGS,
  },
];

describe('metal lots, operation x state', () => {
  it.each(cells)('$operation · $state', async (cell) => {
    openDatabase(cell.given);

    if (cell.rejects === true) {
      await expect(cell.act()).rejects.toThrow(SaleExceedsHoldingError);
    } else {
      await cell.act();
    }

    for (const expected of cell.expected) {
      expect(await reading(expected.at)).toEqual(expected);
    }

    if (cell.storedLots !== undefined) {
      expect(lotsOf(await storedHolding())).toEqual(cell.storedLots);
    }
  });
});
