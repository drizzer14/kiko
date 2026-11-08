import Papa from 'papaparse';
import { i18n } from '@kiko/i18n/init';
import type { SettingsRow } from '@kiko/db';
import { detectFormat } from '@kiko/statement-import/registry';
import { buildSpendingLedger } from '@kiko/statistics/spending-ledger';
import {
  accountRow,
  BANK,
  BASE_TIME,
  CRYPTO,
  holdingRow,
  MINUTE,
  transactionRow,
  worldInput,
  WORLD_TRANSACTIONS,
} from '@kiko/statistics/spending-ledger/__fixtures__/spending-ledger-world';
import { applyColumnMapping, readTableRows } from '@kiko/statement-import/column-mapping';

import type { CsvDialect } from './csv-cell';
import { buildCsvText, csvTransactionType } from './csv-rows';

type Snapshot = Parameters<typeof buildCsvText>[0]['snapshot'];

const english = i18n.getFixedT('en');
const ukrainian = i18n.getFixedT('uk');

const ENGLISH: CsvDialect = { delimiter: ',', decimal: '.' };
const UKRAINIAN: CsvDialect = { delimiter: ';', decimal: ',' };

const WORLD = worldInput();

const snapshotOf = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  accounts: [...WORLD.accounts],
  holdings: [...WORLD.holdings],
  transactions: [...WORLD_TRANSACTIONS],
  categories: [],
  settings: [],
  ...overrides,
});

const parse = (text: string, dialect: CsvDialect): string[][] =>
  Papa.parse<string[]>(text, { delimiter: dialect.delimiter, skipEmptyLines: true }).data;

const cellsOf = (snapshot = snapshotOf(), dialect = ENGLISH): string[][] =>
  parse(buildCsvText({ snapshot, dialect, t: english }), dialect);

const COLUMN = {
  date: 0,
  account: 1,
  holding: 2,
  amount: 3,
  currency: 4,
  category: 5,
  description: 6,
  comment: 7,
  type: 8,
  pending: 9,
  source: 10,
};

describe('buildCsvText header', () => {
  it('names the columns in the English app language, in the spec order', () => {
    expect(cellsOf()[0]).toEqual([
      'Date',
      'Account',
      'Holding',
      'Amount',
      'Currency',
      'Category',
      'Description',
      'Comment',
      'Type',
      'Pending',
      'Source',
    ]);
  });

  it('names the columns in the Ukrainian app language', () => {
    const text = buildCsvText({ snapshot: snapshotOf(), dialect: UKRAINIAN, t: ukrainian });

    expect(parse(text, UKRAINIAN)[0]).toEqual([
      'Дата',
      'Рахунок',
      'Актив',
      'Сума',
      'Валюта',
      'Категорія',
      'Опис',
      'Коментар',
      'Тип',
      'В обробці',
      'Джерело',
    ]);
  });
});

describe('buildCsvText file shape', () => {
  const text = buildCsvText({ snapshot: snapshotOf(), dialect: ENGLISH, t: english });

  it('starts with a byte order mark', () => {
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text.indexOf('\uFEFF', 1)).toBe(-1);
  });

  it('ends every record with CRLF and uses no bare line feed', () => {
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n')).toHaveLength(WORLD_TRANSACTIONS.length + 2);
    expect(text.replaceAll('\r\n', '').includes('\n')).toBe(false);
  });

  it('keeps every row of every non-archived account, whatever Statistics excludes', () => {
    expect(cellsOf()).toHaveLength(WORLD_TRANSACTIONS.length + 1);
  });

  it('lists the oldest row first whatever order the ledger arrives in', () => {
    const reversed = snapshotOf({ transactions: [...WORLD_TRANSACTIONS].reverse() });
    const dates = cellsOf(reversed)
      .slice(1)
      .map((row) => row[COLUMN.date]);

    expect(dates).toEqual([...dates].sort());
    expect(new Set(dates).size).toBeGreaterThan(1);
  });
});

describe('buildCsvText cells', () => {
  const CARD_ROW = transactionRow({
    id: 'full',
    holdingId: 'card',
    amountMinorUnits: -15_075,
    time: BASE_TIME + 10 * MINUTE + 7_000,
    description: 'Coffee, big',
    comment: 'with milk',
    category: 'groceries',
    hold: true,
    source: 'monobank',
  });
  const categories = [
    { key: 'groceries', title: 'Groceries', icon: 'cart', color: null, sortOrder: 0 },
    { key: 'other', title: 'Other', icon: 'ellipsis', color: null, sortOrder: 1 },
  ];
  const singleRowOf = (
    overrides: Partial<Snapshot> = {},
    dialect = ENGLISH,
    t = english,
  ): string[] =>
    parse(
      buildCsvText({
        snapshot: snapshotOf({ transactions: [CARD_ROW], categories, ...overrides }),
        dialect,
        t,
      }),
      dialect,
    )[1];

  it('writes one row with every column in the spec order', () => {
    expect(singleRowOf()).toEqual([
      '2024-01-05 12:10:07',
      'bank',
      'card',
      '-150.75',
      'UAH',
      'Groceries',
      'Coffee, big',
      'with milk',
      'Expense',
      'Yes',
      'Monobank',
    ]);
  });

  it('writes the type, pending and source values in the Ukrainian app language', () => {
    const row = singleRowOf({}, UKRAINIAN, ukrainian);

    expect(row.slice(COLUMN.type)).toEqual(['Витрата', 'Так', 'Monobank']);
  });

  it.each([
    ['manual', 'Manual', 'Вручну'],
    ['monobank', 'Monobank', 'Monobank'],
    ['btc_wallet', 'Bitcoin wallet', 'Гаманець Bitcoin'],
    ['binance', 'Binance', 'Binance'],
    ['import', 'Statement import', 'Імпорт виписки'],
  ] as const)('names the %s source in both languages', (source, inEnglish, inUkrainian) => {
    const transactions = [transactionRow({ ...CARD_ROW, id: 'sourced', source })];

    expect(singleRowOf({ transactions })[COLUMN.source]).toBe(inEnglish);
    expect(singleRowOf({ transactions }, UKRAINIAN, ukrainian)[COLUMN.source]).toBe(inUkrainian);
  });

  it.each([
    ['expense', -100, 'Expense', 'Витрата'],
    ['income', 100, 'Income', 'Дохід'],
  ])('names a %s row by its type in both languages', (id, amount, inEnglish, inUkrainian) => {
    const transactions = [transactionRow({ ...CARD_ROW, id, amountMinorUnits: amount })];

    expect(singleRowOf({ transactions })[COLUMN.type]).toBe(inEnglish);
    expect(singleRowOf({ transactions }, UKRAINIAN, ukrainian)[COLUMN.type]).toBe(inUkrainian);
  });

  it('writes the amount in the holding currency with the dialect decimal', () => {
    expect(singleRowOf({}, UKRAINIAN, ukrainian)[COLUMN.amount]).toBe('-150,75');
  });

  it('writes a satoshi amount as a plain decimal', () => {
    const wallet = holdingRow({ id: 'wallet', accountId: 'crypto', currency: 'BTC' });
    const satoshi = transactionRow({ id: 'sat', holdingId: 'wallet', amountMinorUnits: 1 });
    const row = singleRowOf({ holdings: [...WORLD.holdings, wallet], transactions: [satoshi] });

    expect(row[COLUMN.amount]).toBe('0.00000001');
    expect(row[COLUMN.currency]).toBe('BTC');
  });

  it('writes pending No for a settled row and for a row with no flag', () => {
    const settled = transactionRow({ ...CARD_ROW, id: 'settled', hold: false });
    const unflagged = transactionRow({ ...CARD_ROW, id: 'unflagged', hold: null });

    expect(singleRowOf({ transactions: [settled] })[COLUMN.pending]).toBe('No');
    expect(singleRowOf({ transactions: [unflagged] })[COLUMN.pending]).toBe('No');
    expect(singleRowOf({ transactions: [settled] }, UKRAINIAN, ukrainian)[COLUMN.pending]).toBe(
      'Ні',
    );
  });

  it('folds a row with no category into the default category title', () => {
    const uncategorized = transactionRow({ ...CARD_ROW, id: 'plain', category: null });

    expect(singleRowOf({ transactions: [uncategorized] })[COLUMN.category]).toBe('Other');
  });

  it('folds a row with no category into the default category the settings name', () => {
    const uncategorized = transactionRow({ ...CARD_ROW, id: 'plain', category: null });
    const settings = [{ id: 1, defaultCategoryKey: 'groceries' } as SettingsRow];

    expect(singleRowOf({ transactions: [uncategorized], settings })[COLUMN.category]).toBe(
      'Groceries',
    );
  });

  it('writes an empty comment for a row with none', () => {
    const silent = transactionRow({ ...CARD_ROW, id: 'silent', comment: null });

    expect(singleRowOf({ transactions: [silent] })[COLUMN.comment]).toBe('');
  });

  it('names an unrenamed implicit account by its localized kind name', () => {
    const world: Partial<Snapshot> = {
      accounts: [...WORLD.accounts, accountRow({ id: 'loans', kind: 'debt', name: 'Loans' })],
      holdings: [...WORLD.holdings, holdingRow({ id: 'flat', accountId: 'loans' })],
      transactions: [transactionRow({ id: 'on-loans', holdingId: 'flat' })],
    };

    expect(singleRowOf(world)[COLUMN.account]).toBe(english('accounts.implicitName.debt'));
    expect(singleRowOf(world, UKRAINIAN, ukrainian)[COLUMN.account]).toBe('Кредити');
  });
});

describe('buildCsvText formula safety', () => {
  it.each([
    ['description', COLUMN.description, { description: '=HYPERLINK("x")' }],
    ['comment', COLUMN.comment, { comment: '@cmd' }],
  ])('prefixes a %s that starts like a formula', (_name, column, overrides) => {
    const row = transactionRow({ id: 'formula', holdingId: 'card', ...overrides });

    expect(cellsOf(snapshotOf({ transactions: [row] }))[1][column].startsWith("'")).toBe(true);
  });

  it('prefixes an account and a holding name that start like a formula', () => {
    const account = accountRow({ id: 'evil', kind: 'bank', name: '+evil' });
    const holding = holdingRow({ id: 'evil-card', accountId: 'evil', name: '=evil' });
    const row = transactionRow({ id: 'on-evil', holdingId: 'evil-card' });
    const cells = cellsOf(
      snapshotOf({ accounts: [account], holdings: [holding], transactions: [row] }),
    )[1];

    expect(cells[COLUMN.account]).toBe("'+evil");
    expect(cells[COLUMN.holding]).toBe("'=evil");
  });

  it('never prefixes a negative amount', () => {
    const row = transactionRow({ id: 'debit', holdingId: 'card', amountMinorUnits: -100 });

    expect(cellsOf(snapshotOf({ transactions: [row] }))[1][COLUMN.amount]).toBe('-1.00');
  });
});

describe('buildCsvText leaves out what is not the user data', () => {
  const MARKERS = [
    'MARKER-COUNTER-IBAN',
    'MARKER-EXTERNAL-ID',
    'MARKER-ROW-ID',
    'MARKER-HOLDING-ID',
    'MARKER-ACCOUNT-ID',
    'MARKER-IBAN',
    'MARKER-MASKED-PAN',
    'MARKER-MONOBANK-ID',
    'MARKER-LENDER-IBAN',
    'MARKER-SECRET',
  ];
  const account = accountRow({ id: 'MARKER-ACCOUNT-ID', kind: 'bank', name: 'Main bank' });
  const holding = holdingRow({
    id: 'MARKER-HOLDING-ID',
    accountId: 'MARKER-ACCOUNT-ID',
    name: 'Everyday',
    metadata: {
      iban: 'MARKER-IBAN',
      maskedPan: ['MARKER-MASKED-PAN'],
      monobankId: 'MARKER-MONOBANK-ID',
      lenderIban: 'MARKER-LENDER-IBAN',
      token: 'MARKER-SECRET',
    },
  });
  const row = transactionRow({
    id: 'MARKER-ROW-ID',
    holdingId: 'MARKER-HOLDING-ID',
    counterIban: 'MARKER-COUNTER-IBAN',
    externalId: 'MARKER-EXTERNAL-ID',
    description: 'Visible description',
  });
  const snapshot = snapshotOf({ accounts: [account], holdings: [holding], transactions: [row] });

  it.each([
    ['English', ENGLISH, english],
    ['Ukrainian', UKRAINIAN, ukrainian],
  ])('writes none of the marker values under %s', (_name, dialect, t) => {
    const text = buildCsvText({ snapshot, dialect, t });
    const seeded = JSON.stringify(snapshot);

    expect(text).toContain('Visible description');
    expect(text).toContain('Main bank');

    MARKERS.forEach((marker) => {
      expect(seeded).toContain(marker);
      expect(text).not.toContain(marker);
    });
  });

  it('writes the same eleven columns on every row', () => {
    expect(new Set(cellsOf(snapshot).map((cells) => cells.length))).toEqual(new Set([11]));
  });
});

describe('buildCsvText archived accounts', () => {
  const ARCHIVED = accountRow({ id: 'old', kind: 'bank', archivedAt: 1 });
  const OLD_CARD = holdingRow({ id: 'old-card', accountId: 'old', name: 'Old card' });
  const OUT = transactionRow({
    id: 'archived-out',
    holdingId: 'card',
    amountMinorUnits: -5_000,
    description: 'Moves to the old card',
  });
  const IN = transactionRow({
    id: 'archived-in',
    holdingId: 'old-card',
    amountMinorUnits: 5_000,
    time: OUT.time + 1_000,
    description: 'Arrives on the old card',
  });
  const snapshot = snapshotOf({
    accounts: [BANK, CRYPTO, ARCHIVED],
    holdings: [...WORLD.holdings, OLD_CARD],
    transactions: [OUT, IN],
  });

  it('writes no row of an archived account', () => {
    const descriptions = cellsOf(snapshot)
      .slice(1)
      .map((cells) => cells[COLUMN.description]);

    expect(descriptions).toEqual(['Moves to the old card']);
  });

  it('classes a row whose transfer partner sits under an archived account as a transfer', () => {
    expect(cellsOf(snapshot)[1][COLUMN.type]).toBe('Transfer');
  });
});

describe('buildCsvText read back', () => {
  const TRICKY = transactionRow({
    id: 'tricky',
    holdingId: 'card',
    amountMinorUnits: -123_456,
    description: 'Milk, bread; "fresh"\r\nsecond line',
    comment: '-not a formula',
    time: BASE_TIME + 3 * MINUTE,
  });
  const snapshot = snapshotOf({
    transactions: [TRICKY],
    categories: [{ key: 'other', title: 'Other', icon: 'ellipsis', color: null, sortOrder: 0 }],
  });

  it.each([
    ['English', ENGLISH, '-1234.56'],
    ['Ukrainian', UKRAINIAN, '-1234,56'],
  ])('parses back to the same cells under the %s dialect', (_name, dialect, amount) => {
    expect(cellsOf(snapshot, dialect)[1]).toEqual([
      '2024-01-05 12:03:00',
      'bank',
      'card',
      amount,
      'UAH',
      'Other',
      'Milk, bread; "fresh"\r\nsecond line',
      "'-not a formula",
      'Expense',
      'No',
      'Manual',
    ]);
  });

  it.each([
    ['English', ENGLISH],
    ['Ukrainian', UKRAINIAN],
  ])('is no known statement format under the %s dialect', (_name, dialect) => {
    const text = buildCsvText({ snapshot, dialect, t: english });

    expect(detectFormat({ text, fileName: 'kiko-transactions-1.csv' })).toBeUndefined();
  });

  it.each([
    ['English', ENGLISH],
    ['Ukrainian', UKRAINIAN],
  ])('maps through column mapping under the %s dialect', (_name, dialect) => {
    const text = buildCsvText({ snapshot, dialect, t: english });
    const { rows } = readTableRows(
      { text, fileName: 'kiko-transactions-1.csv' },
      dialect.delimiter,
    );

    const { statement, rowErrors } = applyColumnMapping(rows, {
      headerRowIndex: 0,
      delimiter: dialect.delimiter,
      decimalSeparator: dialect.decimal,
      dateColumn: COLUMN.date,
      dateFormat: 'YYYY-MM-DD HH:MM:SS',
      amount: { mode: 'single', column: COLUMN.amount },
      descriptionColumn: COLUMN.description,
      currency: { mode: 'column', column: COLUMN.currency },
    });

    expect(rowErrors).toEqual([]);
    expect(statement.transactions).toHaveLength(1);
    expect(statement.transactions[0]).toMatchObject({
      amountMinorUnits: -123_456,
      currency: 'UAH',
      timeSeconds: (BASE_TIME + 3 * MINUTE) / 1000,
    });
  });
});

describe('csvTransactionType', () => {
  const at = (minutes: number) => BASE_TIME + minutes * MINUTE;
  const EXTRA = [
    transactionRow({ id: 'salary', holdingId: 'card', amountMinorUnits: 50_000, time: at(400) }),
    transactionRow({
      id: 'balance-row',
      holdingId: 'card',
      amountMinorUnits: -60_000,
      setsBalance: true,
      time: at(410),
    }),
    transactionRow({
      id: 'balance-and-loan',
      holdingId: 'card',
      amountMinorUnits: -61_000,
      setsBalance: true,
      loanHoldingId: 'loan',
      time: at(420),
    }),
    transactionRow({
      id: 'loan-and-description',
      holdingId: 'card',
      amountMinorUnits: -7_777,
      loanHoldingId: 'loan',
      description: 'Поповнення депозиту',
      time: at(430),
    }),
    transactionRow({
      id: 'exchange-and-description',
      holdingId: 'card',
      amountMinorUnits: -8_888,
      exchangeCounterpartHoldingId: 'coin',
      description: 'Поповнення депозиту',
      time: at(440),
    }),
    transactionRow({
      id: 'real-debit',
      holdingId: 'card',
      amountMinorUnits: -6_000,
      time: at(450),
    }),
    transactionRow({
      id: 'set-credit',
      holdingId: 'cash',
      amountMinorUnits: 6_000,
      setsBalance: true,
      time: at(450) + 1_000,
    }),
    transactionRow({
      id: 'real-credit',
      holdingId: 'cash',
      amountMinorUnits: 9_000,
      time: at(470),
    }),
    transactionRow({
      id: 'set-debit',
      holdingId: 'card',
      amountMinorUnits: -9_000,
      setsBalance: true,
      time: at(470) + 1_000,
    }),
    transactionRow({ id: 'zero', holdingId: 'card', amountMinorUnits: 0, time: at(490) }),
  ];
  const ALL = [...WORLD_TRANSACTIONS, ...EXTRA];
  const typeOf = csvTransactionType({
    transactions: ALL,
    holdings: WORLD.holdings,
    accounts: WORLD.accounts,
  });
  const rowOf = (id: string) => {
    const found = ALL.find((candidate) => candidate.id === id);

    if (found === undefined) {
      throw new Error(`no row ${id}`);
    }

    return found;
  };

  it.each([
    ['counted', 'expense'],
    ['salary', 'income'],
    ['zero', 'expense'],
    ['transfer-out', 'transfer'],
    ['transfer-in', 'transfer'],
    ['cash-out', 'transfer'],
    ['deposit-top-up', 'transfer'],
    ['convert-leg', 'exchange'],
    ['move-out', 'exchange'],
    ['move-in', 'exchange'],
    ['coin-purchase', 'exchange'],
    ['funding-debit', 'exchange'],
    ['loan-payment', 'loan'],
    ['balance-row', 'balance'],
  ])('classes %s as %s, one row per rule', (id, expected) => {
    expect(typeOf(rowOf(id))).toBe(expected);
  });

  it.each([
    ['balance-and-loan', 'balance'],
    ['loan-and-description', 'loan'],
    ['exchange-and-description', 'exchange'],
  ])('lets the stronger rule win for %s', (id, expected) => {
    expect(typeOf(rowOf(id))).toBe(expected);
  });

  it('classes a real row whose only partner is a balance-set row by its sign', () => {
    expect(typeOf(rowOf('real-debit'))).toBe('expense');
    expect(typeOf(rowOf('real-credit'))).toBe('income');
    expect(typeOf(rowOf('set-credit'))).toBe('balance');
    expect(typeOf(rowOf('set-debit'))).toBe('balance');
  });

  it('classes a funding debit the user categorized by hand as an expense', () => {
    const byHand = WORLD_TRANSACTIONS.map((row) =>
      row.id === 'funding-debit' ? { ...row, categorySetByHand: true } : row,
    );
    const handTypeOf = csvTransactionType({
      transactions: byHand,
      holdings: WORLD.holdings,
      accounts: WORLD.accounts,
    });

    expect(handTypeOf(rowOf('funding-debit'))).toBe('expense');
  });
});

describe('csvTransactionType feed order', () => {
  const at = (seconds: number) => BASE_TIME + seconds * 1_000;
  const SAVINGS = holdingRow({ id: 'savings', accountId: 'bank' });
  // Two debits compete for one credit, every pair inside the two-minute window: which debit the
  // credit pairs with depends on the order the rows arrive in. Ids run with the time, so a feed
  // by id and the app's time-descending feed disagree.
  const DEBIT_A = transactionRow({
    id: 'a',
    holdingId: 'card',
    amountMinorUnits: -10_000,
    time: at(0),
  });
  const DEBIT_B = transactionRow({
    id: 'b',
    holdingId: 'cash',
    amountMinorUnits: -10_000,
    time: at(60),
  });
  const CREDIT_C = transactionRow({
    id: 'c',
    holdingId: 'savings',
    amountMinorUnits: 10_000,
    time: at(90),
  });
  const HOLDINGS = [...WORLD.holdings, SAVINGS];

  // What the app marks: the order of `listAllQuery`, `ORDER BY time DESC`.
  const appExcludedIds = buildSpendingLedger({
    transactions: [DEBIT_A, DEBIT_B, CREDIT_C].sort((first, second) => second.time - first.time),
    holdings: HOLDINGS,
    accounts: WORLD.accounts,
    shownHoldings: HOLDINGS,
  }).excludedTransactionIds;

  it('is the review scenario: the app pairs the credit with the later debit', () => {
    expect([...appExcludedIds].sort()).toEqual(['b', 'c']);
  });

  it.each([
    ['by id', [DEBIT_A, DEBIT_B, CREDIT_C]],
    ['reversed', [CREDIT_C, DEBIT_B, DEBIT_A]],
  ])('types each row as the app marks it, rows arriving %s', (_name, rows) => {
    const typeOf = csvTransactionType({
      transactions: rows,
      holdings: HOLDINGS,
      accounts: WORLD.accounts,
    });

    expect([DEBIT_A, DEBIT_B, CREDIT_C].map((row) => [row.id, typeOf(row)])).toEqual(
      [DEBIT_A, DEBIT_B, CREDIT_C].map((row) => [
        row.id,
        appExcludedIds.has(row.id) ? 'transfer' : 'expense',
      ]),
    );
  });
});

describe('buildCsvText rows of one time', () => {
  it('orders them by id, whatever order they arrive in', () => {
    const rows = ['b', 'c', 'a'].map((id) =>
      transactionRow({ id, holdingId: 'card', description: `row ${id}`, time: BASE_TIME }),
    );
    const descriptions = cellsOf(snapshotOf({ transactions: rows }))
      .slice(1)
      .map((cells) => cells[COLUMN.description]);

    expect(descriptions).toEqual(['row a', 'row b', 'row c']);
  });
});
