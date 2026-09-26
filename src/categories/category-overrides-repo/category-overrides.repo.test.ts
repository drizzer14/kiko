// `upsertCategoryOverride` runs its rule upsert AND its transaction rewrite
// through the `write` helper (one op-sqlite transaction). Override `write` to
// run the callback against a fake transaction handle so the test can capture
// both the rule payload and the id-filtered category update issued inside that
// single transaction.
let mockDatabaseTransaction: unknown;
jest.mock('../../db/client', () => {
  const actual = jest.requireActual('../../db/client');
  return {
    ...actual,
    write: (work: (db: unknown) => unknown) => work(mockDatabaseTransaction),
  };
});

import type { SQL } from 'drizzle-orm';

import { categoryOverrides, transactions } from '../../db/schema';
import { renderCondition } from '../../db/render-condition-test-helper';

import { categoryOverridesRepo } from './category-overrides.repo';

// Fake transaction: the rule upsert (insert->values->onConflictDoUpdate), the
// DISTINCT description read, and the description-filtered category update. A
// plain full-row `select` throws: the rewrite must never pull every
// transaction row into JS.
const makeDatabaseTransaction = (allTransactions: { id: string; description: string }[]) => {
  const captured: {
    ruleValues?: Record<string, unknown>;
    ruleConflict?: Record<string, unknown>;
    transactionUpdateSet?: Record<string, unknown>;
    transactionUpdateWhere?: SQL;
    transactionUpdateWhereCalled: boolean;
    distinctRead?: { fields: Record<string, unknown>; table: unknown };
  } = { transactionUpdateWhereCalled: false };
  const distinctDescriptions = [
    ...new Set(allTransactions.map((transaction) => transaction.description)),
  ].map((description) => ({ description }));
  const databaseTransaction = {
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
    select: () => {
      throw new Error('full transactions scan');
    },
    selectDistinct: (fields: Record<string, unknown>) => ({
      from: (table: unknown) => {
        captured.distinctRead = { fields, table };

        return Promise.resolve(distinctDescriptions);
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        if (table === transactions) {
          captured.transactionUpdateSet = values;
        }

        return {
          where: (condition: SQL) => {
            captured.transactionUpdateWhereCalled = true;
            captured.transactionUpdateWhere = condition;

            return Promise.resolve();
          },
        };
      },
    }),
  };

  return { databaseTransaction, captured };
};

describe('categoryOverridesRepo.allQuery', () => {
  it('builds a reactive query targeting category_overrides', () => {
    // The read query returns a Drizzle builder (never executed data), so the
    // form can hand it to useLiveQuery. Only the SQL shape is asserted here.
    expect(categoryOverridesRepo.allQuery().toSQL().sql).toContain('category_overrides');
  });
});

describe('categoryOverridesRepo.upsertCategoryOverride', () => {
  it('filters the rewrite in SQL by the matching raw descriptions, reading only distinct descriptions', async () => {
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' },
      { id: 't3', description: 'Coffee' },
      { id: 't4', description: 'ATB Market' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.distinctRead).toEqual({
      fields: { description: transactions.description },
      table: transactions,
    });
    expect(renderCondition(captured.transactionUpdateWhere)).toEqual({
      sql: '"transactions"."description" in (?, ?)',
      params: ['ATB Market', '  atb   market '],
    });
  });

  it('upserts the rule keyed by the normalized name and rewrites matching transactions', async () => {
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' }, // same normalized name
      { id: 't3', description: 'Coffee' }, // different
    ]);
    mockDatabaseTransaction = databaseTransaction;

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
    expect(captured.transactionUpdateSet).toEqual({ category: 'groceries' });
    expect(captured.transactionUpdateWhereCalled).toBe(true);
  });

  it('lets a later sequential edit win and rewrites the matching rows again', async () => {
    // The "multiple sequential edits" edge case: onConflictDoUpdate on the
    // normalized_name PK means the newest category wins, and the rewrite moves
    // every matching row to that newest category.
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't1', description: 'ATB Market' },
      { id: 't2', description: '  atb   market ' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');
    expect(captured.ruleValues).toMatchObject({ category: 'groceries' });
    expect(captured.transactionUpdateSet).toEqual({ category: 'groceries' });

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'dining');

    // last write wins for the rule...
    expect(captured.ruleValues).toMatchObject({ normalizedName: 'atb market', category: 'dining' });
    expect(captured.ruleConflict?.set).toMatchObject({ category: 'dining' });
    // ...and the matching rows are rewritten again to the newest category.
    expect(captured.transactionUpdateSet).toEqual({ category: 'dining' });
    expect(captured.transactionUpdateWhereCalled).toBe(true);
  });

  it('rewrites Cyrillic case-variant same-name rows a SQL lower() would miss', async () => {
    // 'АТБ' (upper) and 'атб' (lower) normalize to the same key only via JS
    // full-Unicode lowercase — SQLite's lower() leaves Cyrillic untouched, so a
    // SQL match would silently split these two rows.
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't1', description: 'АТБ' },
      { id: 't2', description: 'атб' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await categoryOverridesRepo.upsertCategoryOverride('АТБ', 'groceries');

    expect(captured.ruleValues).toMatchObject({ category: 'groceries' });
    expect(captured.transactionUpdateSet).toEqual({ category: 'groceries' });
    expect(renderCondition(captured.transactionUpdateWhere).params).toEqual(['АТБ', 'атб']);
  });

  it('no-ops on a whitespace-only name — no rule, no rewrite', async () => {
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't1', description: '   ' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await categoryOverridesRepo.upsertCategoryOverride('   ', 'groceries');

    expect(captured.ruleValues).toBeUndefined();
    expect(captured.transactionUpdateSet).toBeUndefined();
    expect(captured.transactionUpdateWhereCalled).toBe(false);
  });

  it('does not issue an update when no existing transaction matches', async () => {
    const { databaseTransaction, captured } = makeDatabaseTransaction([
      { id: 't3', description: 'Coffee' },
    ]);
    mockDatabaseTransaction = databaseTransaction;

    await categoryOverridesRepo.upsertCategoryOverride('ATB Market', 'groceries');

    expect(captured.ruleValues).toBeDefined();
    expect(captured.transactionUpdateSet).toBeUndefined();
    expect(captured.transactionUpdateWhereCalled).toBe(false);
  });
});
