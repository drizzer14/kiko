// The funding caption needs the rows of one (fiat, total) bucket and nothing else: the bank debits
// of that exact amount and every positive row whose code could name a fiat total. Only a real
// engine proves the statement's predicate against NULL codes, signs and the prefix compare.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import { DAY_MS } from '@kiko/dates';
import { DatabaseSync } from 'node:sqlite';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { transactionsRepo } from './transactions.repo';

const TARGET_AMOUNT = -415_000;
const FIRST_TIME = Date.UTC(2026, 8, 1, 10);
const OTHER_DEBIT_COUNT = 5_000;

type FundingMatchCandidates = (amountMinorUnits: number) => PromiseLike<Record<string, unknown>[]>;

// The query does not exist yet in the red commit: a runtime lookup keeps the file type-checking.
const candidatesRead = (): FundingMatchCandidates => {
  const read = (transactionsRepo as Record<string, unknown>).fundingMatchCandidatesQuery;

  if (typeof read !== 'function') {
    throw new Error('transactionsRepo.fundingMatchCandidatesQuery is not a function');
  }

  return read as FundingMatchCandidates;
};

// id, holding id, amount in minor units, stored code.
type SeedRow = readonly [string, string, number, string | null];

const BUCKET_ROWS: SeedRow[] = [
  ['debit-uah', 'card', TARGET_AMOUNT, null],
  ['debit-eur', 'card-eur', TARGET_AMOUNT, null],
  ['debit-wallet', 'wallet', TARGET_AMOUNT, null],
  ['debit-coded', 'card', TARGET_AMOUNT, 'wallet:FUTURES'],
  ['p2p-purchase', 'wallet', 9_990, 'p2p:UAH:4150.00'],
  ['card-purchase', 'wallet', 9_990, 'card:UAH:4150.00'],
  ['bank-deposit', 'wallet', 9_990, 'bank:EUR:4150.00'],
  ['p2p-other-total', 'wallet', 9_990, 'p2p:UAH:100.00'],
];

const EXCLUDED_ROWS: SeedRow[] = [
  ['wallet-code', 'wallet', 500, 'wallet:UMFUTURE'],
  ['asset-code', 'wallet', 500, 'asset:PEPE'],
  ['kind-without-colon', 'wallet', 500, 'p2p'],
  ['negative-coded', 'card', -500, 'p2p:UAH:4150.00'],
  ['zero-coded', 'wallet', 0, 'card:UAH:4150.00'],
  ['uppercase-kind', 'wallet', 500, 'P2P:UAH:4150.00'],
  ['credit-of-the-amount', 'card', -TARGET_AMOUNT, null],
  ['plain-credit', 'card', 500, null],
];

const insertStatement = () =>
  mockDatabase.prepare(`
    INSERT INTO transactions
      (id, holding_id, amount_minor_units, time, description, category_set_by_hand, mcc,
       sets_balance, untracked_counterpart, source, external_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'monobank', ?)
  `);

const rowOf = (id: string, amount: number, description = '', byHand = 0, mcc = 0, sets = 0) =>
  [id, 'card', amount, FIRST_TIME, description, byHand, mcc || null, sets, null, id] as const;

const seedWorld = (): void => {
  mockDatabase.exec('PRAGMA foreign_keys = ON;');
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES
      ('account', 'Monobank', 'bank'), ('exchange', 'Binance', 'crypto');
    INSERT INTO holdings (id, account_id, name, type, currency) VALUES
      ('card', 'account', 'Card', 'card', 'UAH'),
      ('card-eur', 'account', 'Euro card', 'card', 'EUR'),
      ('wallet', 'exchange', 'Wallet', 'spot', 'USDT');
  `);

  const insert = insertStatement();

  mockDatabase.exec('BEGIN');

  [...BUCKET_ROWS, ...EXCLUDED_ROWS].forEach(([id, holdingId, amount, code], index) => {
    insert.run(id, holdingId, amount, FIRST_TIME + index * 7 * DAY_MS, id, 0, null, 0, code, id);
  });

  for (let index = 0; index < OTHER_DEBIT_COUNT; index += 1) {
    const id = `other-${index}`;

    insert.run(id, 'card', -(1_000 + index), FIRST_TIME + index, 'Shop', 0, 5411, 0, null, id);
  }

  mockDatabase.exec('COMMIT');
};

const idsOf = (rows: Record<string, unknown>[]): unknown[] => rows.map(({ id }) => id).sort();

beforeEach(() => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
});

describe('transactionsRepo.fundingMatchCandidatesQuery', () => {
  it('reads exactly the rows of the amount bucket in a world of thousands of other debits', async () => {
    seedWorld();

    const rows = await candidatesRead()(TARGET_AMOUNT);

    expect(idsOf(rows)).toEqual(BUCKET_ROWS.map(([id]) => id).sort());
  });

  it('reads the debits of the amount asked, with every positive coded purchase', async () => {
    seedWorld();
    insertStatement().run(...rowOf('debit-other-amount', -260_000));

    const rows = await candidatesRead()(-260_000);

    expect(idsOf(rows)).toEqual(
      [
        'debit-other-amount',
        ...BUCKET_ROWS.filter(([, , amount]) => amount > 0).map(([id]) => id),
      ].sort(),
    );
  });

  it('reads exactly the nine columns the matcher takes, with the stored values', async () => {
    seedWorld();
    insertStatement().run(...rowOf('full', TARGET_AMOUNT, 'Binance', 1, 4829, 1));

    const rows = await candidatesRead()(TARGET_AMOUNT);

    expect(rows.find(({ id }) => id === 'full')).toEqual({
      id: 'full',
      holdingId: 'card',
      time: FIRST_TIME,
      amountMinorUnits: TARGET_AMOUNT,
      untrackedCounterpart: null,
      description: 'Binance',
      mcc: 4829,
      categorySetByHand: true,
      setsBalance: true,
    });
    expect(new Set(rows.map((row) => Object.keys(row).sort().join()))).toEqual(
      new Set([
        'amountMinorUnits,categorySetByHand,description,holdingId,id,mcc,setsBalance,time,untrackedCounterpart',
      ]),
    );
  });
});
