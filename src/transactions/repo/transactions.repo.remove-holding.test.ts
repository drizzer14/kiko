// Deleting a holding deletes the movements it was one part of: the other legs of
// an Exchange or Convert, the rest of a split, the contributions its legs made to
// a deposit, and the source legs of a deposit that is deleted. Only a real engine
// shows that every balance, every row, the deposit metadata and the holding come
// back to what they were before the movement, so each case compares the whole
// state with its state before.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { MOVED, OPENED, deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';

import type { RemoveHoldingsPlan } from '../remove-notice';

import { transactionsRepo } from './transactions.repo';

const {
  run,
  insertHolding,
  seedFixture,
  insertRow,
  setBalance,
  setContributions,
  balancesOf,
  rowIds,
  contributionsOf,
  stateOf,
  withoutHoldings,
  idOfRowOn,
} = deleteCascadeFixture(() => mockDatabase);

const NOTHING_ELSE: RemoveHoldingsPlan = {
  deletedRows: { count: 0, names: [] },
  reversedContributions: [],
  keptContributions: [],
  keptSynced: [],
  unlinked: [],
  unlinkedPlain: false,
};

// What a holdings delete takes and leaves, without the balance lines that `the
// balance changes a holdings delete states` read.
const linkageOf = async (holdingIds: string[]): Promise<RemoveHoldingsPlan> => {
  const { balanceChanges: _balanceChanges, ...linkage } =
    await transactionsRepo.removeHoldingsPlan(holdingIds);

  return linkage;
};

const planWith = (part: Partial<RemoveHoldingsPlan>): RemoveHoldingsPlan => ({
  ...NOTHING_ELSE,
  ...part,
});

const idOfRowOnSource = (holdingId: string): string =>
  (
    mockDatabase.prepare('SELECT id FROM transactions WHERE holding_id = ?').get(holdingId) as {
      id: string;
    }
  ).id;

const holdingExists = (holdingId: string): boolean =>
  mockDatabase.prepare('SELECT 1 FROM holdings WHERE id = ?').get(holdingId) !== undefined;

const exchangeUahToUsd = (): Promise<void> =>
  transactionsRepo.recordExchange({
    sourceHoldingId: 'uah',
    valueOutMinorUnits: 40_000,
    destinationHoldingId: 'usd',
    destinationType: 'card',
    valueInMinorUnits: 1_000,
    time: MOVED,
  });

const exchangeUahIntoDeposit = (): Promise<void> =>
  transactionsRepo.recordExchange({
    sourceHoldingId: 'uah',
    valueOutMinorUnits: 40_000,
    destinationHoldingId: 'deposit',
    destinationType: 'term_deposit',
    valueInMinorUnits: 40_000,
    time: MOVED,
  });

const splitPayment = (): Promise<void> =>
  transactionsRepo.recordManualWithReturns({
    payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
    returns: [
      { holdingId: 'cash', amountMinorUnits: 10_000 },
      { holdingId: 'second', amountMinorUnits: 5_000 },
    ],
  });

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedFixture();
});

describe('deleting a holding that holds a leg of an Exchange', () => {
  it('deletes the other leg and brings its balance back', async () => {
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.removeHolding('uah');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
    expect(holdingExists('uah')).toBe(false);
  });

  it('names the holding the other leg sits on', async () => {
    await exchangeUahToUsd();

    expect(await linkageOf(['uah'])).toEqual(
      planWith({ deletedRows: { count: 1, names: ['Dollar card'] } }),
    );
  });

  it('states the balance change of the other holding only, in its own currency', async () => {
    await exchangeUahToUsd();

    expect((await transactionsRepo.removeHoldingsPlan(['uah'])).balanceChanges).toEqual([
      { name: 'Dollar card', currency: 'USD', minorUnits: -1_000 },
    ]);
    expect((await transactionsRepo.removeHoldingsPlan(['usd'])).balanceChanges).toEqual([
      { name: 'Hryvnia card', currency: 'UAH', minorUnits: 40_000 },
    ]);
  });

  it('states one line for each other holding a split takes from', async () => {
    await splitPayment();

    expect((await transactionsRepo.removeHoldingsPlan(['uah'])).balanceChanges).toEqual([
      { name: 'Cash', currency: 'UAH', minorUnits: -10_000 },
      { name: 'Second card', currency: 'UAH', minorUnits: -5_000 },
    ]);
  });

  it('states no balance change when both legs are deleted', async () => {
    await exchangeUahToUsd();

    expect(
      (await transactionsRepo.removeHoldingsPlan(['uah', 'usd'])).balanceChanges,
    ).toBeUndefined();
  });

  it('deletes the leg of a destination holding the same way', async () => {
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.removeHolding('usd');

    expect(stateOf()).toEqual(withoutHoldings(before, 'usd'));
  });

  it('plans and deletes nothing outside two holdings that hold both legs', async () => {
    const before = stateOf();

    await exchangeUahToUsd();

    expect(await linkageOf(['uah', 'usd'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('uah');
    await transactionsRepo.removeHolding('usd');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah', 'usd'));
  });

  it('leaves a partner balance alone when its holding was anchored by a newer bank row', async () => {
    insertRow({
      id: 'sync-row',
      holdingId: 'usd',
      amountMinorUnits: 100,
      time: MOVED + 1_000,
      source: 'monobank',
    });
    setBalance('usd', 100);
    const before = stateOf();

    await exchangeUahToUsd();
    await transactionsRepo.removeHolding('uah');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
    expect(balancesOf().usd).toBe(100);
  });
});

describe('deleting a holding that holds a leg of a Convert', () => {
  it('deletes the manual leg that pairs with a bank row of a disconnected holding', async () => {
    insertRow({
      id: 'bank-expense',
      holdingId: 'detached',
      amountMinorUnits: -40_000,
      source: 'monobank',
      exchangePairId: 'pair',
    });
    insertRow({
      id: 'usd-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'detached',
      exchangePairId: 'pair',
    });
    setBalance('usd', 1_000);

    expect(await linkageOf(['detached'])).toEqual(
      planWith({ deletedRows: { count: 1, names: ['Dollar card'] } }),
    );

    await transactionsRepo.removeHolding('detached');

    expect(rowIds()).toEqual([]);
    expect(balancesOf().usd).toBe(0);
    expect(holdingExists('detached')).toBe(false);
  });

  it('keeps the bank row that pairs with a manual leg and names its holding', async () => {
    insertRow({
      id: 'bank-expense',
      holdingId: 'bank',
      amountMinorUnits: -40_000,
      source: 'monobank',
      exchangePairId: 'pair',
    });
    insertRow({
      id: 'usd-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'bank',
      exchangePairId: 'pair',
    });
    setBalance('usd', 1_000);

    expect(await linkageOf(['usd'])).toEqual(planWith({ keptSynced: ['Monobank card'] }));

    await transactionsRepo.removeHolding('usd');

    expect(rowIds()).toEqual(['bank-expense']);
    expect(balancesOf().bank).toBe(0);
  });
});

describe('deleting a holding that holds a leg no partner can be found for', () => {
  it('deletes nothing outside it and names the holding the leg points at', async () => {
    insertRow({
      id: 'legacy-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    setBalance('usd', 1_000);

    expect(await linkageOf(['uah'])).toEqual(planWith({ unlinked: ['Dollar card'] }));

    await transactionsRepo.removeHolding('uah');

    expect(balancesOf().usd).toBe(1_000);
  });

  it('only says some part is missing when the holding the leg points at is gone', async () => {
    insertRow({
      id: 'legacy-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'long-gone',
    });

    expect(await linkageOf(['uah'])).toEqual(planWith({ unlinkedPlain: true }));
  });

  it('names nothing when the holding the leg points at is deleted with it', async () => {
    insertRow({
      id: 'legacy-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });

    expect(await linkageOf(['uah', 'usd'])).toEqual(NOTHING_ELSE);
  });

  it('treats a pair id that no other row carries as a leg with no partner', async () => {
    insertRow({
      id: 'lonely-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
      exchangePairId: 'pair',
    });

    expect(await linkageOf(['uah'])).toEqual(planWith({ unlinked: ['Dollar card'] }));
  });
});

describe('deleting a holding that holds a row of a split payment', () => {
  it('deletes the returns of a payment held by the holding', async () => {
    const before = stateOf();

    await splitPayment();

    expect(await linkageOf(['uah'])).toEqual(
      planWith({ deletedRows: { count: 2, names: ['Cash', 'Second card'] } }),
    );

    await transactionsRepo.removeHolding('uah');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
  });

  it('deletes the whole group from a holding that holds one return', async () => {
    const before = stateOf();

    await splitPayment();

    expect(await linkageOf(['cash'])).toEqual(
      planWith({ deletedRows: { count: 2, names: ['Hryvnia card', 'Second card'] } }),
    );

    await transactionsRepo.removeHolding('cash');

    expect(stateOf()).toEqual(withoutHoldings(before, 'cash'));
  });

  it('follows a Convert on a split row to every part of the movement', async () => {
    const before = stateOf();

    await splitPayment();
    await transactionsRepo.recordExchangeCounterpart({
      direction: 'record-destination',
      counterpartHoldingId: 'usd',
      counterpartType: 'card',
      amountMinorUnits: 1_000,
      existingTransactionId: idOfRowOn('uah'),
      existingHoldingId: 'uah',
      time: MOVED,
    });
    await transactionsRepo.removeHolding('second');

    expect(stateOf()).toEqual(withoutHoldings(before, 'second'));
  });
});

describe('deleting a holding that funded a term deposit', () => {
  it('removes the contribution its leg made', async () => {
    const before = stateOf();

    await exchangeUahIntoDeposit();

    expect(await linkageOf(['uah'])).toEqual(planWith({ reversedContributions: ['Deposit'] }));

    await transactionsRepo.removeHolding('uah');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
  });

  it.each([
    [
      'no contribution has the date',
      [
        { amountMinorUnits: 500_000, date: OPENED },
        { amountMinorUnits: 40_000, date: MOVED + 1 },
      ],
    ],
    [
      'two contributions have the date',
      [
        { amountMinorUnits: 500_000, date: OPENED },
        { amountMinorUnits: 40_000, date: MOVED },
        { amountMinorUnits: 40_000, date: MOVED },
      ],
    ],
    ['it is the last contribution', [{ amountMinorUnits: 40_000, date: MOVED }]],
  ])('keeps the contributions and names the deposit when %s', async (_case, contributions) => {
    await exchangeUahIntoDeposit();
    setContributions(contributions);

    expect(await linkageOf(['uah'])).toEqual(planWith({ keptContributions: ['Deposit'] }));

    await transactionsRepo.removeHolding('uah');

    expect(contributionsOf('deposit')).toEqual(contributions);
    expect(holdingExists('uah')).toBe(false);
  });

  it('leaves the deposit alone, and deletes the holding, when the deposit metadata is unreadable', async () => {
    await exchangeUahIntoDeposit();
    run("UPDATE holdings SET metadata = '{}' WHERE id = 'deposit'");

    await transactionsRepo.removeHolding('uah');

    expect(holdingExists('uah')).toBe(false);
    expect(rowIds()).toEqual([]);
  });
});

describe('deleting a holding that a leg elsewhere only names as its marker', () => {
  it('leaves a leg whose marker names a card, not a deposit, where it is', async () => {
    insertRow({
      id: 'legacy-leg',
      holdingId: 'uah',
      amountMinorUnits: -40_000,
      exchangeCounterpartHoldingId: 'usd',
    });
    setBalance('uah', 60_000);

    expect(await linkageOf(['usd'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('usd');

    expect(rowIds()).toEqual(['legacy-leg']);
    expect(balancesOf().uah).toBe(60_000);
  });

  it('plans nothing for the legs that paid into a deposit deleted with their own holding', async () => {
    await exchangeUahIntoDeposit();

    expect(await linkageOf(['uah', 'deposit'])).toEqual(NOTHING_ELSE);
  });
});

describe('deleting a term deposit that was funded by an exchange', () => {
  it('deletes the source leg and gives the money back to its holding', async () => {
    const before = stateOf();

    await exchangeUahIntoDeposit();

    expect(await linkageOf(['deposit'])).toEqual(
      planWith({ deletedRows: { count: 1, names: ['Hryvnia card'] } }),
    );

    await transactionsRepo.removeHolding('deposit');

    expect(balancesOf()).toEqual(withoutHoldings(before, 'deposit').balances);
    expect(rowIds()).toEqual([]);
    expect(holdingExists('deposit')).toBe(false);
  });

  it('leaves a bank row alone when a Convert of it funded the deposit', async () => {
    insertRow({
      id: 'bank-expense',
      holdingId: 'bank',
      amountMinorUnits: -40_000,
      source: 'monobank',
      exchangePairId: 'pair',
    });

    expect(await linkageOf(['deposit'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('deposit');

    expect(rowIds()).toEqual(['bank-expense']);
  });
});

describe('deleting a holding that loans link to', () => {
  const linkPaymentToLoan = (): void => {
    insertHolding('loan', 'loan', 'UAH', 0);
    insertRow({ id: 'payment', holdingId: 'uah', amountMinorUnits: -1_000 });
    run(
      "UPDATE transactions SET loan_holding_id = 'loan', loan_link_source = 'manual' WHERE id = 'payment'",
    );
    setBalance('uah', 99_000);
  };

  it('keeps the payment of a deleted loan and clears its link', async () => {
    linkPaymentToLoan();

    expect(await linkageOf(['loan'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('loan');

    expect(rowIds()).toEqual(['payment']);
    expect(
      mockDatabase
        .prepare(
          "SELECT loan_holding_id AS linked, loan_link_source AS source FROM transactions WHERE id = 'payment'",
        )
        .get(),
    ).toEqual({ linked: null, source: null });
    expect(balancesOf().uah).toBe(99_000);
  });

  it('deletes the payment with the holding that holds it', async () => {
    linkPaymentToLoan();

    await transactionsRepo.removeHolding('uah');

    expect(rowIds()).toEqual([]);
    expect(holdingExists('loan')).toBe(true);
  });
});

describe('deleting a holding that holds no ledger', () => {
  it('clears the price series of a priced holding', async () => {
    insertHolding('property', 'property_item', 'UAH', 0);
    run(
      "INSERT INTO price_points (instrument, day, price, currency, source) VALUES ('holding:property', 1, '5000', 'UAH', 'manual')",
    );

    expect(await linkageOf(['property'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('property');

    expect(holdingExists('property')).toBe(false);
    expect(mockDatabase.prepare('SELECT 1 FROM price_points').get()).toBeUndefined();
  });

  it('deletes a disconnected holding whose rows are all the bank’s, with nothing else', async () => {
    insertRow({
      id: 'bank-row',
      holdingId: 'detached',
      amountMinorUnits: 100,
      source: 'monobank',
    });
    const before = stateOf();

    expect(await linkageOf(['detached'])).toEqual(NOTHING_ELSE);

    await transactionsRepo.removeHolding('detached');

    expect(stateOf()).toEqual({ ...withoutHoldings(before, 'detached'), rows: [] });
  });
});

describe('deleting a holding that mixes every kind of link', () => {
  it('deletes and reverses what it can, keeps the rest, and plans each part', async () => {
    const before = stateOf();

    insertHolding('extra', 'card', 'UAH', 0);
    await exchangeUahToUsd();
    await exchangeUahIntoDeposit();
    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'second', amountMinorUnits: -20_000, time: MOVED, category: 'food' },
      returns: [
        { holdingId: 'uah', amountMinorUnits: 10_000 },
        { holdingId: 'cash', amountMinorUnits: 10_000 },
      ],
    });
    insertRow({
      id: 'legacy-leg',
      holdingId: 'uah',
      amountMinorUnits: -100,
      exchangeCounterpartHoldingId: 'extra',
    });
    setBalance('extra', 7);

    expect(await linkageOf(['uah'])).toEqual(
      planWith({
        deletedRows: { count: 3, names: ['Cash', 'Dollar card', 'Second card'] },
        reversedContributions: ['Deposit'],
        unlinked: ['extra'],
      }),
    );

    await transactionsRepo.removeHolding('uah');

    expect(stateOf()).toEqual({
      ...withoutHoldings(before, 'uah'),
      balances: { ...withoutHoldings(before, 'uah').balances, extra: 7 },
      rows: [],
    });
  });
});

// The statement and the write are two reads of the ledger, so only a delete that
// moves each remaining balance by exactly what the plan said proves they agree.
describe('the balance changes a holdings delete states are the ones it writes', () => {
  const NAMES: Record<string, string> = {
    uah: 'Hryvnia card',
    usd: 'Dollar card',
    cash: 'Cash',
    second: 'Second card',
    deposit: 'Deposit',
  };

  const movedByDeleting = async (
    holdingIds: string[],
  ): Promise<{ planned: Record<string, number>; written: Record<string, number> }> => {
    const plan = await transactionsRepo.removeHoldingsPlan(holdingIds);
    const before = balancesOf();

    for (const holdingId of holdingIds) {
      await transactionsRepo.removeHolding(holdingId);
    }

    const after = balancesOf();

    return {
      planned: Object.fromEntries(
        (plan.balanceChanges ?? []).map((change) => [change.name, change.minorUnits]),
      ),
      written: Object.fromEntries(
        Object.keys(after)
          .filter((holdingId) => after[holdingId] !== before[holdingId])
          .map((holdingId) => [
            NAMES[holdingId] ?? holdingId,
            after[holdingId] - before[holdingId],
          ]),
      ),
    };
  };

  it.each(['uah', 'usd'])('agrees for an exchange, deleted with its %s holding', async (leg) => {
    await exchangeUahToUsd();

    const { planned, written } = await movedByDeleting([leg]);

    expect(planned).not.toEqual({});
    expect(written).toEqual(planned);
  });

  it.each(['uah', 'cash'])('agrees for a split, deleted with its %s holding', async (leg) => {
    await splitPayment();

    const { planned, written } = await movedByDeleting([leg]);

    expect(planned).not.toEqual({});
    expect(written).toEqual(planned);
  });

  it('agrees for an exchange into a deposit, deleted with the paying holding', async () => {
    await exchangeUahIntoDeposit();

    const { planned, written } = await movedByDeleting(['uah']);

    expect(written).toEqual(planned);
  });

  it('agrees for an exchange into a deposit, deleted with the deposit', async () => {
    await exchangeUahIntoDeposit();

    const { planned, written } = await movedByDeleting(['deposit']);

    expect(planned).toEqual({ 'Hryvnia card': 40_000 });
    expect(written).toEqual(planned);
  });
});

describe('a delete that cannot finish', () => {
  it('refuses a live-synced holding and leaves the partners of its rows alone', async () => {
    insertRow({
      id: 'bank-expense',
      holdingId: 'bank',
      amountMinorUnits: -40_000,
      source: 'monobank',
      exchangePairId: 'pair',
    });
    insertRow({
      id: 'usd-leg',
      holdingId: 'usd',
      amountMinorUnits: 1_000,
      exchangeCounterpartHoldingId: 'bank',
      exchangePairId: 'pair',
    });
    setBalance('usd', 1_000);
    const before = stateOf();

    await expect(transactionsRepo.removeHolding('bank')).rejects.toThrow(/synced holding/);

    expect(stateOf()).toEqual(before);
    expect(holdingExists('bank')).toBe(true);
  });

  it('rolls back every row, balance and contribution when the holding itself cannot go', async () => {
    await exchangeUahToUsd();
    await exchangeUahIntoDeposit();
    mockDatabase.exec(
      "CREATE TRIGGER refuse_holding_delete BEFORE DELETE ON holdings BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const before = stateOf();

    await expect(transactionsRepo.removeHolding('uah')).rejects.toThrow(/delete from "holdings"/);

    expect(stateOf()).toEqual(before);
    expect(holdingExists('uah')).toBe(true);
  });

  it('is a no-op when the holding is already gone', async () => {
    await exchangeUahToUsd();
    await transactionsRepo.removeHolding('uah');
    const after = stateOf();

    await expect(transactionsRepo.removeHolding('uah')).resolves.toBeUndefined();

    expect(stateOf()).toEqual(after);
  });

  it('never deletes a row the bank owns by the time the delete runs, whatever the plan read', async () => {
    await exchangeUahToUsd();

    expect(await linkageOf(['uah'])).toEqual(
      planWith({ deletedRows: { count: 1, names: ['Dollar card'] } }),
    );

    run("UPDATE transactions SET source = 'monobank', external_id = id WHERE holding_id = 'usd'");
    await transactionsRepo.removeHolding('uah');

    expect(rowIds()).toEqual([idOfRowOnSource('usd')]);
    expect(balancesOf().usd).toBe(1_000);
  });
});
