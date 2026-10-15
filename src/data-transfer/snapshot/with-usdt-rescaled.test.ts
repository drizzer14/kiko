// src/data-transfer/snapshot/with-usdt-rescaled.test.ts
import type {
  HoldingRow,
  TransactionRow,
  CategoryRuleRow,
  DeletedImportKeyRow,
  TransactionTemplateRow,
} from '@kiko/db';

import {
  withUsdtRescaled,
  type UsdtRescaleTables,
  LAST_SCALE_2_USDT_VERSION,
  USDT_RESCALE_BOUND_MINOR_UNITS,
} from './with-usdt-rescaled';

const TOO_LARGE =
  'data-transfer/amount-too-large: a USDT amount over 9007199254 minor units cannot be rescaled exactly';
const OVER_BOUND = USDT_RESCALE_BOUND_MINOR_UNITS + 1;
const SMALLEST_INTEGER_TEXT = '-9223372036854775808';
const SMALLEST_INTEGER = Number(SMALLEST_INTEGER_TEXT);

const holding = (fields: Partial<HoldingRow> = {}): HoldingRow =>
  ({
    id: 'usdt',
    accountId: 'account',
    name: 'USDT',
    type: 'crypto_asset',
    currency: 'USDT',
    balanceMinorUnits: 0,
    syncedBalanceMinorUnits: null,
    metadata: null,
    ...fields,
  }) as HoldingRow;

const row = (fields: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: 'row',
    holdingId: 'usdt',
    amountMinorUnits: 0,
    source: 'manual',
    externalId: null,
    ...fields,
  }) as TransactionRow;

const rule = (matchers: unknown): CategoryRuleRow =>
  ({ id: 'rule', category: 'food', matchers: JSON.stringify(matchers) }) as CategoryRuleRow;

const template = (draft: unknown): TransactionTemplateRow =>
  ({ id: 'template', name: 'Template', draft }) as TransactionTemplateRow;

const deletedKey = (externalId: string, holdingId = 'usdt'): DeletedImportKeyRow =>
  ({ holdingId, externalId, deletedAt: 1 }) as DeletedImportKeyRow;

const tablesOf = (fields: Partial<UsdtRescaleTables>): UsdtRescaleTables => ({
  holdings: [],
  transactions: [],
  categoryRules: [],
  transactionTemplates: [],
  deletedImportKeys: [],
  ...fields,
});

const rescaled = (fields: Partial<UsdtRescaleTables>): UsdtRescaleTables =>
  withUsdtRescaled(tablesOf(fields), LAST_SCALE_2_USDT_VERSION);

const KEY = 'usdt 1700000000 -1250 coffee';
const KEY_RESCALED = 'usdt 1700000000 -1250000000 coffee';

describe('withUsdtRescaled: every field it rescales', () => {
  it('rescales a holding balance and synced balance, and leaves an absent synced balance', () => {
    const result = rescaled({
      holdings: [
        holding({ balanceMinorUnits: 12345, syncedBalanceMinorUnits: 12345 }),
        holding({ id: 'unsynced', balanceMinorUnits: 7 }),
      ],
    });

    expect(result.holdings).toEqual([
      holding({ balanceMinorUnits: 12_345_000_000, syncedBalanceMinorUnits: 12_345_000_000 }),
      holding({ id: 'unsynced', balanceMinorUnits: 7_000_000, syncedBalanceMinorUnits: null }),
    ]);
  });

  it('rescales a row on a USDT holding', () => {
    expect(
      rescaled({ holdings: [holding()], transactions: [row({ amountMinorUnits: -1 })] }),
    ).toEqual(
      tablesOf({ holdings: [holding()], transactions: [row({ amountMinorUnits: -1_000_000 })] }),
    );
  });

  it('rescales every minor-unit field of USDT holding metadata', () => {
    const metadata = {
      principalMinorUnits: 100,
      faceValueMinorUnits: 200,
      purchasePriceMinorUnits: 300,
      contributions: [{ amountMinorUnits: 400, at: 1 }],
      lots: [{ costMinorUnits: 500, quantity: 2 }],
    };

    expect(rescaled({ holdings: [holding({ metadata })] }).holdings[0].metadata).toEqual({
      principalMinorUnits: 100_000_000,
      faceValueMinorUnits: 200_000_000,
      purchasePriceMinorUnits: 300_000_000,
      contributions: [{ amountMinorUnits: 400_000_000, at: 1 }],
      lots: [{ costMinorUnits: 500_000_000, quantity: 2 }],
    });
  });

  it('rescales a USDT amount matcher and leaves every other matcher', () => {
    const matchers = [
      { type: 'amount', currency: 'USDT', minorUnits: 100000, comparison: 'atLeast' },
      { type: 'amount', currency: 'UAH', minorUnits: 100000, comparison: 'atLeast' },
      { type: 'nameIs', text: 'Silpo' },
    ];
    const [rescaledRule] = rescaled({ categoryRules: [rule(matchers)] }).categoryRules;

    expect(JSON.parse(rescaledRule.matchers)).toEqual([
      { type: 'amount', currency: 'USDT', minorUnits: 100_000_000_000, comparison: 'atLeast' },
      matchers[1],
      matchers[2],
    ]);
  });

  it('rescales a template amount and its returns on the draft currency', () => {
    const draft = {
      currency: 'USDT',
      amountMinorUnits: 5000,
      returns: [{ amountMinorUnits: 700 }],
    };

    expect(rescaled({ transactionTemplates: [template(draft)] }).transactionTemplates).toEqual([
      template({
        currency: 'USDT',
        amountMinorUnits: 5_000_000_000,
        returns: [{ amountMinorUnits: 700_000_000 }],
      }),
    ]);
  });

  it.each([
    ['USDT to UAH', 'UAH', 'USDT', { amountMinorUnits: 5_000_000_000, valueInMinorUnits: 20500 }],
    ['UAH to USDT', 'USDT', 'UAH', { amountMinorUnits: 20500, valueInMinorUnits: 5_000_000_000 }],
  ])(
    'rescales an exchange template on each side its own currency: %s',
    (_name, destination, source, expected) => {
      const draft = (amountMinorUnits: number, valueInMinorUnits: number) => ({
        currency: source,
        amountMinorUnits,
        exchange: { destinationCurrency: destination, valueInMinorUnits },
      });
      const [before, after] =
        source === 'USDT' ? [draft(5000, 20500), expected] : [draft(20500, 5000), expected];

      expect(
        rescaled({ transactionTemplates: [template(before)] }).transactionTemplates?.[0].draft,
      ).toEqual(draft(after.amountMinorUnits, after.valueInMinorUnits));
    },
  );

  it('leaves a UAH template that names a USDT holding', () => {
    const draft = { currency: 'UAH', holdingId: 'usdt', amountMinorUnits: 5000, returns: [] };

    expect(rescaled({ transactionTemplates: [template(draft)] }).transactionTemplates).toEqual([
      template(draft),
    ]);
  });

  it('rescales the amount token of an import key and of its occurrence-suffixed twin', () => {
    const result = rescaled({
      holdings: [holding()],
      transactions: [
        row({ id: 'first', source: 'import', externalId: KEY }),
        row({ id: 'second', source: 'import', externalId: `${KEY}␟1` }),
      ],
    });

    expect(result.transactions.map((transaction) => transaction.externalId)).toEqual([
      KEY_RESCALED,
      `${KEY_RESCALED}␟1`,
    ]);
  });

  it('rescales a deleted import key under a USDT holding', () => {
    const result = rescaled({
      holdings: [holding()],
      deletedImportKeys: [deletedKey(KEY), deletedKey(`${KEY}␟1`)],
    });

    expect(result.deletedImportKeys).toEqual([
      deletedKey(KEY_RESCALED),
      deletedKey(`${KEY_RESCALED}␟1`),
    ]);
  });

  it('leaves BTC and UAH holdings and their rows', () => {
    const tables = tablesOf({
      holdings: [
        holding({ id: 'bitcoin', currency: 'BTC', balanceMinorUnits: 12345 }),
        holding({ id: 'hryvnia', currency: 'UAH', balanceMinorUnits: 700 }),
      ],
      transactions: [row({ holdingId: 'bitcoin', amountMinorUnits: -5 })],
    });

    expect(withUsdtRescaled(tables, LAST_SCALE_2_USDT_VERSION)).toEqual(tables);
  });

  it('rescales a value at the bound exactly, in either direction', () => {
    const result = rescaled({
      holdings: [
        holding({ balanceMinorUnits: USDT_RESCALE_BOUND_MINOR_UNITS }),
        holding({ id: 'negative', balanceMinorUnits: -USDT_RESCALE_BOUND_MINOR_UNITS }),
      ],
    });

    expect(result.holdings.map((entry) => entry.balanceMinorUnits)).toEqual([
      9_007_199_254_000_000, -9_007_199_254_000_000,
    ]);
  });
});

describe('withUsdtRescaled: which files it rescales', () => {
  const tables = tablesOf({
    holdings: [holding({ balanceMinorUnits: 12345 })],
    transactions: [row({ amountMinorUnits: -1 })],
  });

  it.each([LAST_SCALE_2_USDT_VERSION + 1, LAST_SCALE_2_USDT_VERSION + 2])(
    'returns the tables unchanged for a version %d file',
    (version) => {
      expect(withUsdtRescaled(tables, version)).toBe(tables);
    },
  );

  it.each([1, 2, LAST_SCALE_2_USDT_VERSION])('rescales a version %d file', (version) => {
    expect(withUsdtRescaled(tables, version).holdings[0].balanceMinorUnits).toBe(12_345_000_000);
  });
});

describe('withUsdtRescaled: keys', () => {
  it("decides a key by its first token's holding, never the row's own holding", () => {
    const result = rescaled({
      holdings: [holding(), holding({ id: 'hryvnia', currency: 'UAH' })],
      transactions: [
        row({ id: 'moved', holdingId: 'hryvnia', source: 'import', externalId: KEY }),
        row({
          id: 'native',
          holdingId: 'usdt',
          source: 'import',
          externalId: 'hryvnia 1700000000 -1250 coffee',
        }),
      ],
      deletedImportKeys: [
        deletedKey(KEY, 'hryvnia'),
        deletedKey('hryvnia 1700000000 -1250 coffee'),
      ],
    });

    expect(result.transactions.map((transaction) => transaction.externalId)).toEqual([
      KEY_RESCALED,
      'hryvnia 1700000000 -1250 coffee',
    ]);
    expect(result.deletedImportKeys?.map((key) => key.externalId)).toEqual([
      KEY_RESCALED,
      'hryvnia 1700000000 -1250 coffee',
    ]);
  });

  it('rescales only the rows of source import', () => {
    const result = rescaled({
      holdings: [holding()],
      transactions: [row({ source: 'manual', externalId: KEY })],
    });

    expect(result.transactions[0].externalId).toBe(KEY);
  });

  it.each([
    ['leading zeros', 'usdt 1700000000 007 coffee'],
    ['a negative zero', 'usdt 1700000000 -0 coffee'],
    ['a number past the 64-bit range', 'usdt 1700000000 99999999999999999999 coffee'],
    ['a fraction', 'usdt 1700000000 12.5 coffee'],
    ['a plus sign', 'usdt 1700000000 +5 coffee'],
    ['no description after the amount', 'usdt 1700000000 -1250'],
    ['a bank-issued id', 'bank-issued-id'],
  ])('leaves a key whose amount token is not a plain integer: %s', (_name, key) => {
    const result = rescaled({
      holdings: [holding()],
      transactions: [row({ source: 'import', externalId: key })],
      deletedImportKeys: [deletedKey(key)],
    });

    expect(result.transactions[0].externalId).toBe(key);
    expect(result.deletedImportKeys?.[0].externalId).toBe(key);
  });
});

describe('withUsdtRescaled: what it leaves as stored', () => {
  it('leaves malformed matchers text and a non-object metadata as stored', () => {
    const tables = tablesOf({
      holdings: [
        holding({ metadata: 'text' }),
        holding({ id: 'list', metadata: [{ costMinorUnits: 5 }] }),
        holding({ id: 'empty', metadata: null }),
      ],
      categoryRules: [
        { ...rule([]), matchers: 'not json' },
        { ...rule([]), id: 'object', matchers: '{"a":1}' },
      ],
      transactionTemplates: [template('text'), { ...template(null), id: 'null' }],
    });

    expect(withUsdtRescaled(tables, LAST_SCALE_2_USDT_VERSION)).toEqual(tables);
  });

  it('leaves a string or real field and rescales its integer siblings', () => {
    const metadata = {
      principalMinorUnits: '5000',
      faceValueMinorUnits: 12.5,
      purchasePriceMinorUnits: 700,
      contributions: [{ amountMinorUnits: '5000' }, { amountMinorUnits: 1.5 }],
      lots: [{ costMinorUnits: null }],
    };

    expect(rescaled({ holdings: [holding({ metadata })] }).holdings[0].metadata).toEqual({
      ...metadata,
      purchasePriceMinorUnits: 700_000_000,
    });
  });

  it('keeps every other array element as it was, in order', () => {
    const lots = ['text', null, true, { quantity: 1 }, { costMinorUnits: 5 }, [1, 2], false];

    expect(
      (
        rescaled({ holdings: [holding({ metadata: { lots } })] }).holdings[0].metadata as {
          lots: unknown[];
        }
      ).lots,
    ).toEqual(['text', null, true, { quantity: 1 }, { costMinorUnits: 5_000_000 }, [1, 2], false]);
  });

  it('keeps the parsed value of a bare number element', () => {
    const draft = {
      currency: 'USDT',
      returns: [0.30000000000000004, 1.5, 100000, { amountMinorUnits: 3 }],
    };

    const [result] =
      rescaled({ transactionTemplates: [template(draft)] }).transactionTemplates ?? [];

    expect((result.draft as { returns: unknown[] }).returns).toEqual([
      0.30000000000000004,
      1.5,
      100000,
      { amountMinorUnits: 3_000_000 },
    ]);
  });

  it('leaves the same row objects when nothing in them is rescaled', () => {
    const untouched = holding({ id: 'bitcoin', currency: 'BTC', metadata: { lots: [] } });
    const result = rescaled({ holdings: [untouched, holding()] });

    expect(result.holdings[0]).toBe(untouched);
  });
});

describe('withUsdtRescaled: the safe-integer bound', () => {
  it('rescales a UAH value over the bound', () => {
    const tables = tablesOf({
      holdings: [holding({ id: 'hryvnia', currency: 'UAH', balanceMinorUnits: OVER_BOUND })],
      transactions: [row({ holdingId: 'hryvnia', amountMinorUnits: -OVER_BOUND })],
      categoryRules: [
        rule([{ type: 'amount', currency: 'UAH', minorUnits: OVER_BOUND, comparison: 'atLeast' }]),
      ],
      transactionTemplates: [template({ currency: 'UAH', amountMinorUnits: OVER_BOUND })],
    });

    expect(withUsdtRescaled(tables, LAST_SCALE_2_USDT_VERSION)).toEqual(tables);
  });

  it('leaves an over-bound string or real USDT field as stored', () => {
    const metadata = {
      principalMinorUnits: String(OVER_BOUND),
      faceValueMinorUnits: OVER_BOUND + 0.5,
      lots: [{ costMinorUnits: OVER_BOUND + 0.5 }],
    };
    const matchers = [
      { type: 'amount', currency: 'USDT', minorUnits: String(OVER_BOUND), comparison: 'atLeast' },
    ];
    const tables = tablesOf({
      holdings: [holding({ metadata })],
      categoryRules: [rule(matchers)],
    });

    expect(withUsdtRescaled(tables, LAST_SCALE_2_USDT_VERSION)).toEqual(tables);
  });

  it.each([
    ['a holding balance', { holdings: [holding({ balanceMinorUnits: OVER_BOUND })] }],
    ['a holding synced balance', { holdings: [holding({ syncedBalanceMinorUnits: -OVER_BOUND })] }],
    [
      'a row amount',
      { holdings: [holding()], transactions: [row({ amountMinorUnits: -OVER_BOUND })] },
    ],
    [
      'a metadata field',
      { holdings: [holding({ metadata: { principalMinorUnits: OVER_BOUND } })] },
    ],
    [
      'a contribution',
      { holdings: [holding({ metadata: { contributions: [{ amountMinorUnits: OVER_BOUND }] } })] },
    ],
    [
      'a lots element',
      { holdings: [holding({ metadata: { lots: [{ costMinorUnits: -OVER_BOUND }] } })] },
    ],
    [
      'a matcher',
      {
        categoryRules: [
          rule([
            { type: 'amount', currency: 'USDT', minorUnits: OVER_BOUND, comparison: 'atLeast' },
          ]),
        ],
      },
    ],
    [
      'a template amount',
      { transactionTemplates: [template({ currency: 'USDT', amountMinorUnits: OVER_BOUND })] },
    ],
    [
      'a template return',
      {
        transactionTemplates: [
          template({ currency: 'USDT', returns: [{ amountMinorUnits: OVER_BOUND }] }),
        ],
      },
    ],
    [
      'an exchange value',
      {
        transactionTemplates: [
          template({
            currency: 'UAH',
            exchange: { destinationCurrency: 'USDT', valueInMinorUnits: OVER_BOUND },
          }),
        ],
      },
    ],
    [
      'a transaction key',
      {
        holdings: [holding()],
        transactions: [
          row({ source: 'import', externalId: `usdt 1700000000 ${OVER_BOUND} coffee` }),
        ],
      },
    ],
    [
      'a deleted key',
      {
        holdings: [holding()],
        deletedImportKeys: [deletedKey(`usdt 1700000000 -${OVER_BOUND} tea`)],
      },
    ],
  ])('throws amount-too-large over the bound: %s', (_name, fields) => {
    expect(() => rescaled(fields)).toThrow(new Error(TOO_LARGE));
  });

  it('throws for an integer field far outside the safe range', () => {
    expect(() =>
      rescaled({
        holdings: [holding({ metadata: { lots: [{ costMinorUnits: SMALLEST_INTEGER }] } })],
      }),
    ).toThrow(new Error(TOO_LARGE));
  });

  it('throws for the smallest 64-bit integer as a key token', () => {
    expect(() =>
      rescaled({
        holdings: [holding()],
        transactions: [
          row({ source: 'import', externalId: `usdt 1700000000 ${SMALLEST_INTEGER_TEXT} tea` }),
        ],
      }),
    ).toThrow(new Error(TOO_LARGE));
  });
});
