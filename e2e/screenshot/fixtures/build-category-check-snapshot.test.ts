import {
  type ReviewEvidence,
  type ReviewGroup,
  planMccBackfill,
  planReviewGroups,
  planRuleRewrite,
  prepareRules,
} from '@kiko/categories/category-rules';
import type { TransactionRow } from '@kiko/db';
import { merchantNameOf } from '@kiko/transactions/merchant-name';

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

describe('buildCategoryCheckSnapshot', () => {
  const demo = buildDemoSnapshot(buildScreenshotDataset('en', ANCHOR));
  const snapshot = buildCategoryCheckSnapshot(ANCHOR);
  const holdingById = new Map(snapshot.holdings.map((holding) => [holding.id, holding]));
  const candidates = snapshot.transactions.map((transaction) => ({
    ...transaction,
    currency: holdingById.get(transaction.holdingId)?.currency ?? null,
    accountId: holdingById.get(transaction.holdingId)?.accountId ?? null,
  }));
  const knownCategoryKeys = new Set(snapshot.categories.map((category) => category.key));
  const rowsNamed = (name: string): TransactionRow[] =>
    snapshot.transactions.filter((transaction) => transaction.description === name);
  // The one-time move the import runs, planned by the app's own function over the file's rows.
  const moves = new Map(
    planMccBackfill(prepareRules(snapshot.categoryRules), candidates, knownCategoryKeys).map(
      ({ id, category }) => [id, category],
    ),
  );
  const categoryAfterMove = (name: string): (string | null)[] =>
    rowsNamed(name).map((row) => moves.get(row.id) ?? row.category);
  const afterMove = candidates.map((row) => ({
    ...row,
    category: moves.get(row.id) ?? row.category,
  }));
  // The rows the evidence read counts, as that read counts them: per description and category.
  const evidence = [
    ...afterMove
      .filter(
        (row) =>
          row.description !== '' &&
          row.category !== null &&
          !row.setsBalance &&
          row.changeGroupId === null &&
          row.exchangeCounterpartHoldingId === null &&
          row.untrackedCounterpart === null,
      )
      .reduce((counts, row) => {
        const categoryKey = (row.category ?? '').toLowerCase();
        const pair = JSON.stringify([row.description, categoryKey]);

        return counts.set(pair, {
          description: row.description,
          categoryKey,
          rowCount: (counts.get(pair)?.rowCount ?? 0) + 1,
        });
      }, new Map<string, ReviewEvidence>())
      .values(),
  ];
  const reviewLines = planReviewGroups(
    prepareRules(snapshot.categoryRules),
    afterMove,
    new Set(snapshot.categories.map((category) => category.key.toLowerCase())),
    evidence,
  );
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
      const savedRule = {
        id: 'review-rule',
        category: 'dining',
        matchers: JSON.stringify([{ type: 'nameIs', text: 'Podil Bakery' }]),
        createdAt: ANCHOR,
        updatedAt: ANCHOR,
      };
      const movedBy = (category: string): number =>
        planRuleRewrite(
          prepareRules([...snapshot.categoryRules, { ...savedRule, category }]),
          savedRule.id,
          afterMove,
        ).length;

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
