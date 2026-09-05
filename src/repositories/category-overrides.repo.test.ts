// `upsertCategoryOverride` runs its rule upsert AND its transaction rewrite
// through the `write` helper (one op-sqlite transaction). Override `write` to
// run the callback against a fake transaction handle so the test can capture
// both the rule payload and the id-filtered category update issued inside that
// single transaction.
let mockTx: unknown;
jest.mock('../db/client', () => {
  const actual = jest.requireActual('../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockTx),
  };
});

import { categoryOverrides, transactions } from '../db/schema';

import { categoryOverridesRepo } from './category-overrides.repo';

// Fake tx: the rule upsert (insert->values->onConflictDoUpdate), the
// full-scan select of transactions, and the id-filtered category update.
const makeTx = (allTransactions: { id: string; description: string }[]) => {
  const captured: {
    ruleValues?: Record<string, unknown>;
    ruleConflict?: Record<string, unknown>;
    txUpdateSet?: Record<string, unknown>;
    txUpdateWhereCalled: boolean;
  } = { txUpdateWhereCalled: false };
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: Record<string, unknown>) => {
          if (table === categoryOverrides) {
            captured.ruleValues = values;
            captured.ruleConflict = config;
          }

          return Promise.resolve();
        },
      }),
    }),
    select: () => ({ from: () => Promise.resolve(allTransactions) }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.txUpdateSet = values;
        }

        return {
          where: () => {
            captured.txUpdateWhereCalled = true;

            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { tx, captured };
};

describe('categoryOverridesRepo.upsertCategoryOverride', () => {
  it('upserts the rule keyed by the normalized name and rewrites matching transactions', async () => {
    const { tx, captured } = makeTx([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' }, // same normalized name
      { id: 't3', description: 'Coffee' }, // different
    ]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.ruleValues).toMatchObject({
      normalizedName: 'atb market',
      category: 'groceries',
      displayName: 'ATB Market',
    });
    // last-write-wins update on conflict: the conflict set carries the new
    // category + displayName (and bumps updatedAt).
    expect(captured.ruleConflict).toMatchObject({ target: categoryOverrides.normalizedName });
    expect(captured.ruleConflict?.set).toMatchObject({
      category: 'groceries',
      displayName: 'ATB Market',
      updatedAt: expect.anything(),
    });
    // the current row + the whitespace/case variant are rewritten; Coffee is not
    expect(captured.txUpdateSet).toEqual({ category: 'groceries' });
    expect(captured.txUpdateWhereCalled).toBe(true);
  });

  it('lets a later sequential edit win and rewrites the matching rows again', async () => {
    // The "multiple sequential edits" edge case: onConflictDoUpdate on the
    // normalized_name PK means the newest category wins, and the rewrite moves
    // every matching row to that newest category.
    const { tx, captured } = makeTx([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' },
    ]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');
    expect(captured.ruleValues).toMatchObject({ category: 'groceries' });
    expect(captured.txUpdateSet).toEqual({ category: 'groceries' });

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'dining');

    // last write wins for the rule...
    expect(captured.ruleValues).toMatchObject({ normalizedName: 'atb market', category: 'dining' });
    expect(captured.ruleConflict?.set).toMatchObject({ category: 'dining' });
    // ...and the matching rows are rewritten again to the newest category.
    expect(captured.txUpdateSet).toEqual({ category: 'dining' });
    expect(captured.txUpdateWhereCalled).toBe(true);
  });

  it('rewrites Cyrillic case-variant same-name rows a SQL lower() would miss', async () => {
    // 'АТБ' (upper) and 'атб' (lower) normalize to the same key only via JS
    // full-Unicode lowercase — SQLite's lower() leaves Cyrillic untouched, so a
    // SQL match would silently split these two rows.
    const { tx, captured } = makeTx([
      { id: 't1', description: 'АТБ' },
      { id: 't2', description: 'атб' },
    ]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('АТБ', 'groceries');

    expect(captured.ruleValues).toMatchObject({ category: 'groceries' });
    expect(captured.txUpdateSet).toEqual({ category: 'groceries' });
    expect(captured.txUpdateWhereCalled).toBe(true);
  });

  it('no-ops on a whitespace-only name — no rule, no rewrite', async () => {
    const { tx, captured } = makeTx([{ id: 't1', description: '   ' }]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('   ', 'groceries');

    expect(captured.ruleValues).toBeUndefined();
    expect(captured.txUpdateSet).toBeUndefined();
    expect(captured.txUpdateWhereCalled).toBe(false);
  });

  it('does not issue an update when no existing transaction matches', async () => {
    const { tx, captured } = makeTx([{ id: 't3', description: 'Coffee' }]);
    mockTx = tx;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.ruleValues).toBeDefined();
    expect(captured.txUpdateSet).toBeUndefined();
    expect(captured.txUpdateWhereCalled).toBe(false);
  });
});
