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

import { settingsRepo } from './settings.repo';

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
});
