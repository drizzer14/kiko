// drizzle/migrations/0059-usdt-scale-8.test.ts
//
// Runs the shipped SQL on a real `node:sqlite` engine seeded as a device's database stood before
// it, so every rescaled field and every field it must leave alone is proven on real rows.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { applyMigrationsThrough } from '@kiko/test-support/real-sqlite';

const MIGRATION_FILE = join(__dirname, '0059_usdt_scale_8.sql');

const applyMigration = (database: DatabaseSync): void => {
  const statements = readFileSync(MIGRATION_FILE, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');

  for (const statement of statements) {
    database.exec(statement);
  }
};

const databaseBefore = (): DatabaseSync => {
  const database = new DatabaseSync(':memory:');

  applyMigrationsThrough(database, '0058_add_untracked_counterpart');
  database.exec("INSERT INTO accounts (id, name, kind) VALUES ('account', 'Crypto', 'crypto')");

  return database;
};

const scalarOf = (database: DatabaseSync, sql: string, ...parameters: SQLInputValue[]): unknown =>
  (database.prepare(sql).get(...parameters) as { value: unknown }).value;

const insertHolding = (
  database: DatabaseSync,
  id: string,
  currency: string,
  balance = 0,
  metadata: string | null = null,
  syncedBalance: number | null = null,
): void => {
  database
    .prepare(
      `INSERT INTO holdings
         (id, account_id, name, type, currency, balance_minor_units, synced_balance_minor_units,
          metadata)
       VALUES (?, 'account', ?, 'crypto_asset', ?, ?, ?, ?)`,
    )
    .run(id, id, currency, balance, syncedBalance, metadata);
};

const insertRow = (database: DatabaseSync, id: string, holdingId: string, amount: number): void => {
  database
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, source)
       VALUES (?, ?, ?, 1, 'manual')`,
    )
    .run(id, holdingId, amount);
};

const insertRule = (database: DatabaseSync, id: string, matchers: string): void => {
  database
    .prepare("INSERT INTO category_rules (id, category, matchers) VALUES (?, 'food', ?)")
    .run(id, matchers);
};

const insertTemplate = (database: DatabaseSync, id: string, draft: string): void => {
  database
    .prepare("INSERT INTO transaction_templates (id, name, draft) VALUES (?, 'Template', ?)")
    .run(id, draft);
};

const draftOf = (fields: Record<string, unknown>): string =>
  JSON.stringify({
    version: 1,
    mode: 'expense',
    holdingId: null,
    currency: null,
    amountMinorUnits: null,
    description: '',
    category: null,
    exchange: null,
    returns: [],
    ...fields,
  });

const balanceOf = (database: DatabaseSync, id: string): unknown =>
  scalarOf(database, 'SELECT balance_minor_units AS value FROM holdings WHERE id = ?', id);

const metadataOf = (database: DatabaseSync, id: string): string =>
  scalarOf(database, 'SELECT metadata AS value FROM holdings WHERE id = ?', id) as string;

const rowAmountOf = (database: DatabaseSync, id: string): unknown =>
  scalarOf(database, 'SELECT amount_minor_units AS value FROM transactions WHERE id = ?', id);

const matchersOf = (database: DatabaseSync, id: string): string =>
  scalarOf(database, 'SELECT matchers AS value FROM category_rules WHERE id = ?', id) as string;

const draftTextOf = (database: DatabaseSync, id: string): string =>
  scalarOf(database, 'SELECT draft AS value FROM transaction_templates WHERE id = ?', id) as string;

const draftValueOf = (database: DatabaseSync, id: string, path: string): unknown =>
  scalarOf(
    database,
    'SELECT json_extract(draft, ?) AS value FROM transaction_templates WHERE id = ?',
    path,
    id,
  );

describe('USDT rescale: holdings and rows', () => {
  it('rescales a USDT holding balance and synced balance', () => {
    const database = databaseBefore();

    insertHolding(database, 'usdt', 'USDT', 12345, null, 12345);
    insertHolding(database, 'unsynced', 'USDT', 7, null, null);
    applyMigration(database);

    expect(balanceOf(database, 'usdt')).toBe(12_345_000_000);
    expect(
      scalarOf(
        database,
        "SELECT synced_balance_minor_units AS value FROM holdings WHERE id = 'usdt'",
      ),
    ).toBe(12_345_000_000);
    expect(
      scalarOf(
        database,
        "SELECT synced_balance_minor_units AS value FROM holdings WHERE id = 'unsynced'",
      ),
    ).toBeNull();
  });

  it('rescales a row on a USDT holding', () => {
    const database = databaseBefore();

    insertHolding(database, 'usdt', 'USDT');
    insertRow(database, 'row', 'usdt', -1);
    applyMigration(database);

    expect(rowAmountOf(database, 'row')).toBe(-1_000_000);
  });

  it('leaves BTC and EUR holdings and their rows', () => {
    const database = databaseBefore();

    insertHolding(database, 'bitcoin', 'BTC', 12345, null, 12345);
    insertHolding(database, 'euro', 'EUR', 700);
    insertRow(database, 'bitcoin-row', 'bitcoin', -5);
    insertRow(database, 'euro-row', 'euro', -6);
    applyMigration(database);

    expect([balanceOf(database, 'bitcoin'), balanceOf(database, 'euro')]).toEqual([12345, 700]);
    expect([rowAmountOf(database, 'bitcoin-row'), rowAmountOf(database, 'euro-row')]).toEqual([
      -5, -6,
    ]);
  });

  it('rescales a value at the bound exactly', () => {
    const database = databaseBefore();

    insertHolding(database, 'usdt', 'USDT', 9_007_199_254);
    applyMigration(database);

    expect(balanceOf(database, 'usdt')).toBe(9_007_199_254_000_000);
  });

  it('leaves price points and rates untouched', () => {
    const database = databaseBefore();

    database.exec(
      `INSERT INTO price_points (instrument, day, price, currency, source)
       VALUES ('holding:usdt', 1, '41.25', 'USDT', 'manual')`,
    );
    database.exec(
      `INSERT INTO currency_rates (base, quote, rate, source, fetched_at)
       VALUES ('USDT', 'UAH', '41.25', 'coingecko', 1)`,
    );
    applyMigration(database);

    expect(scalarOf(database, 'SELECT price AS value FROM price_points')).toBe('41.25');
    expect(scalarOf(database, 'SELECT rate AS value FROM currency_rates')).toBe('41.25');
  });

  it('supports the aggregate ordering the array rebuild relies on', () => {
    const [major, minor] = (
      scalarOf(new DatabaseSync(':memory:'), 'SELECT sqlite_version() AS value') as string
    )
      .split('.')
      .map(Number);

    expect(major === 3 && (minor ?? 0) >= 44).toBe(true);
  });
});

describe('USDT rescale: holding metadata', () => {
  const METADATA = JSON.stringify({
    principalMinorUnits: 100,
    faceValueMinorUnits: 200,
    purchasePriceMinorUnits: 300,
    contributions: [{ amountMinorUnits: 400, date: 1 }],
    lots: [{ day: 1, quantityDelta: '1', costMinorUnits: 500 }],
  });

  it.each([
    ['principalMinorUnits', '$.principalMinorUnits', 100_000_000],
    ['faceValueMinorUnits', '$.faceValueMinorUnits', 200_000_000],
    ['purchasePriceMinorUnits', '$.purchasePriceMinorUnits', 300_000_000],
    ['contributions[].amountMinorUnits', '$.contributions[0].amountMinorUnits', 400_000_000],
    ['lots[].costMinorUnits', '$.lots[0].costMinorUnits', 500_000_000],
  ])('rescales %s of USDT holding metadata', (_field, path, expected) => {
    const database = databaseBefore();

    insertHolding(database, 'usdt', 'USDT', 0, METADATA);
    applyMigration(database);

    expect(
      scalarOf(
        database,
        "SELECT json_extract(metadata, ?) AS value FROM holdings WHERE id = 'usdt'",
        path,
      ),
    ).toBe(expected);
  });

  it('leaves a string or real field and rescales its integer siblings', () => {
    const database = databaseBefore();

    insertHolding(
      database,
      'usdt',
      'USDT',
      0,
      '{"principalMinorUnits":"5000","faceValueMinorUnits":12.5,"purchasePriceMinorUnits":300,' +
        '"lots":[{"costMinorUnits":"5"},{"costMinorUnits":1.5},{"costMinorUnits":7}]}',
    );
    insertTemplate(database, 'template', draftOf({ currency: 'USDT', amountMinorUnits: null }));
    applyMigration(database);

    expect(metadataOf(database, 'usdt')).toBe(
      '{"principalMinorUnits":"5000","faceValueMinorUnits":12.5,' +
        '"purchasePriceMinorUnits":300000000,' +
        '"lots":[{"costMinorUnits":"5"},{"costMinorUnits":1.5},{"costMinorUnits":7000000}]}',
    );
    expect(draftValueOf(database, 'template', '$.amountMinorUnits')).toBeNull();
  });

  it('leaves malformed JSON byte-unchanged and still succeeds', () => {
    const database = databaseBefore();

    insertHolding(database, 'broken', 'USDT', 0, '{bad');
    insertHolding(database, 'valid', 'USDT', 0, '{"principalMinorUnits":5}');
    insertRule(database, 'broken-rule', 'not json');
    insertTemplate(database, 'broken-template', 'also not json');
    applyMigration(database);

    expect(metadataOf(database, 'broken')).toBe('{bad');
    expect(metadataOf(database, 'valid')).toBe('{"principalMinorUnits":5000000}');
    expect(matchersOf(database, 'broken-rule')).toBe('not json');
    expect(draftTextOf(database, 'broken-template')).toBe('also not json');
  });

  it('leaves the bond register untouched', () => {
    const database = databaseBefore();
    const terms = '{ "isin": "UA4000", "faceValueMinorUnits": 100000 }';

    database
      .prepare("INSERT INTO bond_register (isin, terms, fetched_at) VALUES ('UA4000', ?, 1)")
      .run(terms);
    insertHolding(database, 'usdt', 'USDT');
    applyMigration(database);

    expect(scalarOf(database, 'SELECT terms AS value FROM bond_register')).toBe(terms);
  });

  it('leaves a row with no rescaled field byte-identical', () => {
    const database = databaseBefore();
    const untouched = '{ "lots": [ { "costMinorUnits": 5 } ], "note": "x" }';

    insertHolding(database, 'bitcoin', 'BTC', 0, untouched);
    insertHolding(database, 'hryvnia', 'UAH', 0, untouched);
    insertHolding(database, 'usdt', 'USDT', 0, '{ "note": "x" }');
    insertRule(
      database,
      'uah-rule',
      '[ { "type": "amount", "currency": "UAH", "minorUnits": 5 } ]',
    );
    insertTemplate(database, 'uah-template', ' { "currency": "UAH", "amountMinorUnits": 5 } ');
    applyMigration(database);

    expect(metadataOf(database, 'bitcoin')).toBe(untouched);
    expect(metadataOf(database, 'hryvnia')).toBe(untouched);
    expect(metadataOf(database, 'usdt')).toBe('{ "note": "x" }');
    expect(matchersOf(database, 'uah-rule')).toBe(
      '[ { "type": "amount", "currency": "UAH", "minorUnits": 5 } ]',
    );
    expect(draftTextOf(database, 'uah-template')).toBe(
      ' { "currency": "UAH", "amountMinorUnits": 5 } ',
    );
  });
});

describe('USDT rescale: rules and templates', () => {
  it('rescales a USDT amount matcher and keeps the rule matching the same rows', () => {
    const database = databaseBefore();

    insertHolding(database, 'usdt', 'USDT');
    insertRow(database, 'row', 'usdt', 100_000);
    insertRule(
      database,
      'rule',
      '[{"type":"nameIs","text":"coffee"},' +
        '{"type":"amount","operator":"gte","minorUnits":100000,"currency":"USDT"},' +
        '{"type":"amount","operator":"lt","minorUnits":500,"currency":"UAH"},' +
        '{"type":"direction","direction":"expense"}]',
    );
    applyMigration(database);

    expect(matchersOf(database, 'rule')).toBe(
      '[{"type":"nameIs","text":"coffee"},' +
        '{"type":"amount","operator":"gte","minorUnits":100000000000,"currency":"USDT"},' +
        '{"type":"amount","operator":"lt","minorUnits":500,"currency":"UAH"},' +
        '{"type":"direction","direction":"expense"}]',
    );
    expect(rowAmountOf(database, 'row')).toBe(100_000_000_000);
  });

  it('rescales a USDT template amount and its returns', () => {
    const database = databaseBefore();

    insertTemplate(
      database,
      'template',
      draftOf({
        currency: 'USDT',
        amountMinorUnits: 5000,
        returns: [{ holdingId: 'cash', amountMinorUnits: 700 }],
      }),
    );
    applyMigration(database);

    expect(draftValueOf(database, 'template', '$.amountMinorUnits')).toBe(5_000_000_000);
    expect(draftValueOf(database, 'template', '$.returns[0].amountMinorUnits')).toBe(700_000_000);
  });

  it.each([
    ['USDT', 'UAH', 5_000_000_000, 20_500],
    ['UAH', 'USDT', 20_500, 5_000_000_000],
  ])(
    "rescales an exchange template on each side's own currency (%s to %s)",
    (source, destination, expectedAmount, expectedValue) => {
      const database = databaseBefore();
      const [amount, value] = source === 'USDT' ? [5000, 20_500] : [20_500, 5000];

      insertTemplate(
        database,
        'template',
        draftOf({
          mode: 'exchange',
          currency: source,
          amountMinorUnits: amount,
          exchange: {
            destinationHoldingId: 'destination',
            destinationCurrency: destination,
            valueInMinorUnits: value,
          },
        }),
      );
      applyMigration(database);

      expect(draftValueOf(database, 'template', '$.amountMinorUnits')).toBe(expectedAmount);
      expect(draftValueOf(database, 'template', '$.exchange.valueInMinorUnits')).toBe(
        expectedValue,
      );
    },
  );

  it('leaves a UAH template that names a USDT holding', () => {
    const database = databaseBefore();
    const draft = draftOf({
      currency: 'UAH',
      holdingId: 'usdt',
      amountMinorUnits: 500,
      returns: [{ holdingId: 'usdt', amountMinorUnits: 700 }],
    });

    insertHolding(database, 'usdt', 'USDT');
    insertTemplate(database, 'template', draft);
    applyMigration(database);

    expect(draftTextOf(database, 'template')).toBe(draft);
  });
});

type ArrayLocation = {
  name: string;
  // An object element the migration rescales, and the same element after it.
  target: string;
  rescaled: string;
  // An object element that has no field to rescale.
  other: string;
  textOf: (elements: readonly string[]) => string;
  seed: (database: DatabaseSync, text: string) => void;
  read: (database: DatabaseSync) => string;
  pathOf: (index: number) => string;
};

const ARRAY_LOCATIONS: readonly ArrayLocation[] = [
  {
    name: 'lots',
    target: '{"day":1,"quantityDelta":"1","costMinorUnits":5}',
    rescaled: '{"day":1,"quantityDelta":"1","costMinorUnits":5000000}',
    other: '{"day":2,"quantityDelta":"1"}',
    textOf: (elements) => `{"lots":[${elements.join(',')}]}`,
    seed: (database, text) => insertHolding(database, 'usdt', 'USDT', 0, text),
    read: (database) => metadataOf(database, 'usdt'),
    pathOf: (index) => `$.lots[${index}]`,
  },
  {
    name: 'matchers',
    target: '{"type":"amount","operator":"gte","minorUnits":100,"currency":"USDT"}',
    rescaled: '{"type":"amount","operator":"gte","minorUnits":100000000,"currency":"USDT"}',
    other: '{"type":"nameIs","text":"x"}',
    textOf: (elements) => `[${elements.join(',')}]`,
    seed: (database, text) => insertRule(database, 'rule', text),
    read: (database) => matchersOf(database, 'rule'),
    pathOf: (index) => `$[${index}]`,
  },
  {
    name: 'draft returns',
    target: '{"holdingId":null,"amountMinorUnits":700}',
    rescaled: '{"holdingId":null,"amountMinorUnits":700000000}',
    other: '{"holdingId":"a","amountMinorUnits":null}',
    textOf: (elements) =>
      `{"version":1,"mode":"expense","holdingId":null,"currency":"USDT","amountMinorUnits":null,` +
      `"description":"","category":null,"exchange":null,"returns":[${elements.join(',')}]}`,
    seed: (database, text) => insertTemplate(database, 'template', text),
    read: (database) => draftTextOf(database, 'template'),
    pathOf: (index) => `$.returns[${index}]`,
  },
];

const LOCATION_CASES = ARRAY_LOCATIONS.map((location) => [location.name, location] as const);

const migratedArray = (location: ArrayLocation, elements: readonly string[]): string => {
  const database = databaseBefore();

  location.seed(database, location.textOf(elements));
  applyMigration(database);

  return location.read(database);
};

describe('USDT rescale: arrays holding elements that are not objects', () => {
  it.each(LOCATION_CASES)('keeps every other array element as it was in %s', (_name, location) => {
    const elements = ['"text"', 'null', location.other, location.target];

    expect(migratedArray(location, elements)).toBe(
      location.textOf(['"text"', 'null', location.other, location.rescaled]),
    );
  });

  it.each(LOCATION_CASES)('rebuilds an array holding a string element in %s', (_name, location) => {
    expect(migratedArray(location, ['"keep"', location.target])).toBe(
      location.textOf(['"keep"', location.rescaled]),
    );
  });

  it.each(LOCATION_CASES)('keeps a boolean element a boolean in %s', (_name, location) => {
    const database = databaseBefore();

    location.seed(database, location.textOf(['true', 'false', location.target]));
    applyMigration(database);

    const typeAt = (index: number): unknown =>
      scalarOf(
        database,
        'SELECT json_type(?, ?) AS value',
        location.read(database),
        location.pathOf(index),
      );

    expect([typeAt(0), typeAt(1)]).toEqual(['true', 'false']);
  });

  it.each(LOCATION_CASES)('keeps the digits of a bare number element in %s', (_name, location) => {
    const bare = ['0.30000000000000004', '1.50', '1e5', '12345678901234567890'];

    expect(migratedArray(location, [...bare, location.target])).toBe(
      location.textOf([...bare, location.rescaled]),
    );
  });
});
