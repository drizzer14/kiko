// The review list and the tap that writes it are SQL over one stored ledger: which rows the read
// returns, which of them the plan lists, and which rows a rule then moves. The counts of the list,
// the preview and the write can only be compared against a real engine.
//
// The world: 12 rows `ATB 0212` in other; 3 rows `ATB 0212` sorted by their MCC into groceries;
// `ATB Market` and `ATBANK` in shopping; one hand-set `ATB 0340`; one balance row; 4 rows
// `Silpo 12` in other with nothing else under that prefix; and a name that holds each of the four
// states of no real category.
let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');
  const client = executingClient(() => mockDatabase);

  return { database: client.database, write: client.write };
});

import {
  type NameRuleKind,
  type PreparedRules,
  type RewriteCandidate,
  prepareRules,
} from '@kiko/categories/category-rules';
import { DatabaseSync } from 'node:sqlite';
import { remindersRepo } from '@kiko/reminders/repo';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { categoryRulesRepo } from './category-rules.repo';

type ReviewRow = RewriteCandidate & {
  exchangeCounterpartHoldingId: string | null;
  untrackedCounterpart: string | null;
};

type ReviewGroup = {
  key: string;
  names: readonly string[];
  rowCount: number;
  newestTime: number;
  rule: { kind: NameRuleKind; text: string };
};

type ReviewCandidateQuery = PromiseLike<ReviewRow[]> & {
  toSQL: () => { sql: string; params: unknown[] };
};

const planReviewGroups = (
  prepared: PreparedRules,
  rows: readonly ReviewRow[],
  knownCategoryKeys: ReadonlySet<string>,
): ReviewGroup[] =>
  (
    jest.requireActual('@kiko/categories/category-rules') as {
      planReviewGroups: (
        prepared: PreparedRules,
        rows: readonly ReviewRow[],
        knownCategoryKeys: ReadonlySet<string>,
      ) => ReviewGroup[];
    }
  ).planReviewGroups(prepared, rows, knownCategoryKeys);

const reviewCandidateRowsQuery = (): ReviewCandidateQuery =>
  (
    categoryRulesRepo as unknown as { reviewCandidateRowsQuery: () => ReviewCandidateQuery }
  ).reviewCandidateRowsQuery();

type Seed = {
  id: string;
  description: string;
  category: string | null;
  mcc?: number;
  categorySetByHand?: boolean;
  setsBalance?: boolean;
  exchangeCounterpartHoldingId?: string;
  untrackedCounterpart?: string;
};

const PICKED_CATEGORY = 'transport';
const CREATED_AT = 5_000_000;

const insertRow = (seed: Seed): void => {
  mockDatabase
    .prepare(
      `INSERT INTO transactions (id, holding_id, amount_minor_units, time, description, category,
         mcc, source, category_set_by_hand, sets_balance, exchange_counterpart_holding_id,
         untracked_counterpart)
       VALUES (?, 'card', -100, 1000, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    )
    .run(
      seed.id,
      seed.description,
      seed.category,
      seed.mcc ?? null,
      seed.categorySetByHand === true ? 1 : 0,
      seed.setsBalance === true ? 1 : 0,
      seed.exchangeCounterpartHoldingId ?? null,
      seed.untrackedCounterpart ?? null,
    );
};

const insertRows = (prefix: string, count: number, fields: Omit<Seed, 'id'>): void => {
  for (let index = 0; index < count; index += 1) {
    insertRow({ id: `${prefix}-${index}`, ...fields });
  }
};

const openWorld = (): void => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  mockDatabase.exec(`
    INSERT INTO accounts (id, name, kind) VALUES ('account', 'Bank', 'bank');
    INSERT INTO holdings (id, account_id, name, type, currency)
      VALUES ('card', 'account', 'Card', 'card', 'UAH');
  `);
  insertRows('atb-other', 12, { description: 'ATB 0212', category: 'other' });
  insertRows('atb-sorted', 3, { description: 'ATB 0212', category: 'groceries', mcc: 5411 });
  insertRow({ id: 'atb-market', description: 'ATB Market', category: 'shopping' });
  insertRow({ id: 'atbank', description: 'ATBANK', category: 'shopping' });
  insertRow({
    id: 'atb-hand',
    description: 'ATB 0340',
    category: 'other',
    categorySetByHand: true,
  });
  insertRow({ id: 'balance', description: '', category: null, setsBalance: true });
  insertRows('silpo', 4, { description: 'Silpo 12', category: 'other' });
  insertRow({ id: 'mixed-null', description: 'Mixed Shop', category: null });
  insertRow({ id: 'mixed-empty', description: 'Mixed Shop', category: '' });
  insertRow({ id: 'mixed-other', description: 'Mixed Shop', category: 'other' });
  insertRow({ id: 'mixed-orphan', description: 'Mixed Shop', category: 'ghost' });
};

const knownCategoryKeys = (): ReadonlySet<string> =>
  new Set(
    (mockDatabase.prepare('SELECT key FROM categories').all() as { key: string }[]).map((row) =>
      row.key.toLowerCase(),
    ),
  );

const categoriesById = (): Record<string, string | null> =>
  Object.fromEntries(
    (
      mockDatabase.prepare('SELECT id, category FROM transactions').all() as {
        id: string;
        category: string | null;
      }[]
    ).map((row) => [row.id, row.category]),
  );

const changedBy = async (write: () => Promise<unknown>): Promise<string[]> => {
  const before = categoriesById();

  await write();

  return Object.entries(categoriesById())
    .filter(([id, category]) => before[id] !== category)
    .map(([id]) => id);
};

const preparedRules = async (): Promise<PreparedRules> =>
  prepareRules(await categoryRulesRepo.allQuery());

const currentGroups = async (): Promise<ReviewGroup[]> =>
  planReviewGroups(await preparedRules(), await reviewCandidateRowsQuery(), knownCategoryKeys());

// A row is listed when the plan keeps it alone: groups never depend on each other's rows.
const listedIdsOf = async (group: ReviewGroup): Promise<string[]> => {
  const prepared = await preparedRules();
  const known = knownCategoryKeys();

  return (await reviewCandidateRowsQuery())
    .filter((row) => planReviewGroups(prepared, [row], known).at(0)?.key === group.key)
    .map((row) => row.id)
    .sort();
};

const groupOf = async (key: string): Promise<ReviewGroup> => {
  const group = (await currentGroups()).find((candidate) => candidate.key === key);

  if (group === undefined) {
    throw new Error(`no review group ${key}`);
  }

  return group;
};

const previewOf = (rule: ReviewGroup['rule'], category = PICKED_CATEGORY) =>
  categoryRulesRepo.previewNameRule({ ...rule, category, sourceTransactionId: null });

const applyOf = (rule: ReviewGroup['rule'], category = PICKED_CATEGORY) =>
  categoryRulesRepo.applyNameRule({
    name: rule.text,
    kind: rule.kind,
    category,
    sourceTransactionId: null,
  });

const storedRowsNamed = (text: string): number =>
  (
    mockDatabase
      .prepare(
        `SELECT count(*) AS count FROM transactions
         WHERE lower(description) = lower(?) AND category_set_by_hand = 0 AND sets_balance = 0
           AND coalesce(category, '') <> ?`,
      )
      .get(text, PICKED_CATEGORY) as { count: number }
  ).count;

beforeEach(openWorld);

describe('the review list against the rows a tap writes', () => {
  it('lists three groups in the world', async () => {
    expect((await currentGroups()).map((group) => [group.key, group.rowCount])).toEqual([
      ['atb', 12],
      ['mixed shop', 4],
      ['silpo', 4],
    ]);
  });

  it('listed rows are a subset of planned rows', async () => {
    const groups = await currentGroups();

    for (const group of groups) {
      openWorld();

      const listed = await listedIdsOf(group);
      const changed = await changedBy(() => applyOf(group.rule));

      expect(listed).toHaveLength(group.rowCount);
      expect(listed.filter((id) => !changed.includes(id))).toEqual([]);
    }
  });

  it.each<[NameRuleKind, string, number]>([
    ['nameIs', 'ATB 0212', 15],
    ['nameStartsWith', 'ATB', 17],
  ])('the preview count equals the rows the write changes: %s', async (kind, text, expected) => {
    const rule = { kind, text };
    const preview = await previewOf(rule);
    const changed = await changedBy(() => applyOf(rule));

    expect(preview.count).toBe(changed.length);
    expect(changed).toHaveLength(expected);
  });

  it('planned equals listed when no other row carries the name', async () => {
    const group = await groupOf('silpo');

    expect(group.rule).toEqual({ kind: 'nameIs', text: 'Silpo 12' });
    expect((await previewOf(group.rule)).count).toBe(group.rowCount);
  });

  it('a listed count below the preview means a confirm', async () => {
    const group = await groupOf('atb');

    expect((await previewOf(group.rule)).count).toBeGreaterThan(group.rowCount);
  });

  it('every listed row moves whatever it holds', async () => {
    const group = await groupOf('mixed shop');
    const preview = await previewOf(group.rule, 'groceries');

    expect(group.rowCount).toBe(4);
    expect(preview.count).toBe(group.rowCount);

    await applyOf(group.rule, 'groceries');

    expect(await listedIdsOf(group)).toEqual([]);
    expect(
      ['mixed-null', 'mixed-empty', 'mixed-other', 'mixed-orphan'].map(
        (id) => categoriesById()[id],
      ),
    ).toEqual(['groceries', 'groceries', 'groceries', 'groceries']);
  });

  it.each(['atb', 'silpo'])(
    'a one-name store-number group previews its own rows: %s',
    async (key) => {
      const group = await groupOf(key);

      expect(group.rule.kind).toBe('nameIs');
      expect(storedRowsNamed(group.rule.text)).toBeGreaterThan(0);
      expect((await previewOf(group.rule)).count).toBe(storedRowsNamed(group.rule.text));
    },
  );

  it('a hand-set row is not listed, not counted and not written', async () => {
    const group = await groupOf('atb');
    const prefixRule: ReviewGroup['rule'] = { kind: 'nameStartsWith', text: 'ATB' };
    const preview = await previewOf(prefixRule);

    expect((await reviewCandidateRowsQuery()).map((row) => row.id)).toContain('atb-hand');
    expect(await listedIdsOf(group)).not.toContain('atb-hand');
    expect(preview.names).not.toContain('ATB 0340');

    await applyOf(prefixRule);

    expect(categoriesById()['atb-hand']).toBe('other');
    expect(
      (
        mockDatabase
          .prepare("SELECT category_set_by_hand AS flag FROM transactions WHERE id = 'atb-hand'")
          .get() as { flag: number }
      ).flag,
    ).toBe(1);
  });

  it('the plan is redone inside the write', async () => {
    const group = await groupOf('atb');

    expect((await previewOf(group.rule)).count).toBe(15);

    insertRow({ id: 'late', description: 'ATB 0212', category: 'other' });

    expect(await applyOf(group.rule)).toBe(16);
    expect(categoriesById().late).toBe(PICKED_CATEGORY);
  });

  it('drops an exchange leg that the read returns', async () => {
    insertRow({
      id: 'leg-paired',
      description: 'Leg Shop',
      category: 'other',
      exchangeCounterpartHoldingId: 'card',
    });
    insertRow({
      id: 'leg-untracked',
      description: 'Leg Shop',
      category: 'other',
      untrackedCounterpart: 'untracked',
    });

    const ids = (await reviewCandidateRowsQuery()).map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining(['leg-paired', 'leg-untracked']));
    expect((await currentGroups()).map((group) => group.key)).not.toContain('leg shop');
  });
});

describe('a manual row that a tap gives a category', () => {
  const entriesSince = async (since: number): Promise<number> =>
    (await remindersRepo.manualEntryDaysQuery('account', since)).at(0)?.entries ?? 0;

  it('a manual row with a name and no category becomes an entry only inside its created-at window when a tap gives it a category', async () => {
    mockDatabase.exec('DELETE FROM transactions');
    insertRow({ id: 'salary', description: 'Salary', category: null });
    mockDatabase
      .prepare("UPDATE transactions SET created_at = ? WHERE id = 'salary'")
      .run(CREATED_AT);

    expect(await entriesSince(CREATED_AT - 1)).toBe(0);
    expect(await entriesSince(CREATED_AT + 1)).toBe(0);

    await applyOf({ kind: 'nameIs', text: 'Salary' }, 'groceries');

    expect(categoriesById().salary).toBe('groceries');
    expect(await entriesSince(CREATED_AT - 1)).toBe(1);
    expect(await entriesSince(CREATED_AT + 1)).toBe(0);
  });
});

describe('reviewCandidateRowsQuery', () => {
  const ARMS_IN_ONE_GROUP =
    /<> \? and \(("\w+"\.)?"category" is null or lower\(("\w+"\.)?"category"\) = 'other' or lower\(("\w+"\.)?"category"\) not in \(select lower\(("\w+"\.)?"key"\) from "categories"\)\)/;

  it('keeps a blank name out through the parentheses of noRealCategorySql', async () => {
    insertRow({ id: 'blank-other', description: '', category: 'other' });
    insertRow({ id: 'blank-null', description: '', category: null });
    insertRow({ id: 'blank-orphan', description: '', category: 'ghost' });

    const query = reviewCandidateRowsQuery();
    const ids = (await query).map((row) => row.id);

    expect(query.toSQL().sql.toLowerCase()).toMatch(ARMS_IN_ONE_GROUP);
    expect(ids).toEqual(expect.arrayContaining(['atb-other-0', 'mixed-null', 'mixed-orphan']));
    expect(ids.filter((id) => id.startsWith('blank') || id === 'balance')).toEqual([]);
  });
});
