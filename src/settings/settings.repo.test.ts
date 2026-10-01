// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the update payload.
let mockDatabaseTransaction: unknown;
jest.mock('@kiko/db/client', () => {
  const actual = jest.requireActual('@kiko/db/client');

  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import { database } from '@kiko/db';
import type { SavedColumnMapping } from '@kiko/statement-import/column-mapping';

import { isReminderOfferDismissed, settingsRepo } from './settings.repo';

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
  select: () => ({
    from: () => ({
      where: async () => store,
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

  it('builds a quote quota query that reads only the quota column of the single row', () => {
    const { sql, params } = settingsRepo.quoteQuotaQuery().toSQL();

    expect(sql).toContain('"quote_quota"');
    expect(sql).not.toContain('"base_currency"');
    expect(params).toEqual([1]);
  });

  it('setQuoteQuota writes the whole quota to the single settings row', async () => {
    const { captured, databaseTransaction } = captureSetDatabaseTransaction();
    mockDatabaseTransaction = databaseTransaction;
    const quota = { day: 86_400_000, calls: 3, dailyLimit: 20, symbols: ['AAPL.US'] };

    await settingsRepo.setQuoteQuota(quota);

    expect(captured.set).toEqual({ quoteQuota: quota });
    expect(captured.whereCalled).toBe(true);
  });

  it('updateQuoteQuota builds the new quota from the stored one, in one write', async () => {
    const stored = { day: 86_400_000, calls: 3, dailyLimit: 20, symbols: ['AAPL.US'] };
    const store: Record<string, unknown>[] = [{ id: 1, quoteQuota: stored }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
    const build = jest.fn((quota: unknown) => ({ ...(quota as object), dailyLimit: 100 }));

    await settingsRepo.updateQuoteQuota(build as never);

    expect(build).toHaveBeenCalledWith(stored);
    expect(store[0].quoteQuota).toEqual({ ...stored, dailyLimit: 100 });
  });

  it('updateQuoteQuota hands a never-stored quota over as null', async () => {
    const store: Record<string, unknown>[] = [{ id: 1, quoteQuota: null }];
    mockDatabaseTransaction = makeSettingsRowDatabaseTransaction(store);
    const build = jest.fn(() => ({ day: 0, calls: 0, dailyLimit: 20, symbols: [] }));

    await settingsRepo.updateQuoteQuota(build);

    expect(build).toHaveBeenCalledWith(null);
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
