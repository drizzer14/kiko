let mockDatabase: DatabaseSync;

jest.mock('@kiko/db/client', () => {
  const { executingClient } = require('@kiko/test-support/real-sqlite');

  return executingClient(() => mockDatabase);
});

import {
  type DataSnapshot,
  EXPORT_VERSION,
  type ExportEnvelope,
  type ExportPayload,
  decodeBase64ToBytes,
  decryptEnvelope,
  restoreDataSnapshot,
} from '@kiko/data-transfer';
import { join } from 'node:path';
import { database } from '@kiko/db';
import { readFileSync } from 'node:fs';
import {
  type ReviewGroup,
  planMccBackfill,
  planReviewGroups,
  planRuleRewrite,
  prepareRules,
} from '@kiko/categories/category-rules';
import { DatabaseSync } from 'node:sqlite';
import {
  categoryRulesRepo,
  mccBackfillRowsQuery,
  readHoldingLabels,
  withVisibleDescription,
} from '@kiko/categories/category-rules-repo';
import { merchantNameOf } from '@kiko/transactions/merchant-name';
import { applyAllMigrations } from '@kiko/test-support/real-sqlite';

import { demoText } from '../seed/demo-text';
import { buildScreenshotDataset } from '../seed/screenshot-seed';

import {
  LONG_TITLE,
  LONG_TITLE_CATEGORY_KEY,
  buildCategoryCheckSnapshot,
} from './build-category-check-snapshot';
import { buildDemoSnapshot } from './build-demo-snapshot';

const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);
// Six rows of the 1.3 upgrade, three of the chip line, three of the confirm line.
const CHECK_ROW_COUNT = 12;
const MOVED_NAMES = [
  'Hotel Dnipro',
  'Ryanair',
  'Wizz Air',
  'Sunrise Travel Agency',
  'Bistro Zamok',
];

// What the import does with a file: the app's own restore writes it to a migrated database, the
// one-time move reads its rows with the app's own query and writes the plan, and the review reads
// its evidence with the app's own query.
const worldOf = async (fileSnapshot: DataSnapshot) => {
  mockDatabase = new DatabaseSync(':memory:');
  applyAllMigrations(mockDatabase);
  await restoreDataSnapshot(fileSnapshot, EXPORT_VERSION);

  const holdingById = new Map(fileSnapshot.holdings.map((holding) => [holding.id, holding]));
  const knownCategoryKeys = new Set(fileSnapshot.categories.map((category) => category.key));
  const backfillRows = withVisibleDescription(
    await mccBackfillRowsQuery(database),
    await readHoldingLabels(database),
  );
  const moves = new Map(
    planMccBackfill(prepareRules(fileSnapshot.categoryRules), backfillRows, knownCategoryKeys).map(
      ({ id, category }) => [id, category],
    ),
  );
  const updateCategory = mockDatabase.prepare('UPDATE transactions SET category = ? WHERE id = ?');

  for (const [id, category] of moves) {
    updateCategory.run(category, id);
  }

  const afterMove = fileSnapshot.transactions.map((transaction) => ({
    ...transaction,
    currency: holdingById.get(transaction.holdingId)?.currency ?? null,
    accountId: holdingById.get(transaction.holdingId)?.accountId ?? null,
    category: moves.get(transaction.id) ?? transaction.category,
  }));
  const reviewLines = planReviewGroups(
    prepareRules(fileSnapshot.categoryRules),
    afterMove,
    new Set(fileSnapshot.categories.map((category) => category.key.toLowerCase())),
    await categoryRulesRepo.reviewEvidenceQuery(),
  );

  return { moves, afterMove, reviewLines };
};

// The rows the saved rule for the Podil Bakery name would move, planned by the app's own function.
const podilRuleMoves = (
  fileSnapshot: DataSnapshot,
  afterMove: Awaited<ReturnType<typeof worldOf>>['afterMove'],
  category: string,
): number => {
  const savedRule = {
    id: 'review-rule',
    category,
    matchers: JSON.stringify([{ type: 'nameIs', text: 'Podil Bakery' }]),
    createdAt: ANCHOR,
    updatedAt: ANCHOR,
  };

  return planRuleRewrite(
    prepareRules([...fileSnapshot.categoryRules, savedRule]),
    savedRule.id,
    afterMove,
  ).length;
};

const readCommittedSnapshot = (): DataSnapshot => {
  const key = decodeBase64ToBytes(readFileSync(join(__dirname, 'kiko-demo.key'), 'utf8'));
  const envelope: ExportEnvelope = JSON.parse(
    readFileSync(join(__dirname, 'kiko-category-check-en.kiko'), 'utf8'),
  );
  const payload: ExportPayload = JSON.parse(
    new TextDecoder().decode(decryptEnvelope(envelope, key)),
  );

  return payload.tables;
};

describe('buildCategoryCheckSnapshot', () => {
  const demo = buildDemoSnapshot(buildScreenshotDataset('en', ANCHOR));
  const snapshot = buildCategoryCheckSnapshot(ANCHOR);
  const knownCategoryKeys = new Set(snapshot.categories.map((category) => category.key));
  const rowsNamed = (name: string) =>
    snapshot.transactions.filter((transaction) => transaction.description === name);
  let moves: Map<string, string>;
  let afterMove: Awaited<ReturnType<typeof worldOf>>['afterMove'];
  let reviewLines: ReviewGroup[];

  beforeAll(async () => {
    ({ moves, afterMove, reviewLines } = await worldOf(snapshot));
  });

  const categoryAfterMove = (name: string): (string | null)[] =>
    rowsNamed(name).map((row) => moves.get(row.id) ?? row.category);
  const groupOf = (key: string): ReviewGroup | undefined =>
    reviewLines.find((group) => group.key === key);

  it('is deterministic and holds no Cyrillic letter', () => {
    expect(buildCategoryCheckSnapshot(ANCHOR)).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toMatch(/\p{Script=Cyrillic}/u);
  });

  it('keeps every demo row, category and rule, and adds only the check rows and one category', () => {
    const [opening] = [...demo.transactions].sort((first, second) => first.time - second.time);

    expect(
      snapshot.transactions
        .slice(0, demo.transactions.length)
        .filter((row) => row.id !== opening.id),
    ).toEqual(demo.transactions.filter((row) => row.id !== opening.id));
    expect(snapshot.categories.slice(0, demo.categories.length)).toEqual(demo.categories);
    expect(snapshot.categories.slice(demo.categories.length)).toEqual([
      expect.objectContaining({ key: LONG_TITLE_CATEGORY_KEY, title: LONG_TITLE, sortOrder: 12 }),
    ]);
    expect(snapshot.categoryRules).toEqual(demo.categoryRules);
    expect(snapshot.transactions).toHaveLength(demo.transactions.length + CHECK_ROW_COUNT);
  });

  it('keeps every account balance: the card opening deposit pays for the check rows', () => {
    const [card] = snapshot.holdings;
    const cardTotal = snapshot.transactions
      .filter((row) => row.holdingId === card.id)
      .reduce((total, row) => total + row.amountMinorUnits, 0);

    expect(card.name).toBe(demoText.en.monobank);
    expect(card.type).toBe('card');
    expect(cardTotal).toBe(card.balanceMinorUnits);
    expect(snapshot.holdings).toEqual(demo.holdings);
  });

  describe('the 1.3 upgrade', () => {
    it('marks the file as one the one-time move has not run on, and still holds Travel', () => {
      expect(snapshot.settings[0].mccCategoriesBackfilled).toBe(false);
      expect(demo.settings[0].mccCategoriesBackfilled).toBe(true);
      expect(knownCategoryKeys.has('travel')).toBe(true);
    });

    it('moves the hotel, the two airlines and the travel agency to Travel', () => {
      expect(categoryAfterMove('Hotel Dnipro')).toEqual(['travel']);
      expect(categoryAfterMove('Ryanair')).toEqual(['travel']);
      expect(categoryAfterMove('Wizz Air')).toEqual(['travel']);
      expect(categoryAfterMove('Sunrise Travel Agency')).toEqual(['travel']);
      expect(rowsNamed('Wizz Air')[0].mcc).toBeGreaterThanOrEqual(3000);
      expect(rowsNamed('Wizz Air')[0].mcc).toBeLessThanOrEqual(3299);
    });

    it('moves a newly mapped dining code to Dining', () => {
      expect(categoryAfterMove('Bistro Zamok')).toEqual(['dining']);
    });

    it('leaves a hand-set row with a Travel code where the user put it', () => {
      expect(rowsNamed('Spa Hotel Carpathia')[0]).toMatchObject({
        mcc: 7011,
        category: 'entertainment',
        categorySetByHand: true,
      });
      expect(categoryAfterMove('Spa Hotel Carpathia')).toEqual(['entertainment']);
    });

    it('moves nothing else: no demo row, no row in a real category', () => {
      expect([...moves.keys()].sort()).toEqual(
        MOVED_NAMES.flatMap((name) => rowsNamed(name).map((row) => row.id)).sort(),
      );
      expect(categoryAfterMove('Podil Bakery')).toEqual(['other', 'other', 'groceries']);
    });

    it('leaves none of the moved rows on the review list', () => {
      for (const name of MOVED_NAMES) {
        expect(groupOf(merchantNameOf(name).key)).toBeUndefined();
      }
    });
  });

  describe('the review list', () => {
    it('lists the lines in this order, each with its row count', () => {
      expect(reviewLines.map((line) => [line.key, line.rowCount])).toEqual([
        ['salary', 6],
        ['nova poshta', 6],
        ['ukrposhta', 6],
        ['kfc', 4],
        ['varus', 3],
        ['podil bakery', 2],
        ['car loan payment', 2],
        ['binance', 2],
        ['kfc: refund', 1],
        ['sushi master', 1],
        ['mokko coffee', 1],
        ['bud depot', 1],
        ['apartment renovation', 1],
        ['freelance project', 1],
        ['binance p2p', 1],
      ]);
    });

    it('shows the long category title as a chip on the Bud Depot line', () => {
      expect(
        snapshot.categories.find((category) => category.key === LONG_TITLE_CATEGORY_KEY)?.title,
      ).toBe('Home renovation and garden supplies');
      expect(groupOf('bud depot')).toMatchObject({
        names: ['Bud Depot'],
        rowCount: 1,
        suggestion: { category: LONG_TITLE_CATEGORY_KEY, agreeing: 2, total: 2 },
      });
    });

    it('opens the confirm sheet on the Podil Bakery line: the rule moves a row the line hides', () => {
      const movedBy = (category: string): number => podilRuleMoves(snapshot, afterMove, category);

      expect(groupOf('podil bakery')).toMatchObject({
        names: ['Podil Bakery'],
        rowCount: 2,
        rule: { kind: 'nameIs', text: 'Podil Bakery' },
        suggestion: null,
      });
      expect(movedBy('dining')).toBe(3);
      expect(movedBy('groceries')).toBe(2);
    });

    it('keeps the demo lines: Mokko Coffee with its Dining chip, Varus and KFC', () => {
      expect(groupOf(merchantNameOf(demoText.en.mokkoCoffee).key)?.suggestion).toEqual({
        category: 'dining',
        agreeing: 3,
        total: 3,
      });
      expect(groupOf('varus')).toMatchObject({ rowCount: 3, suggestion: null });
      expect(groupOf('kfc')).toMatchObject({ rowCount: 4, suggestion: null });
    });
  });
});

describe('the committed kiko-category-check-en.kiko', () => {
  it('holds what the README says, whatever day it was made on', async () => {
    const committed = readCommittedSnapshot();
    const { afterMove, reviewLines } = await worldOf(committed);
    const groupOf = (key: string) => reviewLines.find((group) => group.key === key);
    expect(afterMove.filter((row) => row.category === 'travel')).toHaveLength(4);
    expect(groupOf('bud depot')?.suggestion).toEqual({
      category: LONG_TITLE_CATEGORY_KEY,
      agreeing: 2,
      total: 2,
    });
    expect(podilRuleMoves(committed, afterMove, 'dining')).toBe(3);
  });
});
