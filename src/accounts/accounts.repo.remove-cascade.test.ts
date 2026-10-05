// Deleting an account deletes the movements its holdings were part of, exactly as
// deleting each holding would: the legs left in other accounts, the rest of a
// split, the contributions to a deposit, and the source legs of a deposit that
// goes with it. A real engine shows that every balance, row and the deposit
// metadata come back to what they were before the movement.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

const mockClearToken = jest.fn();
jest.mock('@kiko/monobank/token', () => ({
  clearToken: (accountId: string) => mockClearToken(accountId),
}));

const mockClearCredentials = jest.fn();
jest.mock('@kiko/crypto-sync/binance', () => ({
  clearCredentials: (accountId: string) => mockClearCredentials(accountId),
}));

import { DatabaseSync } from 'node:sqlite';
import { transactionsRepo } from '@kiko/transactions/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { MOVED, NAMES, deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';

import { accountsRepo } from './accounts.repo';

const {
  run,
  seedFixture,
  insertRow,
  balancesOf,
  rowIds,
  contributionsOf,
  stateOf,
  withoutHoldings,
} = deleteCascadeFixture(() => mockDatabase);

const accountExists = (accountId: string): boolean =>
  mockDatabase.prepare('SELECT 1 FROM accounts WHERE id = ?').get(accountId) !== undefined;

// The account under test keeps only `kept`; every other holding of the fixture
// moves to another account, so the delete has partners outside the account.
const keepOnly = (...kept: string[]): void => {
  for (const holdingId of ['uah', 'usd', 'cash', 'second', 'deposit']) {
    if (!kept.includes(holdingId)) {
      run("UPDATE holdings SET account_id = 'other' WHERE id = ?", holdingId);
    }
  }
};

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

beforeEach(() => {
  mockClearToken.mockReset();
  mockClearCredentials.mockReset();
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedFixture();
});

describe('deleting an account whose holdings hold the legs of a movement', () => {
  it('deletes nothing outside it when both legs of an Exchange are in the account', async () => {
    keepOnly('uah', 'usd');
    const before = stateOf();

    await exchangeUahToUsd();
    await accountsRepo.remove('account');

    expect(stateOf()).toEqual({ ...withoutHoldings(before, 'uah', 'usd'), rows: [] });
    expect(accountExists('account')).toBe(false);
  });

  it('deletes the leg of an Exchange that sits in another account', async () => {
    keepOnly('uah');
    const before = stateOf();

    await exchangeUahToUsd();
    await accountsRepo.remove('account');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
    expect(accountExists('account')).toBe(false);
  });

  it('deletes the returns of a split payment that sit in other accounts', async () => {
    keepOnly('uah');
    const before = stateOf();

    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
      returns: [
        { holdingId: 'cash', amountMinorUnits: 10_000 },
        { holdingId: 'second', amountMinorUnits: 5_000 },
      ],
    });
    await accountsRepo.remove('account');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
  });

  it('removes the contribution a leg made to a deposit in another account', async () => {
    keepOnly('uah');
    const before = stateOf();

    await exchangeUahIntoDeposit();
    await accountsRepo.remove('account');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
  });

  it('deletes the source leg of a deposit that goes with the account', async () => {
    keepOnly('deposit');
    const before = stateOf();

    await exchangeUahIntoDeposit();
    await accountsRepo.remove('account');

    expect(balancesOf().uah).toBe(before.balances.uah);
    expect(rowIds()).toEqual([]);
    expect(accountExists('account')).toBe(false);
  });

  it('deletes the legs that paid into a deposit once, with the account that holds both', async () => {
    keepOnly('uah', 'deposit');
    const before = stateOf();

    await exchangeUahIntoDeposit();
    await accountsRepo.remove('account');

    expect(balancesOf()).toEqual(withoutHoldings(before, 'uah', 'deposit').balances);
    expect(rowIds()).toEqual([]);
    expect(accountExists('account')).toBe(false);
  });

  it('keeps a bank row that pairs with a leg of the account', async () => {
    keepOnly('usd');
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

    await accountsRepo.remove('account');

    expect(rowIds()).toEqual(['bank-expense']);
  });

  it('judges a partner by the boundary of its own holding', async () => {
    keepOnly('uah');
    insertRow({
      id: 'sync-row',
      holdingId: 'usd',
      amountMinorUnits: 100,
      time: MOVED + 1_000,
      source: 'monobank',
    });
    run('UPDATE holdings SET balance_minor_units = 100 WHERE id = ?', 'usd');
    const before = stateOf();

    await exchangeUahToUsd();
    await accountsRepo.remove('account');

    expect(stateOf()).toEqual(withoutHoldings(before, 'uah'));
    expect(balancesOf().usd).toBe(100);
    expect(contributionsOf('deposit')).toEqual(before.contributions);
  });
});

// The confirm states each balance change before the delete; the write must move
// each remaining balance by exactly that.
describe('the balance changes an account delete states are the ones it writes', () => {
  // Every remaining holding is compared, so one the plan does not list must not move.
  const movedByDeleting = async (
    holdingIds: string[],
  ): Promise<{ planned: Record<string, number>; written: Record<string, number> }> => {
    const plan = await transactionsRepo.removeHoldingsPlan(holdingIds);
    const before = balancesOf();

    await accountsRepo.remove('account');

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

  it('agrees for an exchange whose other leg sits in another account', async () => {
    keepOnly('uah');
    await exchangeUahToUsd();

    const { planned, written } = await movedByDeleting(['uah']);

    expect(planned).toEqual({ 'Dollar card': -1_000 });
    expect(written).toEqual(planned);
  });

  it('agrees for a split whose returns sit in other accounts', async () => {
    keepOnly('uah');
    await transactionsRepo.recordManualWithReturns({
      payment: { holdingId: 'uah', amountMinorUnits: -50_000, time: MOVED, category: 'groceries' },
      returns: [
        { holdingId: 'cash', amountMinorUnits: 10_000 },
        { holdingId: 'second', amountMinorUnits: 5_000 },
      ],
    });

    const { planned, written } = await movedByDeleting(['uah']);

    expect(planned).toEqual({ Cash: -10_000, 'Second card': -5_000 });
    expect(written).toEqual(planned);
  });
});

describe('an account delete that cannot finish', () => {
  it('rolls back every partner row, balance and contribution, and keeps the Keychain items', async () => {
    keepOnly('uah');
    await exchangeUahToUsd();
    await exchangeUahIntoDeposit();
    mockDatabase.exec(
      "CREATE TRIGGER refuse_account_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    const before = stateOf();

    await expect(accountsRepo.remove('account')).rejects.toThrow(/delete from "accounts"/);

    expect(stateOf()).toEqual(before);
    expect(accountExists('account')).toBe(true);
    expect(mockClearToken).not.toHaveBeenCalled();
  });

  it('refuses a synced account and leaves the legs of its holdings’ partners alone', async () => {
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
    const before = stateOf();

    await expect(accountsRepo.remove('synced')).rejects.toThrow(/synced account/);

    expect(stateOf()).toEqual(before);
  });
});
