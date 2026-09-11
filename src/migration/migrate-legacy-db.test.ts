import type { DB } from '@op-engineering/op-sqlite';

// jest's mock-hoisting guard only allows the module-factory closure below to
// reference variables prefixed with `mock` (case-insensitive). `open` is called
// lazily (inside migrateLegacyDatabase, per test), so the arrow only
// dereferences `mockOpen` at call time — never during factory evaluation.
const mockOpen = jest.fn();

jest.mock('@op-engineering/op-sqlite', () => ({
  open: (params: { name: string }) => mockOpen(params),
}));

import { migrateLegacyDatabase } from './migrate-legacy-db';

type FakeDb = DB & {
  executeSync: jest.Mock;
  getDbPath: jest.Mock;
  close: jest.Mock;
  delete: jest.Mock;
};

/**
 * A fake op-sqlite handle. `tables` is the number the table-count query
 * reports; the VACUUM INTO statement is recognised and returns an empty result
 * so the copy is a no-op in the test.
 */
const makeFakeDb = (name: string, tables: number): FakeDb =>
  ({
    executeSync: jest.fn((sql: string) => {
      if (sql.includes('VACUUM INTO')) {
        return { rows: [], rowsAffected: 0 };
      }
      return { rows: [{ n: tables }], rowsAffected: 0 };
    }),
    getDbPath: jest.fn(() => `/mock/Documents/${name}`),
    close: jest.fn(),
    delete: jest.fn(),
  }) as unknown as FakeDb;

beforeEach(() => {
  mockOpen.mockReset();
});

describe('migrateLegacyDatabase', () => {
  it('returns kiko.db untouched and never opens the legacy db when kiko.db is already populated', () => {
    const kiko = makeFakeDb('kiko.db', 3);
    mockOpen.mockImplementation(({ name }: { name: string }) => {
      if (name === 'pff.db') {
        throw new Error('legacy db must not be opened when kiko.db is populated');
      }
      return kiko;
    });

    const result = migrateLegacyDatabase();

    expect(result).toBe(kiko);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockOpen).toHaveBeenCalledWith({ name: 'kiko.db' });
    expect(kiko.close).not.toHaveBeenCalled();
    expect(kiko.delete).not.toHaveBeenCalled();
  });

  it('copies the populated legacy db into a fresh kiko.db via VACUUM INTO and keeps the legacy backup', () => {
    const kikoInitial = makeFakeDb('kiko.db', 0);
    const kikoReopened = makeFakeDb('kiko.db', 5);
    const legacy = makeFakeDb('pff.db', 5);
    const kikoHandles = [kikoInitial, kikoReopened];
    mockOpen.mockImplementation(({ name }: { name: string }) =>
      name === 'pff.db' ? legacy : kikoHandles.shift(),
    );

    const result = migrateLegacyDatabase();

    // The empty kiko.db is closed and deleted so VACUUM INTO can write it.
    expect(kikoInitial.getDbPath).toHaveBeenCalled();
    expect(kikoInitial.close).toHaveBeenCalled();
    expect(kikoInitial.delete).toHaveBeenCalled();
    // The legacy connection writes a standalone consistent copy to kiko's path.
    expect(legacy.executeSync).toHaveBeenCalledWith("VACUUM INTO '/mock/Documents/kiko.db'");
    // The populated legacy db is left in place as an on-device safety net.
    expect(legacy.close).not.toHaveBeenCalled();
    expect(legacy.delete).not.toHaveBeenCalled();
    // The freshly re-opened kiko.db is what the app uses.
    expect(result).toBe(kikoReopened);
  });

  it('deletes a stray empty legacy db and returns the fresh kiko.db (fresh install)', () => {
    const kiko = makeFakeDb('kiko.db', 0);
    const legacy = makeFakeDb('pff.db', 0);
    mockOpen.mockImplementation(({ name }: { name: string }) =>
      name === 'pff.db' ? legacy : kiko,
    );

    const result = migrateLegacyDatabase();

    expect(legacy.close).toHaveBeenCalled();
    expect(legacy.delete).toHaveBeenCalled();
    // No copy happens and kiko.db is left in place.
    expect(legacy.executeSync).not.toHaveBeenCalledWith(expect.stringContaining('VACUUM INTO'));
    expect(kiko.close).not.toHaveBeenCalled();
    expect(kiko.delete).not.toHaveBeenCalled();
    expect(result).toBe(kiko);
  });
});
