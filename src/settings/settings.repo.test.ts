// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the update payload.
let mockDatabaseTransaction: unknown;
// The recurring merchant choices run on a real migrated engine: their stored JSON, a repeated
// key and an absent key are what a fake handle answers by its own rules.
let mockRealDatabase: DatabaseSync;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return {
    ...actual,
    database: executingClient(() => mockRealDatabase).database,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import {
  type RecurringMark,
  type RecurringPeriod,
  RECURRING_PERIODS,
} from '@kiko/recurring/detection';
import { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import type { MarkedEntry } from '@kiko/recurring/marked-series';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { outcomeOf } from '@kiko/test-support/marked-series-world';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';
import { at, nowOf, chargeOf, ledgerOf } from '@kiko/test-support/recurring-ledger';
import { applyAllMigrations, executingDrizzle } from '@kiko/test-support/real-sqlite';

import { isReminderOfferDismissed, settingsRepo } from './settings.repo';
import type { RecurringMerchantChoice } from './recurring-merchant-choices';
import { EMPTY_HISTORY_BACKFILL_STATE, parseHistoryBackfillState } from './history-backfill-state';

/**
 * A fake `write`-transaction handle backed by a plain array, standing in for
 * the single `settings` row. `ensure`'s `insert(...).values(...)
 * .onConflictDoNothing()` only appends when no row exists yet (proving
 * idempotency); a setter's `update(...).set(...).where(...)` mutates the row
 * in place. `getQuery` is separately pointed at the same array via a
 * `database.select` spy, so a test can prove a write survives through to a
 * read without a native database.
 */
const makeSettingsRowDatabaseTransaction = (store: Record<string, unknown>[]): unknown => ({
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: async () => {
        if (!store.some((row) => row.id === values.id)) {
          store.push({ ...values });
        }
      },
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: async () => {
        for (const row of store) {
          Object.assign(row, values);
        }
      },
    }),
  }),
  select: (projection?: Record<string, unknown>) => ({
    from: () => ({
      where: async () =>
        projection === undefined
          ? store
          : store.map((row) =>
              Object.fromEntries(Object.keys(projection).map((key) => [key, row[key]])),
            ),
    }),
  }),
});

const spyOnSettingsSelect = (store: Record<string, unknown>[]): void => {
  // The double implements only the `.from().where()` path this repo calls, not
  // drizzle's full builder, so it cannot overlap the real return type directly.
  jest.spyOn(database, 'select').mockReturnValue({
    from: () => ({ where: async () => store }),
  } as unknown as ReturnType<typeof database.select>);
};

type Captured = { set?: Record<string, unknown>; whereCalled: boolean };

const captureSetDatabaseTransaction = (): { captured: Captured; databaseTransaction: unknown } => {
  const captured: Captured = { whereCalled: false };
  const databaseTransaction = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        captured.set = values;

        return {
          where: () => {
            captured.whereCalled = true;

            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { captured, databaseTransaction };
};

describe('settingsRepo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a single-row settings query', () => {
    expect(settingsRepo.getQuery().toSQL().sql).toContain('settings');
  });

  it('setDefaultCategoryKey writes the new default category key to the single settings row', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await settingsRepo.setDefaultCategoryKey('groceries');

    expect(captured.set).toEqual({ defaultCategoryKey: 'groceries' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLockEnabled updates the single settings row', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await settingsRepo.setLockEnabled(true);

    expect(captured.set).toEqual({ lockEnabled: true });
    expect(captured.whereCalled).toBe(true);
  });

  it('builds a query that reads only the history backfill state of the single settings row', () => {
    const { sql } = settingsRepo.historyBackfillStateQuery().toSQL();

    expect(sql).toContain('history_backfill_state');
    expect(sql).not.toContain('base_currency');
  });

  describe('changeHistoryBackfillState', () => {
    it('writes a cursor and keeps the settled marks already stored', async () => {
      const store: Record<string, unknown>[] = [
        {
          id: 1,
          historyBackfillState: JSON.stringify({
            cursor: null,
            settled: { EUR: { start: 5, firstDay: 6 } },
          }),
        },
      ];
      mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

      await settingsRepo.changeHistoryBackfillState((state) => ({ ...state, cursor: 'XRP' }));

      expect(parseHistoryBackfillState(store[0].historyBackfillState as string)).toEqual({
        cursor: 'XRP',
        settled: { EUR: { start: 5, firstDay: 6 } },
      });
    });

    it('hands the change the empty state when no settings row exists yet', async () => {
      const store: Record<string, unknown>[] = [];
      mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
      const change = jest.fn(() => EMPTY_HISTORY_BACKFILL_STATE);

      await expect(settingsRepo.changeHistoryBackfillState(change)).resolves.toBeUndefined();

      expect(change).toHaveBeenCalledWith({ cursor: null, settled: {} });
    });

    it('clears the column when the change leaves nothing to keep', async () => {
      const store: Record<string, unknown>[] = [{ id: 1, historyBackfillState: 'XRP' }];
      mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

      await settingsRepo.changeHistoryBackfillState(() => EMPTY_HISTORY_BACKFILL_STATE);

      expect(store[0].historyBackfillState).toBeNull();
    });
  });

  describe('recordSettledHistory', () => {
    it('adds marks beside the stored ones and the coin cursor, and replaces a mark it overlaps', async () => {
      const store: Record<string, unknown>[] = [
        {
          id: 1,
          historyBackfillState: JSON.stringify({
            cursor: 'XRP',
            settled: { EUR: { start: 5, firstDay: 6 }, GBP: { start: 5, firstDay: 9 } },
          }),
        },
      ];
      mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

      await settingsRepo.recordSettledHistory({
        EUR: { start: 2, firstDay: 3 },
        USD: { start: 2, firstDay: null },
      });

      expect(parseHistoryBackfillState(store[0].historyBackfillState as string)).toEqual({
        cursor: 'XRP',
        settled: {
          EUR: { start: 2, firstDay: 3 },
          GBP: { start: 5, firstDay: 9 },
          USD: { start: 2, firstDay: null },
        },
      });
    });
  });

  it('setLanguage updates the single settings row with the chosen language', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;

    await settingsRepo.setLanguage('uk');

    expect(captured.set).toEqual({ language: 'uk' });
    expect(captured.whereCalled).toBe(true);
  });

  it('ensure inserts the single settings row and is idempotent', async () => {
    const store: Record<string, unknown>[] = [];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.ensure();

    const rows = await settingsRepo.getQuery();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('setBaseCurrency persists after ensure has run', async () => {
    const store: Record<string, unknown>[] = [];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.setBaseCurrency('USD');

    expect((await settingsRepo.getQuery())[0].baseCurrency).toBe('USD');
  });

  it('round-trips a saved trend filter and clears it with null', async () => {
    const store: Record<string, unknown>[] = [{ id: 1 }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
    spyOnSettingsSelect(store);

    await settingsRepo.setTrendFilter({ mode: 'manual', keys: ['groceries', 'transport'] });
    expect(store[0].trendFilter).toEqual({ mode: 'manual', keys: ['groceries', 'transport'] });

    await settingsRepo.setTrendFilter({ mode: 'top', amount: 4, by: 'rising' });
    expect(store[0].trendFilter).toEqual({ mode: 'top', amount: 4, by: 'rising' });

    await settingsRepo.setTrendFilter(null);
    expect(store[0].trendFilter).toBeNull();
  });

  const buildMapping = (headerRowIndex: number): SavedColumnMapping => ({
    headerRowIndex,
    decimalSeparator: '.',
    dateColumn: 0,
    dateFormat: 'DD.MM.YYYY HH:MM:SS',
    amount: { mode: 'single', column: 2 },
    descriptionColumn: 1,
    currency: { mode: 'fixed', currency: 'UAH' },
    fingerprint: 'Date␟Description␟Amount',
    savedAt: 1_700_000_000_000,
  });

  it('saveStatementMapping keeps both when saving two different keys', async () => {
    const store: Record<string, unknown>[] = [{ id: 1 }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

    const bankMapping = buildMapping(0);
    const otherMapping = buildMapping(1);
    await settingsRepo.saveStatementMapping('bank:monobank', bankMapping);
    await settingsRepo.saveStatementMapping('header:abc123', otherMapping);

    expect(store[0].statementMappings).toEqual({
      'bank:monobank': bankMapping,
      'header:abc123': otherMapping,
    });
  });

  it('saveStatementMapping overwrites an existing key with the same name', async () => {
    const store: Record<string, unknown>[] = [{ id: 1 }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

    await settingsRepo.saveStatementMapping('bank:monobank', buildMapping(0));
    const replacement = buildMapping(2);
    await settingsRepo.saveStatementMapping('bank:monobank', replacement);

    expect(store[0].statementMappings).toEqual({ 'bank:monobank': replacement });
  });

  it('dismissReminderOffer adds the kind for the account and keeps every other dismissal', async () => {
    const store: Record<string, unknown>[] = [
      { id: 1, reminderOfferDismissals: { 'account-1': ['add_transactions'], 'account-2': [] } },
    ];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

    await settingsRepo.dismissReminderOffer('account-1', 'statement_import');
    await settingsRepo.dismissReminderOffer('account-3', 'add_transactions');

    expect(store[0].reminderOfferDismissals).toEqual({
      'account-1': ['add_transactions', 'statement_import'],
      'account-2': [],
      'account-3': ['add_transactions'],
    });
  });

  it('dismissReminderOffer records a kind once, however often it is dismissed', async () => {
    const store: Record<string, unknown>[] = [{ id: 1, reminderOfferDismissals: null }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);

    await settingsRepo.dismissReminderOffer('account-1', 'statement_import');
    await settingsRepo.dismissReminderOffer('account-1', 'statement_import');

    expect(store[0].reminderOfferDismissals).toEqual({ 'account-1': ['statement_import'] });
  });
});

describe('isReminderOfferDismissed', () => {
  it('is false while nothing was ever dismissed', () => {
    expect(
      isReminderOfferDismissed({ reminderOfferDismissals: null }, 'account-1', 'statement_import'),
    ).toBe(false);
  });

  it('is true only for the dismissed kind on the dismissed account', () => {
    const settingsRow = { reminderOfferDismissals: { 'account-1': ['statement_import' as const] } };

    expect(isReminderOfferDismissed(settingsRow, 'account-1', 'statement_import')).toBe(true);
    expect(isReminderOfferDismissed(settingsRow, 'account-1', 'add_transactions')).toBe(false);
    expect(isReminderOfferDismissed(settingsRow, 'account-2', 'statement_import')).toBe(false);
  });
});

const hide = (key: string, name: string) => settingsRepo.hideRecurringMerchant(key, name);

const showAgain = (key: string) => settingsRepo.showRecurringMerchantAgain(key);

const COLUMN = 'recurring_merchant_choices';

const writeCounts = { count: 0 };

const countingHandle = (engine: DatabaseSync): unknown => {
  const handle = executingDrizzle<typeof database>(engine);

  return new Proxy(handle, {
    get: (target, property) => {
      const member = Reflect.get(target, property) as unknown;

      if (property === 'update' || property === 'insert' || property === 'delete') {
        writeCounts.count += 1;
      }

      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
};

const storeRawChoices = (stored: string): void => {
  mockRealDatabase.prepare(`UPDATE settings SET ${COLUMN} = ? WHERE id = 1`).run(stored);
};

const storedText = (): string | null =>
  (
    mockRealDatabase.prepare(`SELECT ${COLUMN} AS stored FROM settings WHERE id = 1`).get() as {
      stored: string | null;
    }
  ).stored;

const storedEntries = (): Map<string, unknown> =>
  new Map(Object.entries(JSON.parse(storedText() ?? '{}') as object));

const readChoices = async (): Promise<ReadonlyMap<string, RecurringMerchantChoice>> => {
  const rows = await settingsRepo.recurringMerchantChoicesQuery();

  return settingsRepo.recurringMerchantChoicesOf(rows[0]?.recurringMerchantChoices);
};

const transactionsFingerprint = (): { count: number; checksum: string } => {
  const rows = mockRealDatabase.prepare('SELECT * FROM transactions ORDER BY id').all();

  return { count: rows.length, checksum: JSON.stringify(rows) };
};

type StoredChoice = { name: string; hidden?: true; marks?: readonly RecurringMark[] };

type MarkWriters = {
  markRecurringCharge: (key: string, name: string, mark: RecurringMark) => Promise<void>;
  setRecurringChainPeriod: (
    key: string,
    marks: readonly RecurringMark[],
    period: RecurringPeriod,
  ) => Promise<void>;
  removeRecurringMarks: (key: string, marks: readonly RecurringMark[]) => Promise<void>;
};

const writerOf = <Name extends keyof MarkWriters>(name: Name): MarkWriters[Name] =>
  Reflect.get(settingsRepo, name) as MarkWriters[Name];

const mark = (key: string, name: string, stored: RecurringMark) =>
  writerOf('markRecurringCharge')(key, name, stored);

const setPeriod = (key: string, marks: readonly RecurringMark[], period: RecurringPeriod) =>
  writerOf('setRecurringChainPeriod')(key, marks, period);

const unmark = (key: string, marks: readonly RecurringMark[]) =>
  writerOf('removeRecurringMarks')(key, marks);

const markOf = (
  amountMinorUnits: number,
  period: RecurringPeriod = 'monthly',
  currency: RecurringMark['currency'] = 'UAH',
): RecurringMark => ({ currency, amountMinorUnits, period });

const readStoredChoices = async (): Promise<ReadonlyMap<string, StoredChoice>> => readChoices();

const storeEntries = (entries: object): void => storeRawChoices(JSON.stringify(entries));

const markedEntriesOf = (choices: ReadonlyMap<string, StoredChoice>): MarkedEntry[] =>
  [...choices].flatMap(([key, { name, marks = [] }]) =>
    marks.length > 0 ? [{ key, name, marks }] : [],
  );

const markedSeriesUnder = async (description: string) => {
  const ledger = ledgerOf([chargeOf('charge-1', at(2026, 10, 15), 250, { description })]);

  return outcomeOf(ledger, markedEntriesOf(await readStoredChoices()), nowOf()).marked;
};

const GOOD_MARK = markOf(9_900);
const OTHER_GOOD_MARK = markOf(40_000, 'yearly');

describe('settingsRepo recurring merchant choices, on a real database', () => {
  beforeEach(async () => {
    mockRealDatabase = new DatabaseSync(':memory:');
    applyAllMigrations(mockRealDatabase);
    mockRealDatabase.exec(`
      INSERT INTO accounts (id, name, kind) VALUES ('own', 'Manual', 'bank');
      INSERT INTO holdings (id, account_id, name, type, currency, balance_minor_units)
        VALUES ('wallet', 'own', 'Wallet', 'cash', 'UAH', 0);
      INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, source)
        VALUES ('first', 'wallet', -29900, 1700000000000, 'Netflix', 'manual'),
               ('second', 'wallet', -5000, 1700000100000, 'ATB', 'manual');
    `);
    mockDatabaseTransaction = countingHandle(mockRealDatabase);
    await settingsRepo.ensure();
    writeCounts.count = 0;
  });

  it('stores a hide as the merchant name and a hidden flag', async () => {
    await hide('atb', 'ATB');

    expect(storedEntries()).toEqual(new Map([['atb', { name: 'ATB', hidden: true }]]));
    expect(await readChoices()).toEqual(new Map([['atb', { name: 'ATB', hidden: true }]]));
  });

  it('keeps the first merchant when a second is hidden', async () => {
    await hide('atb', 'ATB');
    await hide('silpo', 'Silpo');

    expect(await readChoices()).toEqual(
      new Map([
        ['atb', { name: 'ATB', hidden: true }],
        ['silpo', { name: 'Silpo', hidden: true }],
      ]),
    );
  });

  it('holds one entry with the last name when a merchant is hidden twice', async () => {
    await hide('atb', 'ATB');
    await hide('atb', 'Atb Market');

    expect(storedEntries()).toEqual(new Map([['atb', { name: 'Atb Market', hidden: true }]]));
  });

  it('removes one entry on show again and keeps the others', async () => {
    await hide('atb', 'ATB');
    await hide('silpo', 'Silpo');

    await showAgain('atb');

    expect(await readChoices()).toEqual(new Map([['silpo', { name: 'Silpo', hidden: true }]]));
  });

  it('writes nothing when show again names a key that is not stored', async () => {
    await hide('atb', 'ATB');
    writeCounts.count = 0;

    await showAgain('unknown');

    expect(writeCounts.count).toBe(0);
    expect(await readChoices()).toEqual(new Map([['atb', { name: 'ATB', hidden: true }]]));
  });

  it('writes when show again names a stored key', async () => {
    await hide('atb', 'ATB');
    writeCounts.count = 0;

    await showAgain('atb');

    expect(writeCounts.count).toBeGreaterThan(0);
  });

  it('touches no transactions row on a hide or a show again', async () => {
    const before = transactionsFingerprint();

    await hide('atb', 'ATB');
    await showAgain('atb');
    await hide('silpo', 'Silpo');

    expect(before.count).toBe(2);
    expect(transactionsFingerprint()).toEqual(before);
  });

  it('reads a changed transactions row as a different fingerprint', () => {
    const before = transactionsFingerprint();

    mockRealDatabase.exec("UPDATE transactions SET description = 'Changed' WHERE id = 'first'");

    expect(transactionsFingerprint().checksum).not.toBe(before.checksum);
  });

  it.each([
    ['an array', '[{"name":"ATB","hidden":true}]'],
    ['a number', '7'],
    ['a string', '"atb"'],
  ])('reads %s as no choice and replaces it on the next hide', async (_title, stored) => {
    storeRawChoices(stored);

    expect(await readChoices()).toEqual(new Map());

    await hide('atb', 'ATB');

    expect(storedEntries()).toEqual(new Map([['atb', { name: 'ATB', hidden: true }]]));
  });

  it.each([
    ['a name that is not a string', { name: 7, hidden: true }],
    ['a hidden flag of false', { name: 'Bad', hidden: false }],
    ['a hidden flag that is a string', { name: 'Bad', hidden: 'true' }],
    ['no hidden flag', { name: 'Bad' }],
    ['no name', { hidden: true }],
    ['a null entry', null],
    ['a string entry', 'Bad'],
  ])('drops an entry with %s alone beside a good one', async (_title, bad) => {
    storeRawChoices(JSON.stringify({ good: { name: 'ATB', hidden: true }, bad }));

    const choices = await readChoices();

    expect(choices.get('good')).toEqual({ name: 'ATB', hidden: true });
    expect(choices.has('bad')).toBe(false);

    await hide('silpo', 'Silpo');

    expect(storedEntries()).toEqual(
      new Map([
        ['good', { name: 'ATB', hidden: true }],
        ['silpo', { name: 'Silpo', hidden: true }],
      ]),
    );
  });

  it('reads a key that names an object property as absent while nothing is stored', async () => {
    expect((await readChoices()).has('constructor')).toBe(false);
    expect((await readChoices()).has('__proto__')).toBe(false);
  });

  it('reads constructor and __proto__ back beside a plain key and keeps all on the next write', async () => {
    await hide('atb', 'ATB');
    await hide('constructor', 'Constructor Shop');
    await hide('__proto__', 'Proto Shop');

    const choices = await readChoices();

    expect(choices.has('constructor')).toBe(true);
    expect(choices.get('constructor')).toEqual({ name: 'Constructor Shop', hidden: true });
    expect(choices.get('__proto__')).toEqual({ name: 'Proto Shop', hidden: true });
    expect(choices.get('atb')).toEqual({ name: 'ATB', hidden: true });
    expect(choices.size).toBe(3);

    await hide('silpo', 'Silpo');

    const afterWrite = await readChoices();

    expect([...afterWrite.keys()].sort()).toEqual(['__proto__', 'atb', 'constructor', 'silpo']);
    expect(afterWrite.get('__proto__')).toEqual({ name: 'Proto Shop', hidden: true });
  });

  describe('marks', () => {
    const APPLE_99 = markOf(9_900);
    const APPLE_399 = markOf(39_900);

    it('stores a mark as the name and one mark with its currency, amount and period', async () => {
      await mark('apple', 'Apple', APPLE_99);

      const expected = new Map([['apple', { name: 'Apple', marks: [APPLE_99] }]]);

      expect(storedEntries()).toEqual(expected);
      expect(await readStoredChoices()).toEqual(expected);
    });

    it('keeps the hide beside the mark when a hidden key is marked, in one entry', async () => {
      await hide('apple', 'Apple');
      await mark('apple', 'Apple', APPLE_99);

      expect(storedEntries()).toEqual(
        new Map([['apple', { name: 'Apple', hidden: true, marks: [APPLE_99] }]]),
      );
    });

    it('keeps the marks beside the hide when a marked key is hidden, in one entry', async () => {
      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple', APPLE_399);
      await hide('apple', 'Apple');

      expect(storedEntries()).toEqual(
        new Map([['apple', { name: 'Apple', hidden: true, marks: [APPLE_99, APPLE_399] }]]),
      );
    });

    it('takes the spelling of the last write on a mark and on a hide', async () => {
      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple Store', APPLE_399);

      expect(storedEntries().get('apple')).toEqual({
        name: 'Apple Store',
        marks: [APPLE_99, APPLE_399],
      });

      await hide('apple', 'APPLE');

      expect(storedEntries().get('apple')).toEqual({
        name: 'APPLE',
        hidden: true,
        marks: [APPLE_99, APPLE_399],
      });
    });

    it('holds one entry for the key at every step of mark, remove and hide', async () => {
      await mark('apple', 'Apple', APPLE_99);

      expect(storedEntries().size).toBe(1);

      await unmark('apple', [APPLE_99]);

      expect(storedEntries().size).toBe(0);

      await hide('apple', 'Apple');

      expect(storedEntries()).toEqual(new Map([['apple', { name: 'Apple', hidden: true }]]));
    });

    it('adds a mark at another amount beside the first', async () => {
      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple', APPLE_399);

      expect(storedEntries().get('apple')).toEqual({
        name: 'Apple',
        marks: [APPLE_99, APPLE_399],
      });
    });

    it('adds a mark at the same amount in another currency beside the first', async () => {
      const apple99Dollars = markOf(9_900, 'monthly', 'USD');

      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple', apple99Dollars);

      expect(storedEntries().get('apple')).toEqual({
        name: 'Apple',
        marks: [APPLE_99, apple99Dollars],
      });
    });

    it('gives the new period to a mark of the same currency and amount', async () => {
      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple', APPLE_399);
      await mark('apple', 'Apple', markOf(9_900, 'yearly'));

      expect(storedEntries().get('apple')).toEqual({
        name: 'Apple',
        marks: [markOf(9_900, 'yearly'), APPLE_399],
      });
    });

    describe('setRecurringChainPeriod', () => {
      it('rewrites the period of exactly those marks and moves no amount', async () => {
        await mark('apple', 'Apple', markOf(10_000));
        await mark('apple', 'Apple', markOf(20_000));
        await mark('apple', 'Apple', markOf(30_000));

        await setPeriod('apple', [markOf(10_000), markOf(30_000)], 'yearly');

        expect(storedEntries().get('apple')).toEqual({
          name: 'Apple',
          marks: [markOf(10_000, 'yearly'), markOf(20_000), markOf(30_000, 'yearly')],
        });
      });

      it('rewrites the period of the stored 100 and adds no mark at 144', async () => {
        await mark('apple', 'Apple', markOf(10_000));

        await setPeriod('apple', [markOf(10_000)], 'yearly');

        expect(storedEntries().get('apple')).toEqual({
          name: 'Apple',
          marks: [markOf(10_000, 'yearly')],
        });
      });

      it('keeps the hide', async () => {
        await hide('apple', 'Apple');
        await mark('apple', 'Apple', APPLE_99);

        await setPeriod('apple', [APPLE_99], 'weekly');

        expect(storedEntries().get('apple')).toEqual({
          name: 'Apple',
          hidden: true,
          marks: [markOf(9_900, 'weekly')],
        });
      });

      it.each([
        ['an absent entry', async () => undefined],
        ['a hide-only entry', () => hide('apple', 'Apple')],
        ['marks at another amount', () => mark('apple', 'Apple', APPLE_399)],
        [
          'marks in another currency',
          () => mark('apple', 'Apple', markOf(9_900, 'monthly', 'USD')),
        ],
      ])('writes nothing on %s', async (_title, seed) => {
        await seed();
        const before = storedText();
        writeCounts.count = 0;

        await setPeriod('apple', [APPLE_99], 'yearly');

        expect(writeCounts.count).toBe(0);
        expect(storedText()).toBe(before);
      });
    });

    describe('removeRecurringMarks', () => {
      it('clears only those marks and keeps the others and the hide', async () => {
        await hide('apple', 'Apple');
        await mark('apple', 'Apple', APPLE_99);
        await mark('apple', 'Apple', APPLE_399);

        await unmark('apple', [APPLE_99]);

        expect(storedEntries().get('apple')).toEqual({
          name: 'Apple',
          hidden: true,
          marks: [APPLE_399],
        });
      });

      it('leaves no entry when the last mark of a marks-only entry goes', async () => {
        await mark('apple', 'Apple', APPLE_99);
        await mark('apple', 'Apple', APPLE_399);

        await unmark('apple', [APPLE_99, APPLE_399]);

        expect(storedEntries()).toEqual(new Map());
      });

      it('leaves the hide alone when the last mark of a hidden entry goes', async () => {
        await hide('apple', 'Apple');
        await mark('apple', 'Apple', APPLE_99);

        await unmark('apple', [APPLE_99]);

        expect(storedEntries()).toStrictEqual(
          new Map([['apple', { name: 'Apple', hidden: true }]]),
        );
      });

      it.each([
        ['an absent entry', async () => undefined],
        ['a hide-only entry', () => hide('apple', 'Apple')],
        ['marks at another amount', () => mark('apple', 'Apple', APPLE_399)],
        [
          'marks in another currency',
          () => mark('apple', 'Apple', markOf(9_900, 'monthly', 'USD')),
        ],
      ])('writes nothing on %s', async (_title, seed) => {
        await seed();
        const before = storedText();
        writeCounts.count = 0;

        await unmark('apple', [APPLE_99]);

        expect(writeCounts.count).toBe(0);
        expect(storedText()).toBe(before);
      });

      it('writes nothing when the same marks are removed a second time', async () => {
        await mark('apple', 'Apple', APPLE_99);
        await mark('apple', 'Apple', APPLE_399);
        await unmark('apple', [APPLE_99]);
        const before = storedText();
        writeCounts.count = 0;

        await unmark('apple', [APPLE_99]);

        expect(writeCounts.count).toBe(0);
        expect(storedText()).toBe(before);
      });
    });

    describe('showRecurringMerchantAgain', () => {
      it('clears the hide and keeps the marks of an entry holding both', async () => {
        storeEntries({ apple: { name: 'Apple', hidden: true, marks: [APPLE_99] } });

        await showAgain('apple');

        expect(storedEntries()).toEqual(new Map([['apple', { name: 'Apple', marks: [APPLE_99] }]]));
      });

      it('leaves no entry for a hide-only entry', async () => {
        await hide('apple', 'Apple');

        await showAgain('apple');

        expect(storedEntries()).toEqual(new Map());
      });

      it('writes nothing on a marks-only entry', async () => {
        storeEntries({ apple: { name: 'Apple', marks: [APPLE_99] } });
        const before = storedText();
        writeCounts.count = 0;

        await showAgain('apple');

        expect(writeCounts.count).toBe(0);
        expect(storedText()).toBe(before);
      });

      it('leaves no entry after hide, mark, remove and show again', async () => {
        await hide('apple', 'Apple');
        await mark('apple', 'Apple', APPLE_99);
        await unmark('apple', [APPLE_99]);

        expect(storedEntries().get('apple')).toStrictEqual({ name: 'Apple', hidden: true });

        await showAgain('apple');

        expect(storedEntries()).toEqual(new Map());
      });

      it('gives the 399 back beside the marked 99 after a hide and a show again', async () => {
        await mark('apple', 'Apple', APPLE_99);
        await hide('apple', 'Apple');
        await showAgain('apple');

        expect(storedEntries()).toEqual(new Map([['apple', { name: 'Apple', marks: [APPLE_99] }]]));
      });
    });

    it('changes no transactions row on a mark, a period, a removal, a hide or a show', async () => {
      const before = transactionsFingerprint();

      await mark('apple', 'Apple', APPLE_99);
      await mark('apple', 'Apple', APPLE_399);
      await setPeriod('apple', [APPLE_99], 'yearly');
      await hide('apple', 'Apple');
      await unmark('apple', [APPLE_399]);
      await showAgain('apple');
      await unmark('apple', [markOf(9_900, 'yearly')]);

      expect(before.count).toBe(2);
      expect(transactionsFingerprint()).toEqual(before);
    });
  });

  describe('marks under a key that is user text', () => {
    const PROTO_KEY = merchantNameOf('__proto__').key;
    const CONSTRUCTOR_KEY = merchantNameOf('constructor').key;

    it('names the lookalike keys as they are', () => {
      expect([PROTO_KEY, CONSTRUCTOR_KEY]).toEqual(['__proto__', 'constructor']);
    });

    it('reads a __proto__ charge as one marked series only once it is marked and reloaded', async () => {
      expect(await markedSeriesUnder('__proto__')).toEqual([]);

      await mark(PROTO_KEY, '__proto__', markOf(25_000));
      await mark('plain', 'Plain', markOf(10_000));

      const [series, ...rest] = await markedSeriesUnder('__proto__');

      expect(rest).toEqual([]);
      expect(series.merchantKey).toBe(PROTO_KEY);
      expect(series.chargeIds).toEqual(['charge-1']);
      expect(series.period).toBe('monthly');
    });

    it('reads a constructor charge as unmarked with no entry and as marked beside its twin', async () => {
      expect(await markedSeriesUnder('constructor')).toEqual([]);

      await unmark(CONSTRUCTOR_KEY, [markOf(25_000)]);
      await setPeriod(CONSTRUCTOR_KEY, [markOf(25_000)], 'yearly');
      await showAgain(CONSTRUCTOR_KEY);

      expect(writeCounts.count).toBe(0);
      expect(await markedSeriesUnder('constructor')).toEqual([]);

      await mark(CONSTRUCTOR_KEY, 'constructor', markOf(25_000));

      const series = await markedSeriesUnder('constructor');

      expect(series.map(({ chargeIds }) => chargeIds)).toEqual([['charge-1']]);
    });
  });

  describe('the parser of the marks', () => {
    const BAD_MARKS: [string, unknown][] = [
      ['an unknown period', { ...OTHER_GOOD_MARK, period: 'daily' }],
      ['an unknown currency', { ...OTHER_GOOD_MARK, currency: 'XXX' }],
      ['a currency that is not text', { ...OTHER_GOOD_MARK, currency: 7 }],
      ['no period', { currency: 'UAH', amountMinorUnits: 40_000 }],
      ['no amount', { currency: 'UAH', period: 'yearly' }],
      ['an amount that is a string', { ...OTHER_GOOD_MARK, amountMinorUnits: '40000' }],
      ['an amount that is a fraction', { ...OTHER_GOOD_MARK, amountMinorUnits: 400.5 }],
      ['an amount of zero', { ...OTHER_GOOD_MARK, amountMinorUnits: 0 }],
      ['a negative amount', { ...OTHER_GOOD_MARK, amountMinorUnits: -40_000 }],
      [
        'an amount past the safe integers',
        { ...OTHER_GOOD_MARK, amountMinorUnits: Number.MAX_SAFE_INTEGER + 1 },
      ],
      ['a null mark', null],
      ['a text mark', 'yearly'],
    ];

    it.each(BAD_MARKS)('drops a mark with %s alone beside a good mark', async (_title, bad) => {
      storeEntries({ apple: { name: 'Apple', marks: [bad, GOOD_MARK] } });

      expect((await readStoredChoices()).get('apple')).toEqual({
        name: 'Apple',
        marks: [GOOD_MARK],
      });

      await hide('silpo', 'Silpo');

      expect(storedEntries().get('apple')).toEqual({ name: 'Apple', marks: [GOOD_MARK] });
    });

    it.each([
      ['one minor unit', 1],
      ['the largest safe integer', Number.MAX_SAFE_INTEGER],
    ])('keeps a mark of %s', async (_title, amountMinorUnits) => {
      const edge = markOf(amountMinorUnits);

      storeEntries({ apple: { name: 'Apple', marks: [edge] } });

      expect((await readStoredChoices()).get('apple')).toEqual({ name: 'Apple', marks: [edge] });
    });

    it.each([
      ['no marks', undefined],
      ['marks that are not an array', 'monthly'],
      ['marks that are an object', { 0: GOOD_MARK }],
      ['marks that are null', null],
      ['marks that are empty', []],
      ['marks that are all bad', [{ ...GOOD_MARK, period: 'daily' }, null]],
    ])('drops an entry with %s unless it holds a hide', async (_title, marks) => {
      storeEntries({
        bare: { name: 'Bare', marks },
        hidden: { name: 'Hidden', hidden: true, marks },
        good: { name: 'Good', marks: [GOOD_MARK] },
      });

      const choices = await readStoredChoices();

      expect(choices.has('bare')).toBe(false);
      expect(choices.get('hidden')).toStrictEqual({ name: 'Hidden', hidden: true });
      expect(choices.get('good')).toEqual({ name: 'Good', marks: [GOOD_MARK] });
    });

    it('reads a hidden flag that is not true as no hide beside good marks', async () => {
      storeEntries({ apple: { name: 'Apple', hidden: false, marks: [GOOD_MARK] } });

      expect((await readStoredChoices()).get('apple')).toStrictEqual({
        name: 'Apple',
        marks: [GOOD_MARK],
      });
    });

    it('drops an entry whose name is not text even beside good marks', async () => {
      storeEntries({ apple: { name: 7, marks: [GOOD_MARK] } });

      expect((await readStoredChoices()).has('apple')).toBe(false);
    });

    const PERIOD_PAIRS = RECURRING_PERIODS.flatMap((earlier, index) =>
      RECURRING_PERIODS.slice(index + 1).map((later) => [earlier, later] as const),
    );

    it.each(
      PERIOD_PAIRS.flatMap(([earlier, later]) => [
        [earlier, later, false],
        [earlier, later, true],
      ]),
    )(
      'reads two marks of one currency and amount as the earlier of %s and %s (reversed: %s)',
      async (earlier, later, isReversed) => {
        const stored = [markOf(9_900, later), markOf(9_900, earlier)];

        storeEntries({ apple: { name: 'Apple', marks: isReversed ? stored.reverse() : stored } });

        expect((await readStoredChoices()).get('apple')?.marks).toEqual([markOf(9_900, earlier)]);
      },
    );

    it('keeps two marks of one amount in two currencies', async () => {
      const dollars = markOf(9_900, 'monthly', 'USD');

      storeEntries({ apple: { name: 'Apple', marks: [dollars, GOOD_MARK] } });

      expect((await readStoredChoices()).get('apple')?.marks).toEqual([GOOD_MARK, dollars]);
    });

    const SORTED_MARKS = [
      markOf(10_000, 'monthly', 'UAH'),
      markOf(10_000, 'yearly', 'USD'),
      markOf(20_000, 'monthly', 'UAH'),
      markOf(20_000, 'monthly', 'USD'),
      markOf(30_000, 'weekly', 'UAH'),
    ];

    it.each([
      ['reversed', [4, 3, 2, 1, 0]],
      ['shuffled', [2, 0, 4, 1, 3]],
      ['rotated', [1, 3, 0, 4, 2]],
    ])(
      'reads marks stored %s by amount, then period order, then currency',
      async (_title, order) => {
        storeEntries({
          apple: { name: 'Apple', marks: order.map((index) => SORTED_MARKS[index]) },
        });

        expect((await readStoredChoices()).get('apple')?.marks).toEqual(SORTED_MARKS);
      },
    );
  });
});
