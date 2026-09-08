// The setters run their update through the `write` helper (one op-sqlite
// transaction). Override `write` to run the callback against a fake transaction
// handle so the test can capture the update payload.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { database } from '../db/client';

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
const makeSettingsRowTx = (store: Record<string, unknown>[]): unknown => ({
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
});

const spyOnSettingsSelect = (store: Record<string, unknown>[]): void => {
  // The double implements only the `.from().where()` path this repo calls, not
  // drizzle's full builder, so it cannot overlap the real return type directly.
  jest.spyOn(database, 'select').mockReturnValue({
    from: () => ({ where: async () => store }),
  } as unknown as ReturnType<typeof database.select>);
};

type Captured = { set?: Record<string, unknown>; whereCalled: boolean };

const captureSetTx = (): { captured: Captured; tx: unknown } => {
  const captured: Captured = { whereCalled: false };
  const tx = {
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

  return { captured, tx };
};

describe('settingsRepo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a single-row settings query', () => {
    expect(settingsRepo.getQuery().toSQL().sql).toContain('settings');
  });

  it('setDefaultCategoryKey writes the new default category key to the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setDefaultCategoryKey('groceries');

    expect(captured.set).toEqual({ defaultCategoryKey: 'groceries' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLockEnabled updates the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setLockEnabled(true);

    expect(captured.set).toEqual({ lockEnabled: true });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLanguage updates the single settings row with the chosen language', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setLanguage('uk');

    expect(captured.set).toEqual({ language: 'uk' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setAppearance updates the single settings row with the chosen appearance', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setAppearance('light');

    expect(captured.set).toEqual({ appearance: 'light' });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLastSyncDisplayAt writes the display timestamp to the single settings row', async () => {
    const { captured, tx } = captureSetTx();
    mockTx = tx;

    await settingsRepo.setLastSyncDisplayAt(1_700_000_000_000);

    expect(captured.set).toEqual({ lastSyncDisplayAt: 1_700_000_000_000 });
    expect(captured.whereCalled).toBe(true);
  });

  it('setLastSyncDisplayAt persists after ensure has run', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeSettingsRowTx(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.setLastSyncDisplayAt(1_700_000_000_000);

    expect((await settingsRepo.getQuery())[0].lastSyncDisplayAt).toBe(1_700_000_000_000);
  });

  it('ensure inserts the single settings row and is idempotent', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeSettingsRowTx(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.ensure();

    const rows = await settingsRepo.getQuery();

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(1);
  });

  it('setBaseCurrency persists after ensure has run', async () => {
    const store: Record<string, unknown>[] = [];
    mockTx = makeSettingsRowTx(store);
    spyOnSettingsSelect(store);

    await settingsRepo.ensure();
    await settingsRepo.setBaseCurrency('USD');

    expect((await settingsRepo.getQuery())[0].baseCurrency).toBe('USD');
  });

  it('persists a saved trend selection and clears it with null', async () => {
    const store: Record<string, unknown>[] = [{ id: 1 }];
    mockTx = makeSettingsRowTx(store);
    spyOnSettingsSelect(store);

    await settingsRepo.setTrendCategoryKeys(['groceries', 'transport']);
    expect(store[0].trendCategoryKeys).toEqual(['groceries', 'transport']);

    await settingsRepo.setTrendCategoryKeys(null);
    expect(store[0].trendCategoryKeys).toBeNull();
  });
});
