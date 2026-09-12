import {
  accounts,
  categoryOverrides,
  currencyRateHistory,
  currencyRates,
  holdings,
  syncState,
  transactions,
} from '../../db/schema';

// The seed's purge runs `write(work)` and issues `tx.delete(table)` per table in
// foreign-key order. Run the work against a fake transaction that records which
// schema table each delete targeted, so the ORDER (children before parents) is
// assertable without a live database. Jest only lets a `jest.mock` factory close
// over variables whose names start with `mock`, hence the prefixes below.
const mockDeletedTables: unknown[] = [];
const mockFakeTx = {
  delete: (table: unknown) => {
    mockDeletedTables.push(table);

    return Promise.resolve();
  },
};

jest.mock('../../db/client', () => ({
  write: (work: (tx: unknown) => Promise<unknown>) => work(mockFakeTx),
}));

const mockAccountCreate = jest.fn(async (_input: unknown) => 'account-id');
const mockHoldingCreate = jest.fn(async (_input: unknown) => 'holding-id');
const mockRecordManual = jest.fn(async (_input: unknown) => undefined);
const mockRatesUpsertMany = jest.fn(async (_rows: unknown) => undefined);
const mockHistoryUpsertMany = jest.fn(async (_rows: unknown) => undefined);
const mockSetBaseCurrency = jest.fn(async (_currency: unknown) => undefined);
const mockSetLanguage = jest.fn(async (_language: unknown) => undefined);
const mockSetLockEnabled = jest.fn(async (_enabled: unknown) => undefined);

jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { create: (input: unknown) => mockAccountCreate(input) },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { create: (input: unknown) => mockHoldingCreate(input) },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: { recordManual: (input: unknown) => mockRecordManual(input) },
}));
jest.mock('@kiko/rates/repo', () => ({
  ratesRepo: { upsertMany: (rows: unknown) => mockRatesUpsertMany(rows) },
}));
jest.mock('@kiko/rates/rate-history-repo', () => ({
  rateHistoryRepo: { upsertMany: (rows: unknown) => mockHistoryUpsertMany(rows) },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    setBaseCurrency: (currency: unknown) => mockSetBaseCurrency(currency),
    setLanguage: (language: unknown) => mockSetLanguage(language),
    setLockEnabled: (enabled: unknown) => mockSetLockEnabled(enabled),
  },
}));

import { seedScreenshotData } from './screenshot-seed';

describe('seedScreenshotData (writer wiring)', () => {
  beforeEach(async () => {
    mockDeletedTables.length = 0;
    jest.clearAllMocks();
    await seedScreenshotData();
  });

  it('purges every owned table in foreign-key order, keeping categories/settings', () => {
    // Children (transactions, sync_state) before their parents (holdings then
    // accounts); the rate + override tables have no FK and follow.
    expect(mockDeletedTables).toEqual([
      transactions,
      syncState,
      holdings,
      accounts,
      currencyRates,
      currencyRateHistory,
      categoryOverrides,
    ]);
  });

  it('applies base currency UAH, the seed language, and lock-off defensively', () => {
    expect(mockSetBaseCurrency).toHaveBeenCalledWith('UAH');
    // ENVFILE is unset under Jest, so screenshotLanguage() defaults to 'en'.
    expect(mockSetLanguage).toHaveBeenCalledWith('en');
    expect(mockSetLockEnabled).toHaveBeenCalledWith(false);
  });

  it('creates one account per seeded account and one holding per holding', () => {
    expect(mockAccountCreate).toHaveBeenCalledTimes(5);
    expect(mockHoldingCreate).toHaveBeenCalledTimes(5);
  });

  it('records every seeded transaction with a fixed time and no institution on any account', () => {
    expect(mockRecordManual.mock.calls.length).toBeGreaterThan(40);

    for (const [input] of mockAccountCreate.mock.calls) {
      expect((input as { institution?: unknown }).institution).toBeUndefined();
    }

    for (const [input] of mockRecordManual.mock.calls) {
      const { time } = input as { time: number };

      expect(Number.isFinite(time)).toBe(true);
      expect(time).toBeLessThan(Date.UTC(2026, 8, 10, 9, 0, 0));
    }
  });

  it('pins the live rate table (12 pairs) and the rate history', () => {
    expect(mockRatesUpsertMany).toHaveBeenCalledTimes(1);
    expect(mockHistoryUpsertMany).toHaveBeenCalledTimes(1);
    expect((mockRatesUpsertMany.mock.calls[0][0] as unknown[]).length).toBe(12);
    expect((mockHistoryUpsertMany.mock.calls[0][0] as unknown[]).length).toBe(3 * 27);
  });
});
