// A transaction and the template saved with it are written together or not at all. The template
// insert runs inside the transaction's own write() as `alongside`, so only a real engine shows
// that both commit, that a failure on either side takes the other back, and that a write that
// fails first never reaches the template.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { EMPTY_DRAFT } from '@kiko/transaction-templates/draft';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';
import { deleteCascadeFixture } from '@kiko/test-support/delete-cascade-fixture';

import { transactionsRepo } from './transactions.repo';

type Alongside = NonNullable<Parameters<typeof transactionsRepo.recordManual>[1]>;

type Case = {
  name: string;
  // Seeds what the write edits; nothing for a write that only adds rows.
  prepare: () => void;
  run: (alongside?: Alongside) => Promise<unknown>;
};

const { seedFixture, insertRow, balancesOf } = deleteCascadeFixture(() => mockDatabase);

const TIME = 1_700_000_000_000;
const EDITED_TIME = TIME + 60_000;

const saveTemplate: Alongside = async (databaseTransaction) => {
  await transactionTemplatesRepo.insertDatabaseTransaction(databaseTransaction, {
    name: 'Rent',
    draft: EMPTY_DRAFT,
  });
};

const saveTemplateThenFail: Alongside = async (databaseTransaction) => {
  await saveTemplate(databaseTransaction);

  throw new Error('alongside failed');
};

const templateNames = (): string[] =>
  (mockDatabase.prepare('SELECT name FROM transaction_templates').all() as { name: string }[]).map(
    ({ name }) => name,
  );

// Every row, by content: the generated ids differ between two runs of the same write.
const ledger = (): unknown[] =>
  mockDatabase
    .prepare(
      'SELECT holding_id, amount_minor_units, time, description FROM transactions ORDER BY time, holding_id, amount_minor_units',
    )
    .all();

// What a write can change: the rows, the stored balances and the templates.
const snapshot = (): {
  balances: Record<string, number>;
  ledger: unknown[];
  templates: string[];
} => ({
  balances: balancesOf(),
  ledger: ledger(),
  templates: templateNames(),
});

const failUpdatesOfTransactions = (): void => {
  mockDatabase.exec(
    "CREATE TRIGGER fail_update BEFORE UPDATE ON transactions BEGIN SELECT RAISE(ABORT, 'update failed'); END",
  );
};

const freshDatabase = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  seedFixture();
};

const CASES: Case[] = [
  {
    name: 'recordManual',
    prepare: () => undefined,
    run: (alongside) =>
      transactionsRepo.recordManual(
        { holdingId: 'uah', amountMinorUnits: -500, time: TIME },
        alongside,
      ),
  },
  {
    name: 'recordExchange',
    prepare: () => undefined,
    run: (alongside) =>
      transactionsRepo.recordExchange(
        {
          sourceHoldingId: 'uah',
          valueOutMinorUnits: 1_000,
          destinationHoldingId: 'usd',
          destinationType: 'card',
          valueInMinorUnits: 25,
          time: TIME,
        },
        alongside,
      ),
  },
  {
    name: 'recordManualWithReturns',
    prepare: () => undefined,
    run: (alongside) =>
      transactionsRepo.recordManualWithReturns(
        {
          payment: { holdingId: 'uah', amountMinorUnits: -500, time: TIME },
          returns: [{ holdingId: 'cash', amountMinorUnits: 100 }],
        },
        alongside,
      ),
  },
  {
    name: 'update',
    prepare: () =>
      insertRow({ id: 'edited', holdingId: 'uah', amountMinorUnits: -500, time: TIME }),
    run: (alongside) =>
      transactionsRepo.update(
        { transactionId: 'edited', amountMinorUnits: -900, time: EDITED_TIME, description: 'Rent' },
        alongside,
      ),
  },
];

beforeEach(freshDatabase);

describe.each(CASES)('$name with an alongside step', ({ prepare, run }) => {
  beforeEach(prepare);

  it('commits the transaction and the template together', async () => {
    const before = snapshot();

    await run(saveTemplate);

    expect(templateNames()).toEqual(['Rent']);
    expect(snapshot().ledger).not.toEqual(before.ledger);
  });

  it('writes the same rows and balances as with no alongside step', async () => {
    await run(saveTemplate);
    const withAlongside = snapshot();

    freshDatabase();
    prepare();
    await run();
    const withoutAlongside = snapshot();

    expect(withoutAlongside.templates).toEqual([]);
    expect(withAlongside.ledger).toEqual(withoutAlongside.ledger);
    expect(withAlongside.balances).toEqual(withoutAlongside.balances);
  });

  it('leaves no transaction and no template when the alongside step throws', async () => {
    const before = snapshot();

    await expect(run(saveTemplateThenFail)).rejects.toThrow('alongside failed');

    expect(snapshot()).toEqual(before);
  });

  it('leaves no transaction when the template cannot be inserted', async () => {
    await transactionTemplatesRepo.create({ name: ' rent ', draft: EMPTY_DRAFT });
    const before = snapshot();

    await expect(run(saveTemplate)).rejects.toThrow();

    expect(snapshot()).toEqual(before);
  });
});

describe('a write that fails before its alongside step', () => {
  it('recordManual refuses a ledgerless holding and writes no template', async () => {
    const alongside = jest.fn(saveTemplate);

    await expect(
      transactionsRepo.recordManual(
        { holdingId: 'deposit', amountMinorUnits: -500, time: TIME },
        alongside,
      ),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(alongside).not.toHaveBeenCalled();
    expect(templateNames()).toEqual([]);
  });

  it('recordExchange refuses a destination equal to the source and writes no template', async () => {
    const alongside = jest.fn(saveTemplate);

    await expect(
      transactionsRepo.recordExchange(
        {
          sourceHoldingId: 'uah',
          valueOutMinorUnits: 1_000,
          destinationHoldingId: 'uah',
          destinationType: 'card',
          valueInMinorUnits: 1_000,
          time: TIME,
        },
        alongside,
      ),
    ).rejects.toThrow('recordExchange: destination equals source');

    expect(alongside).not.toHaveBeenCalled();
    expect(templateNames()).toEqual([]);
  });

  it('recordManualWithReturns refuses a ledgerless payment holding and writes no template', async () => {
    const alongside = jest.fn(saveTemplate);

    await expect(
      transactionsRepo.recordManualWithReturns(
        {
          payment: { holdingId: 'deposit', amountMinorUnits: -500, time: TIME },
          returns: [{ holdingId: 'cash', amountMinorUnits: 100 }],
        },
        alongside,
      ),
    ).rejects.toThrow('transactions/ledgerless-holding');

    expect(alongside).not.toHaveBeenCalled();
    expect(templateNames()).toEqual([]);
  });

  it('update takes nothing from a failing row update and writes no template', async () => {
    insertRow({ id: 'edited', holdingId: 'uah', amountMinorUnits: -500, time: TIME });
    failUpdatesOfTransactions();
    const alongside = jest.fn(saveTemplate);
    const before = snapshot();

    await expect(
      transactionsRepo.update(
        { transactionId: 'edited', amountMinorUnits: -900, time: EDITED_TIME },
        alongside,
      ),
    ).rejects.toThrow();

    expect(alongside).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('update of a missing or synced row changes nothing, so it saves no template either', async () => {
    insertRow({ id: 'synced', holdingId: 'uah', amountMinorUnits: -500, source: 'monobank' });
    const alongside = jest.fn(saveTemplate);
    const before = snapshot();

    await transactionsRepo.update(
      { transactionId: 'missing', amountMinorUnits: -900, time: EDITED_TIME },
      alongside,
    );
    await transactionsRepo.update(
      { transactionId: 'synced', amountMinorUnits: -900, time: EDITED_TIME },
      alongside,
    );

    expect(alongside).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });
});
