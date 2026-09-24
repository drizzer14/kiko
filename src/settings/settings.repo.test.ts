// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the update payload.
let mockTransaction: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTransaction),
  };
});

import { database } from '../db/client';
import type { SavedColumnMapping } from '../statement-import/column-mapping';

import { settingsRepo } from './settings.repo';

/**
 * A fake `write`-transaction handle backed by a plain array, standing in for
 * the single `settings` row. `ensure`'s `insert(...).values(...)
 * .onConflictDoNothing()` only appends when no row exists yet (proving
 * idempotency); a setter's `update(...).set(...).where(...)` mutates the row
 * in place. `getQuery` is separately pointed at the same array via a
 * `database.select` spy, so a test can prove a write survives through to a
 * read without a native database.
 */
const makeSettingsRowTransaction = (store: Record<string, unknown>[]): unknown => ({
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

const captureSetTransaction = (): { captured: Captured; transaction: unknown } => {
  const captured: Captured = { whereCalled: false };
  const transaction = {
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

  return { captured, transaction };
};

describe('settingsRepo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a single-row settings query', () => {
    expect(settingsRepo.getQuery().toSQL().sql).toContain('settings');
  });

  it('setDefaultCategoryKey writes the new default category key to the single settings row', async () => {
    const { captured, transaction } = captureSetTransaction();
    mockTransaction = transaction;

    await settingsRepo.setDefaultCategoryKey('groceries');

    expect(captured.set).toEqual({ defaultCategoryKey: 'groceries' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLockEnabled updates the single settings row', async () => {
    const { captured, transaction } = captureSetTransaction();
    mockTransaction = transaction;

    await settingsRepo.setLockEnabled(true);

    expect(captured.set).toEqual({ lockEnabled: true });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLanguage updates the single settings row with the chosen language', async () => {
    const { captured, transaction } = captureSetTransaction();
    mockTransaction = transaction;

    await settingsRepo.setLanguage('uk');

    expect(captured.set).toEqual({ language: 'uk' });
    expect(captured.whereCalled).toBe(true);
  });

  it('ensure inserts the single settings row and is idempotent', async () => {
    const store: Record<string, unknown>[] = [];
    mockTransaction = makeSettingsRowTransaction(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.ensure();

    const rows = await settingsRepo.getQuery();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('setBaseCurrency persists after ensure has run', async () => {
    const store: Record<string, unknown>[] = [];
    mockTransaction = makeSettingsRowTransaction(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.setBaseCurrency('USD');

    expect((await settingsRepo.getQuery())[0].baseCurrency).toBe('USD');
  });

  it('round-trips a saved trend filter and clears it with null', async () => {
    const store: Record<string, unknown>[] = [{ id: 1 }];
    mockTransaction = makeSettingsRowTransaction(store);
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
    mockTransaction = makeSettingsRowTransaction(store);

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
    mockTransaction = makeSettingsRowTransaction(store);

    await settingsRepo.saveStatementMapping('bank:monobank', buildMapping(0));
    const replacement = buildMapping(2);
    await settingsRepo.saveStatementMapping('bank:monobank', replacement);

    expect(store[0].statementMappings).toEqual({ 'bank:monobank': replacement });
  });
});
