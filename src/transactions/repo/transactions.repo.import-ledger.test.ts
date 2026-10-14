// The preview must show the number the import then stores, and deleting one of
// an import's rows takes its full amount back, whatever its date against the
// holding's balance boundary; a stored balance is SQL over the ledger, so only
// a real engine shows either.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { type ImportBalancePreview, transactionsRepo } from './transactions.repo';

const CLOSING_AT = Date.UTC(2026, 9, 3, 9);
const HAND_SET_AT = Date.UTC(2026, 8, 15, 9);
const NEWEST_SYNC_AT = Date.UTC(2026, 9, 1, 12);

type Currency = 'UAH' | 'USD';
type StatementRow = { externalId: string; amountMinorUnits: number; time: number };
type Closing = { minorUnits: number; currency: Currency; asOfSeconds: number };
type ImportInput = { rows: StatementRow[]; closingBalance?: Closing };

const run = (statement: string, ...parameters: (string | number | null)[]): void => {
  mockDatabase.prepare(statement).run(...parameters);
};

const scalarOf = (statement: string, ...parameters: (string | number)[]): unknown =>
  (mockDatabase.prepare(statement).get(...parameters) as { value: unknown }).value;

const balanceOf = (holdingId = 'card'): number =>
  scalarOf('SELECT balance_minor_units AS value FROM holdings WHERE id = ?', holdingId) as number;

const balanceSetAt = (): number | null =>
  scalarOf("SELECT balance_set_at AS value FROM holdings WHERE id = 'card'") as number | null;

const storedRowCount = (): number =>
  scalarOf('SELECT count(*) AS value FROM transactions') as number;

const idOf = (externalId: string): string =>
  scalarOf('SELECT id AS value FROM transactions WHERE external_id = ?', externalId) as string;

const ledgerSnapshot = (): unknown => ({
  holdings: mockDatabase.prepare('SELECT * FROM holdings ORDER BY id').all(),
  transactions: mockDatabase.prepare('SELECT * FROM transactions ORDER BY id').all(),
});

const toImportInput = ({ rows, closingBalance }: ImportInput, holdingId = 'card') => ({
  holdingId,
  closingBalance,
  rows: rows.map(({ externalId, amountMinorUnits, time }) => ({
    holdingId,
    amountMinorUnits,
    time,
    source: 'import' as const,
    externalId,
  })),
});

const importRows = (input: ImportInput, holdingId = 'card'): Promise<number> =>
  transactionsRepo.importRows(toImportInput(input, holdingId));

const previewRows = (input: ImportInput): Promise<ImportBalancePreview> =>
  transactionsRepo.previewImportBalance(toImportInput(input));

const resultingBalanceOf = (preview: ImportBalancePreview): number =>
  preview.kind === 'change' ? preview.toMinorUnits : preview.minorUnits;

const insertStoredRow = (id: string, source: string, amountMinorUnits: number, time: number) => {
  run(
    'INSERT INTO transactions (id, holding_id, amount_minor_units, time, source, external_id) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    'card',
    amountMinorUnits,
    time,
    source,
    source === 'manual' ? null : id,
  );
};

const setBalance = (minorUnits: number, setAt: number | null = null): void => {
  run(
    'UPDATE holdings SET balance_minor_units = ?, balance_set_at = ? WHERE id = ?',
    minorUnits,
    setAt,
    'card',
  );
};

const closing = (minorUnits: number, asOf: number, currency: Currency = 'UAH'): Closing => ({
  minorUnits,
  currency,
  asOfSeconds: asOf / 1000,
});

// Three rows and the bank's closing balance of 850.00 at the newest one.
const threeRows: StatementRow[] = [
  { externalId: 'first', amountMinorUnits: -10_000, time: CLOSING_AT - 2 * DAY_MS },
  { externalId: 'second', amountMinorUnits: -5_000, time: CLOSING_AT - DAY_MS },
  { externalId: 'third', amountMinorUnits: 100_000, time: CLOSING_AT },
];
const CLOSING = closing(85_000, CLOSING_AT);

// Two rows before a balance set by hand, and optionally one after it.
const aroundHandSet = (afterRow: StatementRow[] = []): ImportInput => ({
  rows: [
    { externalId: 'before-1', amountMinorUnits: -10_000, time: HAND_SET_AT - 2 * DAY_MS },
    { externalId: 'before-2', amountMinorUnits: -5_000, time: HAND_SET_AT - DAY_MS },
    ...afterRow,
  ],
});
const afterHandSet: StatementRow = {
  externalId: 'after',
  amountMinorUnits: -3_000,
  time: HAND_SET_AT + DAY_MS,
};

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec('PRAGMA foreign_keys = ON');
  run("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank')");
  run(
    "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('card', 'account', 'Card', 'card', 'UAH', 0)",
  );
});

type Fixture = {
  name: string;
  prepare?: () => Promise<void> | void;
  input: ImportInput;
  expected: ImportBalancePreview;
};

const setTo = (minorUnits: number, asOf: number) => ({
  kind: 'set' as const,
  currency: 'UAH' as const,
  minorUnits,
  bankMinorUnits: minorUnits,
  asOfSeconds: asOf / 1000,
});

const fixtures: Fixture[] = [
  {
    name: 'a new holding and a file whose closing balance applies',
    input: { rows: threeRows, closingBalance: CLOSING },
    expected: setTo(85_000, CLOSING_AT),
  },
  {
    name: 'a new holding and a file with no closing balance',
    input: { rows: threeRows },
    expected: { kind: 'change', currency: 'UAH', fromMinorUnits: 0, toMinorUnits: 85_000 },
  },
  {
    name: 'a balance set by hand with one row after it',
    prepare: () => setBalance(100_000, HAND_SET_AT),
    input: aroundHandSet([afterHandSet]),
    expected: { kind: 'change', currency: 'UAH', fromMinorUnits: 100_000, toMinorUnits: 97_000 },
  },
  {
    name: 'a balance set by hand with every row before it',
    prepare: () => setBalance(100_000, HAND_SET_AT),
    input: aroundHandSet(),
    expected: { kind: 'stays', currency: 'UAH', minorUnits: 100_000 },
  },
  {
    name: 'a newer statement after an earlier import and a manual entry',
    prepare: async () => {
      await importRows({
        rows: [{ externalId: 'old', amountMinorUnits: -10_000, time: CLOSING_AT - DAY_MS }],
        closingBalance: closing(90_000, CLOSING_AT),
      });
      await transactionsRepo.recordManual({
        holdingId: 'card',
        amountMinorUnits: -5_000,
        time: CLOSING_AT + DAY_MS,
      });
    },
    input: {
      rows: [{ externalId: 'newer', amountMinorUnits: -3_000, time: CLOSING_AT + 2 * DAY_MS }],
      closingBalance: closing(70_000, CLOSING_AT + 3 * DAY_MS),
    },
    expected: { ...setTo(65_000, CLOSING_AT + 3 * DAY_MS), bankMinorUnits: 70_000 },
  },
  {
    name: 'a closing balance with an earlier manual entry already in the ledger',
    prepare: () => insertStoredRow('earlier', 'manual', -5_000, CLOSING_AT - 3 * DAY_MS),
    input: { rows: threeRows, closingBalance: CLOSING },
    expected: { ...setTo(80_000, CLOSING_AT), bankMinorUnits: 85_000 },
  },
  {
    name: 'a closing balance with a later entry already in the ledger',
    prepare: () => insertStoredRow('later', 'manual', -5_000, CLOSING_AT + DAY_MS),
    input: { rows: threeRows, closingBalance: closing(90_000, CLOSING_AT) },
    expected: { ...setTo(85_000, CLOSING_AT), bankMinorUnits: 90_000 },
  },
  {
    name: 'a statement older than the anchor',
    prepare: () => setBalance(50_000, CLOSING_AT),
    input: {
      rows: [
        { externalId: 'old-1', amountMinorUnits: -10_000, time: CLOSING_AT - 31 * DAY_MS },
        { externalId: 'old-2', amountMinorUnits: -5_000, time: CLOSING_AT - 30 * DAY_MS },
      ],
      closingBalance: closing(80_000, CLOSING_AT - 30 * DAY_MS),
    },
    expected: { kind: 'stays', currency: 'UAH', minorUnits: 50_000 },
  },
  {
    name: 'a closing balance in another currency than the holding',
    input: {
      rows: [{ externalId: 'only', amountMinorUnits: -10_000, time: CLOSING_AT - DAY_MS }],
      closingBalance: closing(500, CLOSING_AT, 'USD'),
    },
    expected: { kind: 'change', currency: 'UAH', fromMinorUnits: 0, toMinorUnits: -10_000 },
  },
  {
    name: 'the same file imported a second time',
    prepare: async () => {
      await importRows({ rows: threeRows, closingBalance: CLOSING });
    },
    input: { rows: threeRows, closingBalance: CLOSING },
    expected: setTo(85_000, CLOSING_AT),
  },
  {
    name: 'rows a disconnected bank already synced',
    prepare: () => {
      setBalance(100_000);
      insertStoredRow('mono-1', 'monobank', -10_000, CLOSING_AT - 2 * DAY_MS);
      insertStoredRow('mono-2', 'monobank', -5_000, CLOSING_AT - DAY_MS);
    },
    input: {
      rows: [
        { externalId: 'dup-1', amountMinorUnits: -10_000, time: CLOSING_AT - 2 * DAY_MS + 20_000 },
        { externalId: 'dup-2', amountMinorUnits: -5_000, time: CLOSING_AT - DAY_MS + 20_000 },
        { externalId: 'fresh', amountMinorUnits: 20_000, time: CLOSING_AT },
      ],
    },
    expected: { kind: 'change', currency: 'UAH', fromMinorUnits: 100_000, toMinorUnits: 120_000 },
  },
  {
    name: 'a closing balance that is negative',
    input: {
      rows: [{ externalId: 'debt', amountMinorUnits: -20_050, time: CLOSING_AT - DAY_MS }],
      closingBalance: closing(-120_050, CLOSING_AT),
    },
    expected: setTo(-120_050, CLOSING_AT),
  },
];

describe.each(fixtures)('previewing $name', ({ prepare, input, expected }) => {
  beforeEach(async () => {
    await prepare?.();
  });

  it('reports what the balance will become', async () => {
    expect(await previewRows(input)).toEqual(expected);
  });

  it('writes nothing', async () => {
    const before = ledgerSnapshot();

    await previewRows(input);

    expect(ledgerSnapshot()).toEqual(before);
  });

  it('shows the number the import then stores', async () => {
    const preview = await previewRows(input);

    await importRows(input);

    expect(balanceOf()).toBe(resultingBalanceOf(preview));
  });
});

describe('previewing an import the import itself would refuse', () => {
  it('refuses a holding of an account a sync owns', async () => {
    run("UPDATE accounts SET institution = 'monobank' WHERE id = 'account'");

    await expect(previewRows({ rows: threeRows })).rejects.toThrow(
      'statement-import/synced-account',
    );
  });

  it('refuses a holding that has no ledger', async () => {
    run("UPDATE holdings SET type = 'term_deposit' WHERE id = 'card'");

    await expect(previewRows({ rows: threeRows })).rejects.toThrow(
      'statement-import/ledgerless-holding',
    );
  });

  it('refuses a holding that is not there', async () => {
    await expect(
      transactionsRepo.previewImportBalance({ holdingId: 'missing', rows: [] }),
    ).rejects.toThrow('Target holding not found: missing');
  });
});

describe('deleting an import row after a closing balance set the balance', () => {
  beforeEach(async () => {
    await importRows({ rows: threeRows, closingBalance: CLOSING });
  });

  it('starts from the bank closing balance', () => {
    expect(balanceOf()).toBe(85_000);
    expect(balanceSetAt()).toBe(CLOSING_AT);
  });

  it('takes the amount back and keeps the anchor when the newest row, at the closing time, goes', async () => {
    await transactionsRepo.remove(idOf('third'));

    expect(storedRowCount()).toBe(2);
    expect(balanceOf()).toBe(-15_000);
    expect(balanceSetAt()).toBe(CLOSING_AT);
  });

  it('takes the amount back when a row before the closing time goes', async () => {
    await transactionsRepo.remove(idOf('second'));

    expect(storedRowCount()).toBe(2);
    expect(balanceOf()).toBe(90_000);
  });

  it('ends on the statement opening balance and keeps the anchor when every row goes', async () => {
    for (const { externalId } of threeRows) {
      await transactionsRepo.remove(idOf(externalId));
    }

    expect(storedRowCount()).toBe(0);
    expect(balanceOf()).toBe(0);
    expect(balanceSetAt()).toBe(CLOSING_AT);
  });

  it('takes the amount back from a balance a later manual entry moved when an import row goes', async () => {
    await transactionsRepo.recordManual({
      holdingId: 'card',
      amountMinorUnits: -5_000,
      time: CLOSING_AT + DAY_MS,
    });

    expect(balanceOf()).toBe(80_000);

    await transactionsRepo.remove(idOf('first'));

    expect(balanceOf()).toBe(90_000);
  });

  it('still gives the money back when the later manual entry is the row deleted', async () => {
    await transactionsRepo.recordManual({
      holdingId: 'card',
      amountMinorUnits: -5_000,
      time: CLOSING_AT + DAY_MS,
    });
    await transactionsRepo.remove(
      scalarOf("SELECT id AS value FROM transactions WHERE source = 'manual'") as string,
    );

    expect(balanceOf()).toBe(85_000);
  });

  it('puts a deleted row back with its amount when the same statement is imported again', async () => {
    await transactionsRepo.remove(idOf('second'));

    expect(balanceOf()).toBe(90_000);
    expect(await importRows({ rows: threeRows, closingBalance: CLOSING })).toBe(1);

    expect(storedRowCount()).toBe(3);
    expect(balanceOf()).toBe(85_000);
  });

  it('lets a newer statement closing balance absorb a delete, and leaves the row gone', async () => {
    await transactionsRepo.remove(idOf('second'));
    await importRows({
      rows: [{ externalId: 'newer', amountMinorUnits: -1_000, time: CLOSING_AT + 2 * DAY_MS }],
      closingBalance: closing(70_000, CLOSING_AT + 3 * DAY_MS),
    });

    expect(storedRowCount()).toBe(3);
    expect(balanceOf()).toBe(70_000);
  });

  it('does nothing when the same id is deleted twice', async () => {
    const secondId = idOf('second');

    await transactionsRepo.remove(secondId);
    await transactionsRepo.remove(secondId);

    expect(storedRowCount()).toBe(2);
    expect(balanceOf()).toBe(90_000);
  });

  it('leaves the name rules alone when a categorised row goes', async () => {
    run(
      `INSERT INTO category_rules (id, category, matchers)
       VALUES ('coffee', 'cafe', '[{"type":"nameIs","text":"Coffee"}]')`,
    );
    await transactionsRepo.setCategory({ transactionId: idOf('first'), category: 'cafe' });
    await transactionsRepo.remove(idOf('first'));

    expect(scalarOf('SELECT count(*) AS value FROM category_rules')).toBe(1);
    expect(storedRowCount()).toBe(2);
  });
});

describe('deleting the only row of an import with a closing balance', () => {
  it('ends on the statement opening balance and keeps the anchor', async () => {
    await importRows({
      rows: [{ externalId: 'only', amountMinorUnits: -10_000, time: CLOSING_AT }],
      closingBalance: closing(90_000, CLOSING_AT),
    });
    await transactionsRepo.remove(idOf('only'));

    expect(storedRowCount()).toBe(0);
    expect(balanceOf()).toBe(100_000);
    expect(balanceSetAt()).toBe(CLOSING_AT);
  });
});

describe('deleting an import row from an import with no closing balance', () => {
  beforeEach(async () => {
    await importRows({ rows: threeRows });
  });

  it('starts with the net of every row', () => {
    expect(balanceOf()).toBe(85_000);
    expect(balanceSetAt()).toBeNull();
  });

  it('takes the amount back when a row goes, because nothing is history yet', async () => {
    await transactionsRepo.remove(idOf('third'));

    expect(storedRowCount()).toBe(2);
    expect(balanceOf()).toBe(-15_000);
  });

  it('takes each amount back and ends at zero when every row goes', async () => {
    for (const { externalId } of threeRows) {
      await transactionsRepo.remove(idOf(externalId));
    }

    expect(storedRowCount()).toBe(0);
    expect(balanceOf()).toBe(0);
  });
});

describe('deleting an import row against a balance set by hand', () => {
  beforeEach(async () => {
    setBalance(100_000, HAND_SET_AT);
    await importRows(aroundHandSet([afterHandSet]));
  });

  it('starts with only the row after the hand set moving the balance', () => {
    expect(balanceOf()).toBe(97_000);
  });

  it('gives the money back when the row after the hand set goes', async () => {
    await transactionsRepo.remove(idOf('after'));

    expect(balanceOf()).toBe(100_000);
  });

  it('takes the amount back when a row before the hand set goes', async () => {
    await transactionsRepo.remove(idOf('before-1'));

    expect(balanceOf()).toBe(107_000);
  });

  // The delete took the amount back, so the row that comes back brings it again,
  // though a file with no closing balance counts a row before the hand set as
  // history when the holding never had it.
  it('brings a deleted row before the hand set back with its amount', async () => {
    await transactionsRepo.remove(idOf('before-1'));
    await importRows(aroundHandSet([afterHandSet]));

    expect(storedRowCount()).toBe(3);
    expect(balanceOf()).toBe(97_000);
  });
});

describe('deleting an import row beside a synced row', () => {
  beforeEach(() => {
    setBalance(50_000);
    insertStoredRow('mono-newest', 'monobank', -2_000, NEWEST_SYNC_AT);
  });

  it('takes the amount back for a duplicate dated before the newest synced row', async () => {
    insertStoredRow('duplicate', 'import', -2_000, NEWEST_SYNC_AT - 30_000);

    await transactionsRepo.remove('duplicate');

    expect(storedRowCount()).toBe(1);
    expect(balanceOf()).toBe(52_000);
  });

  it('gives the money back for a statement row dated after the newest synced row', async () => {
    insertStoredRow('newer', 'import', -2_000, NEWEST_SYNC_AT + DAY_MS);

    await transactionsRepo.remove('newer');

    expect(balanceOf()).toBe(52_000);
  });

  it('does not bring a deleted duplicate back once the statement is imported again', async () => {
    insertStoredRow('duplicate', 'import', -2_000, NEWEST_SYNC_AT - 30_000);
    await transactionsRepo.remove('duplicate');

    const inserted = await importRows({
      rows: [{ externalId: 'duplicate', amountMinorUnits: -2_000, time: NEWEST_SYNC_AT - 30_000 }],
    });

    expect(inserted).toBe(0);
    expect(storedRowCount()).toBe(1);
  });
});

describe('deleting an import row of another currency holding', () => {
  it('gives back the amount in that holdings own minor units', async () => {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('dollars', 'account', 'Dollars', 'card', 'USD', 20000)",
    );
    await importRows(
      { rows: [{ externalId: 'usd-purchase', amountMinorUnits: -50_000, time: CLOSING_AT }] },
      'dollars',
    );

    expect(balanceOf('dollars')).toBe(-30_000);

    await transactionsRepo.remove(idOf('usd-purchase'));

    expect(balanceOf('dollars')).toBe(20_000);
  });
});

describe('deleting an import row that carries a loan link', () => {
  it('removes the row with its link', async () => {
    run(
      "INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units) VALUES ('loan', 'account', 'Loan', 'loan', 'UAH', -90000)",
    );
    await importRows({
      rows: [{ externalId: 'payment', amountMinorUnits: -10_000, time: CLOSING_AT }],
    });
    run(
      "UPDATE transactions SET loan_holding_id = 'loan', loan_link_source = 'auto' WHERE external_id = 'payment'",
    );

    await transactionsRepo.remove(idOf('payment'));

    expect(await transactionsRepo.listLinkedToLoanQuery('loan')).toEqual([]);
  });
});

describe('a row a sync owns', () => {
  it.each(['monobank', 'btc_wallet', 'binance'] as const)(
    'still refuses to delete a %s row',
    async (source) => {
      insertStoredRow('synced', source, -2_000, CLOSING_AT);

      await expect(transactionsRepo.remove('synced')).rejects.toThrow(
        'transactionsRepo.remove: cannot delete a synced transaction',
      );

      expect(storedRowCount()).toBe(1);
    },
  );
});
