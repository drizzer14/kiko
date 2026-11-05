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

import { database } from '@kiko/db';
import { DatabaseSync } from 'node:sqlite';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';
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
});
