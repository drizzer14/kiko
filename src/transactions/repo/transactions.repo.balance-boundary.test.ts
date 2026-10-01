// The boundary is SQL over the stored ledger and holding, so only a real
// engine shows which writes move the balance.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DatabaseSync } from 'node:sqlite';
import { Money } from '@kiko/currency/money';
import { accountsRepo } from '@kiko/accounts';
import { holdingsRepo } from '@kiko/holdings/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const day = (month: number, date: number): number => Date.UTC(2026, month - 1, date, 9);

const SEPTEMBER_10 = day(9, 10);
const SEPTEMBER_15 = day(9, 15);
const SEPTEMBER_20 = day(9, 20);
const SEPTEMBER_30 = day(9, 30);
const OCTOBER_2 = day(10, 2);
const OCTOBER_5 = day(10, 5);

const run = (statement: string, ...parameters: (string | number)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const balanceOf = (holdingId: string): number =>
  (
    mockDatabase
      .prepare('SELECT balance_minor_units AS value FROM holdings WHERE id = ?')
      .get(holdingId) as { value: number }
  ).value;

const balance = (): number => balanceOf('card');

const manualIdAt = (time: number): string =>
  (
    mockDatabase
      .prepare("SELECT id FROM transactions WHERE source = 'manual' AND time = ?")
      .get(time) as { id: string }
  ).id;

const recordManual = (amountMinorUnits: number, time: number): Promise<void> =>
  transactionsRepo.recordManual({ holdingId: 'card', amountMinorUnits, time });

// The transaction form always writes a category on create, so an entered row
// never takes the shape of a balance-set row.
const recordCategorised = (time: number): Promise<void> =>
  transactionsRepo.recordManual({
    holdingId: 'card',
    amountMinorUnits: -1_000,
    time,
    category: 'groceries',
  });

// The bank statement: one purchase on September 20 and the bank's own closing
// balance of 900.00 at the end of September.
const importSeptemberStatement = (): Promise<number> =>
  transactionsRepo.importRows({
    holdingId: 'card',
    rows: [
      {
        holdingId: 'card',
        amountMinorUnits: -5_000,
        time: SEPTEMBER_20,
        source: 'import',
        externalId: 'september-purchase',
      },
    ],
    closingBalance: { minorUnits: 90_000, currency: 'UAH', asOfSeconds: SEPTEMBER_30 / 1000 },
  });

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('card', 'account', 'Card', 'card', 'UAH', 100000)",
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('a manual write against a closing balance an import set', () => {
  beforeEach(async () => {
    await recordManual(-10_000, SEPTEMBER_10);
    await importSeptemberStatement();
  });

  it('starts from the bank closing balance', () => {
    expect(balance()).toBe(90_000);
  });

  it('keeps the balance when a manual row dated before it is deleted', async () => {
    await transactionsRepo.remove(manualIdAt(SEPTEMBER_10));

    expect(balance()).toBe(90_000);
  });

  it('keeps the balance when a manual row dated before it is edited', async () => {
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -3_000,
      time: SEPTEMBER_10,
    });

    expect(balance()).toBe(90_000);
  });

  it('moves the balance by the new amount when an edit moves the row after it', async () => {
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -10_000,
      time: OCTOBER_5,
    });

    expect(balance()).toBe(80_000);
  });

  it('takes back the old amount when an edit moves a row from after it to before it', async () => {
    await recordManual(-2_000, OCTOBER_2);

    expect(balance()).toBe(88_000);

    await transactionsRepo.update({
      transactionId: manualIdAt(OCTOBER_2),
      amountMinorUnits: -2_000,
      time: SEPTEMBER_15,
    });

    expect(balance()).toBe(90_000);
  });

  it('still moves the balance for a manual row dated after it', async () => {
    await recordManual(-1_000, OCTOBER_2);

    expect(balance()).toBe(89_000);

    await transactionsRepo.update({
      transactionId: manualIdAt(OCTOBER_2),
      amountMinorUnits: -3_000,
      time: OCTOBER_2,
    });

    expect(balance()).toBe(87_000);

    await transactionsRepo.remove(manualIdAt(OCTOBER_2));

    expect(balance()).toBe(90_000);
  });
});

describe('a back-dated manual create after an import', () => {
  it('keeps the bank closing balance', async () => {
    await importSeptemberStatement();
    await recordManual(-10_000, SEPTEMBER_10);

    expect(balance()).toBe(90_000);
  });
});

describe('a manual row dated at the boundary belongs to the anchor', () => {
  it('leaves the bank closing balance when a row is created at the closing as-of', async () => {
    await importSeptemberStatement();
    await recordManual(-1_000, SEPTEMBER_30);

    expect(balance()).toBe(90_000);
  });

  it('ends on the bank figure when a row at the closing as-of is deleted', async () => {
    await recordManual(-1_000, SEPTEMBER_30);
    await importSeptemberStatement();

    expect(balance()).toBe(90_000);

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balance()).toBe(90_000);
  });

  it('keeps the bank closing balance when a row at the closing as-of is edited, then deleted', async () => {
    await importSeptemberStatement();
    await recordCategorised(SEPTEMBER_30);

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -3_000,
      time: SEPTEMBER_30,
    });

    expect(balance()).toBe(90_000);

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balance()).toBe(90_000);
  });

  it('keeps the synced balance when a row at the newest synced second is edited, then deleted', async () => {
    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', -500, ?, 'monobank', 'bank-id')",
      SEPTEMBER_30,
    );
    await recordManual(-1_000, SEPTEMBER_30);

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -3_000,
      time: SEPTEMBER_30,
    });

    expect(balance()).toBe(100_000);

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balance()).toBe(100_000);
  });
});

describe('an opening balance anchor', () => {
  const openHolding = (): Promise<string> => {
    jest.spyOn(Date, 'now').mockReturnValue(SEPTEMBER_30);

    return holdingsRepo.create({
      accountId: 'account',
      name: 'Opened',
      type: 'card',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 50_000),
    });
  };

  it('ignores a manual row dated before the holding was opened, and counts a later row', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.recordManual({
      holdingId,
      amountMinorUnits: -7_000,
      time: SEPTEMBER_10,
    });

    expect(balanceOf(holdingId)).toBe(50_000);

    await transactionsRepo.recordManual({ holdingId, amountMinorUnits: -7_000, time: OCTOBER_2 });

    expect(balanceOf(holdingId)).toBe(43_000);
  });

  it('keeps the balance when the opening row is re-dated earlier', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 50_000,
      time: SEPTEMBER_10,
    });

    expect(balanceOf(holdingId)).toBe(50_000);
  });

  it('keeps the balance when the opening row is deleted', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balanceOf(holdingId)).toBe(50_000);
  });

  it('moves the balance by the difference when the opening amount is edited', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 60_000,
      time: SEPTEMBER_30,
    });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('moves the balance by the difference when the opening amount is edited and re-dated earlier', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 45_000,
      time: SEPTEMBER_10,
    });

    expect(balanceOf(holdingId)).toBe(45_000);
  });

  it('keeps the balance when the opening row is re-dated later', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 50_000,
      time: OCTOBER_2,
    });

    expect(balanceOf(holdingId)).toBe(50_000);
  });

  it('moves the balance by the difference when the opening amount is edited and re-dated later', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 60_000,
      time: OCTOBER_2,
    });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('keeps the balance when an opening row stamped mid-second is re-dated to a later minute', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(SEPTEMBER_30 + 123);
    const holdingId = await holdingsRepo.create({
      accountId: 'account',
      name: 'Opened',
      type: 'card',
      currency: 'UAH',
      openingBalance: Money.of('UAH', 50_000),
    });

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30 + 123),
      amountMinorUnits: 50_000,
      time: SEPTEMBER_30 + 30 * 60_000,
    });

    expect(balanceOf(holdingId)).toBe(50_000);
  });

  const openCash = async (): Promise<string> => {
    jest.spyOn(Date, 'now').mockReturnValue(SEPTEMBER_30);
    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 20_000),
    });

    return (
      mockDatabase.prepare("SELECT id FROM holdings WHERE type = 'cash'").get() as { id: string }
    ).id;
  };

  it('moves the balance by the difference when a cash opening amount is edited', async () => {
    const holdingId = await openCash();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 25_000,
      time: SEPTEMBER_30,
    });

    expect(balanceOf(holdingId)).toBe(25_000);
  });

  it('keeps the balance when a cash opening row is re-dated later', async () => {
    const holdingId = await openCash();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 20_000,
      time: OCTOBER_2,
    });

    expect(balanceOf(holdingId)).toBe(20_000);
  });

  it('moves the balance by the difference when a cash opening is edited and re-dated later', async () => {
    const holdingId = await openCash();

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: 25_000,
      time: OCTOBER_2,
    });

    expect(balanceOf(holdingId)).toBe(25_000);
  });
});

describe('the stored balance-set marker', () => {
  const openingBalance = 50_000;

  const openHolding = (): Promise<string> => {
    jest.spyOn(Date, 'now').mockReturnValue(SEPTEMBER_30);

    return holdingsRepo.create({
      accountId: 'account',
      name: 'Opened',
      type: 'card',
      currency: 'UAH',
      openingBalance: Money.of('UAH', openingBalance),
    });
  };

  const markedIdsOf = (holdingId: string): string[] =>
    (
      mockDatabase
        .prepare(
          'SELECT id FROM transactions WHERE holding_id = ? AND sets_balance = 1 ORDER BY time',
        )
        .all(holdingId) as { id: string }[]
    ).map((row) => row.id);

  const editOpening = (
    openingId: string,
    edit: { amountMinorUnits?: number; time: number; description?: string },
  ): Promise<void> =>
    transactionsRepo.update({
      transactionId: openingId,
      amountMinorUnits: edit.amountMinorUnits ?? openingBalance,
      time: edit.time,
      description: edit.description,
    });

  it('marks the opening row, the cash opening row, and the hand-edit adjustment row', async () => {
    const holdingId = await openHolding();

    expect(markedIdsOf(holdingId)).toEqual([manualIdAt(SEPTEMBER_30)]);

    jest.spyOn(Date, 'now').mockReturnValue(OCTOBER_2);
    await accountsRepo.createCashAccount({
      name: 'Wallet',
      currency: 'UAH',
      initialBalance: Money.of('UAH', 20_000),
    });
    const cashId = (
      mockDatabase.prepare("SELECT id FROM holdings WHERE type = 'cash'").get() as { id: string }
    ).id;

    expect(markedIdsOf(cashId)).toEqual([manualIdAt(OCTOBER_2)]);

    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      OCTOBER_5,
    );

    expect(markedIdsOf('card')).toEqual([manualIdAt(OCTOBER_5)]);
  });

  it('moves the balance by the difference when the opening is re-dated earlier, then its amount edited', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_10 });
    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_10 });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('keeps the balance when the opening is re-dated later, then back', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: OCTOBER_2 });
    await editOpening(openingId, { time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(openingBalance);
  });

  it('keeps the balance when the opening is re-dated later, then deleted', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: OCTOBER_2 });
    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(openingBalance);
  });

  it('moves the balance by the difference when the opening gets a description, then its amount edited', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_30, description: 'Salary savings' });
    await editOpening(openingId, {
      amountMinorUnits: 60_000,
      time: SEPTEMBER_30,
      description: 'Salary savings',
    });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('moves the balance by the difference when the opening gets a category, then its amount edited', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await transactionsRepo.setCategory({ transactionId: openingId, category: 'groceries' });
    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('keeps the balance when a re-dated, described opening is deleted', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_10, description: 'Salary savings' });
    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(openingBalance);
  });

  // Only the newest balance set's row is current: an older set's row is part
  // of the balance the newer set wrote over, so editing it moves nothing.
  it('keeps the older mark after a hand edit, and only the newest set row moves the balance', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await holdingsRepo.updateWithBalanceDelta(
      holdingId,
      { balance: Money.of('UAH', 70_000) },
      OCTOBER_2,
    );

    expect(markedIdsOf(holdingId)).toEqual([openingId, manualIdAt(OCTOBER_2)]);

    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(70_000);

    await editOpening(manualIdAt(OCTOBER_2), { amountMinorUnits: 25_000, time: SEPTEMBER_10 });

    expect(balanceOf(holdingId)).toBe(75_000);
  });

  it('keeps the balance when the older opening is re-dated past a newer hand edit, then deleted', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await holdingsRepo.updateWithBalanceDelta(
      holdingId,
      { balance: Money.of('UAH', 70_000) },
      OCTOBER_2,
    );
    await editOpening(openingId, { time: OCTOBER_5 });

    expect(balanceOf(holdingId)).toBe(70_000);

    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(70_000);
  });

  it('keeps the mark through a closing balance, so the adjustment moves nothing', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 50_000) },
      SEPTEMBER_15,
    );
    const adjustmentId = manualIdAt(SEPTEMBER_15);

    await importSeptemberStatement();

    expect(markedIdsOf('card')).toEqual([adjustmentId]);

    await editOpening(adjustmentId, { amountMinorUnits: -40_000, time: SEPTEMBER_15 });
    await transactionsRepo.remove(adjustmentId);

    expect(balance()).toBe(90_000);
  });

  it('ends on the closing figure when a hand-edit row re-dated past a closing as-of is edited, then deleted', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 102_000) },
      SEPTEMBER_15,
    );
    const adjustmentId = manualIdAt(SEPTEMBER_15);

    await transactionsRepo.update({
      transactionId: adjustmentId,
      amountMinorUnits: 2_000,
      time: OCTOBER_2,
    });
    await importSeptemberStatement();

    expect(balance()).toBe(90_000);

    await transactionsRepo.update({
      transactionId: adjustmentId,
      amountMinorUnits: 5_000,
      time: OCTOBER_2,
    });

    expect(balance()).toBe(90_000);

    await transactionsRepo.remove(adjustmentId);

    expect(balance()).toBe(90_000);
  });

  it('moves nothing for a marked row once a newer synced row anchors the holding', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', ?, -500, ?, 'monobank', 'bank-id')",
      holdingId,
      OCTOBER_2,
    );

    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(openingBalance);

    await editOpening(openingId, { amountMinorUnits: 60_000, time: OCTOBER_5 });

    expect(balanceOf(holdingId)).toBe(openingBalance);

    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(openingBalance);
  });
});

describe('a hand-edited balance anchor', () => {
  it('keeps the balance when the adjustment row is re-dated earlier', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -30_000,
      time: SEPTEMBER_10,
    });

    expect(balance()).toBe(70_000);
  });

  it('moves the balance by the difference when the adjustment amount is edited', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -20_000,
      time: SEPTEMBER_30,
    });

    expect(balance()).toBe(80_000);
  });

  it('keeps the balance when the adjustment row is re-dated later', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -30_000,
      time: OCTOBER_2,
    });

    expect(balance()).toBe(70_000);
  });

  it('moves the balance by the difference when the adjustment is edited and re-dated later', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -20_000,
      time: OCTOBER_2,
    });

    expect(balance()).toBe(80_000);
  });

  it('ignores a manual write dated before the edit', async () => {
    await recordManual(-4_000, SEPTEMBER_10);
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -9_000,
      time: SEPTEMBER_10,
    });
    await recordManual(-1_000, SEPTEMBER_15);

    expect(balance()).toBe(70_000);
  });
});

describe('a sync-source anchor', () => {
  it('ignores a manual write dated before the newest synced row', async () => {
    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', -500, ?, 'monobank', 'bank-id')",
      SEPTEMBER_20,
    );

    await recordManual(-1_000, SEPTEMBER_10);

    expect(balance()).toBe(100_000);

    await recordManual(-1_000, SEPTEMBER_30);

    expect(balance()).toBe(99_000);
  });
});

describe('an exchange dated before the destination boundary', () => {
  it('moves only the leg whose own holding has no later boundary', async () => {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('cash', 'account', 'Cash', 'cash', 'UAH', 20000)",
    );
    await importSeptemberStatement();

    await transactionsRepo.recordExchange({
      sourceHoldingId: 'cash',
      valueOutMinorUnits: 5_000,
      destinationHoldingId: 'card',
      destinationType: 'card',
      valueInMinorUnits: 5_000,
      time: SEPTEMBER_15,
    });

    expect(balanceOf('cash')).toBe(15_000);
    expect(balance()).toBe(90_000);
  });
});

// Every anchor x every manual write dated before it: the anchor already
// counts that row, so the balance must stay exactly where the anchor put it.
describe('invariant: a manual write dated before the boundary never moves the balance', () => {
  const anchors: { name: string; set: () => Promise<unknown> }[] = [
    { name: 'a closing balance import', set: importSeptemberStatement },
    {
      name: 'a hand-edited balance',
      set: () =>
        holdingsRepo.updateWithBalanceDelta(
          'card',
          { balance: Money.of('UAH', 95_000) },
          SEPTEMBER_30,
        ),
    },
    {
      name: 'a synced row',
      set: async () =>
        run(
          "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', 0, ?, 'monobank', 'bank-id')",
          SEPTEMBER_30,
        ),
    },
  ];
  const writes: { name: string; apply: () => Promise<unknown> }[] = [
    { name: 'create', apply: () => recordManual(-6_000, SEPTEMBER_15) },
    {
      name: 'edit the amount',
      apply: () =>
        transactionsRepo.update({
          transactionId: manualIdAt(SEPTEMBER_10),
          amountMinorUnits: -6_000,
          time: SEPTEMBER_10,
        }),
    },
    {
      name: 'edit the date, still before',
      apply: () =>
        transactionsRepo.update({
          transactionId: manualIdAt(SEPTEMBER_10),
          amountMinorUnits: -10_000,
          time: SEPTEMBER_15,
        }),
    },
    { name: 'delete', apply: () => transactionsRepo.remove(manualIdAt(SEPTEMBER_10)) },
  ];

  for (const anchor of anchors) {
    for (const manualWrite of writes) {
      it(`${anchor.name}: ${manualWrite.name}`, async () => {
        await recordManual(-10_000, SEPTEMBER_10);
        await anchor.set();
        const anchored = balance();

        await manualWrite.apply();

        expect(balance()).toBe(anchored);
      });
    }
  }
});
