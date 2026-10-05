// Every transaction updates its holding's balance, so a manual create, edit
// and delete move it by the row's amount whatever the row's date or mark; only
// an import's closing balance sets a figure outright. The anchors are SQL over
// the stored ledger and holding, so only a real engine shows which writes move
// the balance.
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

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
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

  it('gives the amount back when a manual row dated before it is deleted', async () => {
    await transactionsRepo.remove(manualIdAt(SEPTEMBER_10));

    expect(balance()).toBe(100_000);
  });

  it('moves the balance by the difference when a manual row dated before it is edited', async () => {
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -3_000,
      time: SEPTEMBER_10,
    });

    expect(balance()).toBe(97_000);
  });

  it('keeps the balance when only the date of a row moves across it', async () => {
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -10_000,
      time: OCTOBER_5,
    });

    expect(balance()).toBe(90_000);
  });

  it('keeps the balance when only the date of a row moves from after it to before it', async () => {
    await recordManual(-2_000, OCTOBER_2);

    expect(balance()).toBe(88_000);

    await transactionsRepo.update({
      transactionId: manualIdAt(OCTOBER_2),
      amountMinorUnits: -2_000,
      time: SEPTEMBER_15,
    });

    expect(balance()).toBe(88_000);
  });

  it('moves the balance for a manual row dated after it, through create, edit and delete', async () => {
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

describe('a delete on a holding that is closed', () => {
  it('gives the amount back to the stored balance, which the headline never shows', async () => {
    await recordManual(-1_000, SEPTEMBER_10);
    run(
      "UPDATE holdings SET closed_at = ?, balance_set_at = ? WHERE id = 'card'",
      OCTOBER_2,
      OCTOBER_2,
    );

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_10));

    expect(balance()).toBe(100_000);
  });
});

describe('a back-dated manual create after an import', () => {
  it('moves the balance by its amount, and a delete gives it back', async () => {
    await importSeptemberStatement();
    await recordManual(-10_000, SEPTEMBER_10);

    expect(balance()).toBe(80_000);

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_10));

    expect(balance()).toBe(90_000);
  });
});

describe('a manual row dated at the boundary', () => {
  it('moves the balance when it is created at the closing as-of, and a delete gives it back', async () => {
    await importSeptemberStatement();
    await recordManual(-1_000, SEPTEMBER_30);

    expect(balance()).toBe(89_000);

    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balance()).toBe(90_000);
  });

  it('moves the balance when a row at the newest synced second is created, edited, then deleted', async () => {
    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', -500, ?, 'monobank', 'bank-id')",
      SEPTEMBER_30,
    );
    await recordManual(-1_000, SEPTEMBER_30);

    expect(balance()).toBe(99_000);

    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -3_000,
      time: SEPTEMBER_30,
    });

    expect(balance()).toBe(97_000);

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

  it('counts a manual row dated before the holding was opened, as it counts a later row', async () => {
    const holdingId = await openHolding();

    await transactionsRepo.recordManual({
      holdingId,
      amountMinorUnits: -7_000,
      time: SEPTEMBER_10,
    });

    expect(balanceOf(holdingId)).toBe(43_000);

    await transactionsRepo.recordManual({ holdingId, amountMinorUnits: -7_000, time: OCTOBER_2 });

    expect(balanceOf(holdingId)).toBe(36_000);
  });

  it('keeps the balance when the opening row is re-dated, earlier or later', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await transactionsRepo.update({
      transactionId: openingId,
      amountMinorUnits: 50_000,
      time: SEPTEMBER_10,
    });
    await transactionsRepo.update({
      transactionId: openingId,
      amountMinorUnits: 50_000,
      time: OCTOBER_2,
    });

    expect(balanceOf(holdingId)).toBe(50_000);
  });

  it.each([
    ['at its own date', SEPTEMBER_30],
    ['re-dated earlier', SEPTEMBER_10],
    ['re-dated later', OCTOBER_2],
  ])(
    'moves the balance by the difference when the opening amount is edited %s',
    async (_name, time) => {
      const holdingId = await openHolding();

      await transactionsRepo.update({
        transactionId: manualIdAt(SEPTEMBER_30),
        amountMinorUnits: 60_000,
        time,
      });

      expect(balanceOf(holdingId)).toBe(60_000);
    },
  );

  describe('a cash opening', () => {
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

    it('moves the balance by the difference when its amount is edited', async () => {
      const holdingId = await openCash();

      await transactionsRepo.update({
        transactionId: manualIdAt(SEPTEMBER_30),
        amountMinorUnits: 25_000,
        time: OCTOBER_2,
      });

      expect(balanceOf(holdingId)).toBe(25_000);
    });

    it('takes its amount back out of the balance when it is deleted', async () => {
      const holdingId = await openCash();

      await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

      expect(balanceOf(holdingId)).toBe(0);
    });
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

  it('moves the balance by the difference when the opening is re-dated, then its amount edited', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_10 });
    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_10 });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('moves the balance by the difference when the opening gets a description or a category, then its amount edited', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_30, description: 'Salary savings' });
    await transactionsRepo.setCategory({ transactionId: openingId, category: 'groceries' });
    await editOpening(openingId, {
      amountMinorUnits: 60_000,
      time: SEPTEMBER_30,
      description: 'Salary savings',
    });

    expect(balanceOf(holdingId)).toBe(60_000);
  });

  it('takes the opening back out when it is re-dated, described, then deleted', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await editOpening(openingId, { time: SEPTEMBER_10, description: 'Salary savings' });
    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(0);
  });

  it('keeps the older mark after a hand edit, and an edit of either set row moves the balance by its difference', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    await holdingsRepo.updateWithBalanceDelta(
      holdingId,
      { balance: Money.of('UAH', 70_000) },
      OCTOBER_2,
    );

    expect(markedIdsOf(holdingId)).toEqual([openingId, manualIdAt(OCTOBER_2)]);

    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(80_000);

    await editOpening(manualIdAt(OCTOBER_2), { amountMinorUnits: 25_000, time: SEPTEMBER_10 });

    expect(balanceOf(holdingId)).toBe(85_000);
  });

  it('takes an older, superseded opening row back out of the balance when it is deleted', async () => {
    const holdingId = await openHolding();

    await holdingsRepo.updateWithBalanceDelta(
      holdingId,
      { balance: Money.of('UAH', 70_000) },
      OCTOBER_2,
    );
    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balanceOf(holdingId)).toBe(20_000);
  });

  it('keeps the mark through a closing balance: a closing import never counts the row twice', async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 50_000) },
      SEPTEMBER_15,
    );
    const adjustmentId = manualIdAt(SEPTEMBER_15);

    await importSeptemberStatement();

    expect(markedIdsOf('card')).toEqual([adjustmentId]);
    expect(balance()).toBe(90_000);

    await editOpening(adjustmentId, { amountMinorUnits: -40_000, time: SEPTEMBER_15 });

    expect(balance()).toBe(100_000);

    await transactionsRepo.remove(adjustmentId);

    expect(balance()).toBe(140_000);
  });

  it('moves the balance for a marked row once a newer synced row anchors the holding', async () => {
    const holdingId = await openHolding();
    const openingId = manualIdAt(SEPTEMBER_30);

    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', ?, -500, ?, 'monobank', 'bank-id')",
      holdingId,
      OCTOBER_2,
    );

    await editOpening(openingId, { amountMinorUnits: 60_000, time: SEPTEMBER_30 });

    expect(balanceOf(holdingId)).toBe(60_000);

    await transactionsRepo.remove(openingId);

    expect(balanceOf(holdingId)).toBe(0);
  });
});

// Before migration 0047 a superseded balance-set row carried no mark, so it
// looked like an uncategorised row an older build wrote. The edit does not tell
// them apart, because no date of a row decides whether its amount counts.
describe('a row shaped like a balance-set row, dated before the balance set', () => {
  const OLD_ROW = 'old-row';

  const timeOfOldRow = (): number =>
    (
      mockDatabase.prepare('SELECT time AS value FROM transactions WHERE id = ?').get(OLD_ROW) as {
        value: number;
      }
    ).value;

  beforeEach(() => {
    run("UPDATE holdings SET balance_set_at = ? WHERE id = 'card'", SEPTEMBER_30);
    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, description, category) VALUES (?, 'card', 40000, ?, 'manual', '', NULL)",
      OLD_ROW,
      SEPTEMBER_10,
    );
  });

  it.each([
    ['earlier', SEPTEMBER_10 - 1],
    ['to exactly the balance set', SEPTEMBER_30],
    ['past the balance set', OCTOBER_5],
  ])('moves it %s without moving the balance', async (_name, time) => {
    await transactionsRepo.update({
      transactionId: OLD_ROW,
      amountMinorUnits: 40_000,
      time,
    });

    expect(timeOfOldRow()).toBe(time);
    expect(balance()).toBe(100_000);
  });
});

describe('a hand-edited balance anchor', () => {
  beforeEach(async () => {
    await holdingsRepo.updateWithBalanceDelta(
      'card',
      { balance: Money.of('UAH', 70_000) },
      SEPTEMBER_30,
    );
  });

  it.each([
    ['earlier', SEPTEMBER_10],
    ['later', OCTOBER_2],
  ])('keeps the balance when the adjustment row is re-dated %s', async (_name, time) => {
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_30),
      amountMinorUnits: -30_000,
      time,
    });

    expect(balance()).toBe(70_000);
  });

  it.each([
    ['at its own date', SEPTEMBER_30],
    ['re-dated later', OCTOBER_2],
  ])(
    'moves the balance by the difference when the adjustment amount is edited %s',
    async (_name, time) => {
      await transactionsRepo.update({
        transactionId: manualIdAt(SEPTEMBER_30),
        amountMinorUnits: -20_000,
        time,
      });

      expect(balance()).toBe(80_000);
    },
  );

  it('returns the balance the hand edit started from when its adjustment row is deleted', async () => {
    await transactionsRepo.remove(manualIdAt(SEPTEMBER_30));

    expect(balance()).toBe(100_000);
  });

  it('counts a manual write dated before the edit', async () => {
    await recordManual(-4_000, SEPTEMBER_10);
    await transactionsRepo.update({
      transactionId: manualIdAt(SEPTEMBER_10),
      amountMinorUnits: -9_000,
      time: SEPTEMBER_10,
    });
    await recordManual(-1_000, SEPTEMBER_15);

    expect(balance()).toBe(60_000);
  });
});

describe('a sync-source anchor', () => {
  it('counts a manual write dated before the newest synced row', async () => {
    run(
      "INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES ('synced', 'card', -500, ?, 'monobank', 'bank-id')",
      SEPTEMBER_20,
    );

    await recordManual(-1_000, SEPTEMBER_10);

    expect(balance()).toBe(99_000);

    await recordManual(-1_000, SEPTEMBER_30);

    expect(balance()).toBe(98_000);
  });
});

describe('an exchange dated before the destination boundary', () => {
  it('moves both legs, each on its own holding', async () => {
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
    expect(balance()).toBe(95_000);
  });
});

// Every anchor x every manual write dated before it: a write moves the balance
// by its amount, and the opposite write puts it back exactly where it was.
describe('invariant: a manual write counts whatever its date against the anchor', () => {
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
  const writes: { name: string; apply: () => Promise<unknown>; moves: number }[] = [
    { name: 'create', apply: () => recordManual(-6_000, SEPTEMBER_15), moves: -6_000 },
    {
      name: 'edit the amount',
      apply: () =>
        transactionsRepo.update({
          transactionId: manualIdAt(SEPTEMBER_10),
          amountMinorUnits: -6_000,
          time: SEPTEMBER_10,
        }),
      moves: 4_000,
    },
    {
      name: 'edit the date, still before',
      apply: () =>
        transactionsRepo.update({
          transactionId: manualIdAt(SEPTEMBER_10),
          amountMinorUnits: -10_000,
          time: SEPTEMBER_15,
        }),
      moves: 0,
    },
    {
      name: 'delete',
      apply: () => transactionsRepo.remove(manualIdAt(SEPTEMBER_10)),
      moves: 10_000,
    },
  ];

  for (const anchor of anchors) {
    for (const manualWrite of writes) {
      it(`${anchor.name}: ${manualWrite.name}`, async () => {
        await recordManual(-10_000, SEPTEMBER_10);
        await anchor.set();
        const anchored = balance();

        await manualWrite.apply();

        expect(balance()).toBe(anchored + manualWrite.moves);
      });
    }

    it(`${anchor.name}: a create followed by its delete changes nothing`, async () => {
      await anchor.set();
      const anchored = balance();

      await recordManual(-6_000, SEPTEMBER_15);
      await transactionsRepo.remove(manualIdAt(SEPTEMBER_15));

      expect(balance()).toBe(anchored);
    });
  }
});
