import {
  type CategoryRuleMatcher,
  type RewriteCandidate,
  type StoredCategoryRule,
  planRuleRewrite,
  prepareRules,
  subjectOfStoredRow,
  validateRule,
  winningRule,
} from '@kiko/categories/category-rules';
import { Money } from '@kiko/currency/money';
import { parseAmount } from '@kiko/currency/parse';
import { DAY_MS, defaultDateRange } from '@kiko/dates';

import { buildScreenshotDataset } from '../seed/screenshot-seed';

import { buildDemoSnapshot } from './build-demo-snapshot';

const ANCHOR = Date.UTC(2026, 8, 10, 9, 0, 0);

// The rule typed live into the Dining category's rule editor: "Name starts with" Glovo, "Amount"
// "Less than" 800 in hryvnias, and "Type" Expense. The editor turns the typed 800 into minor
// units the way the line below does.
const RULE_CATEGORY = 'dining';
const RULE_MATCHERS: CategoryRuleMatcher[] = [
  { type: 'nameStartsWith', text: 'Glovo' },
  { type: 'amount', operator: 'lt', minorUnits: 80_000, currency: 'UAH' },
  { type: 'direction', direction: 'expense' },
];

type RuleDemoRow = {
  description: { uk: string; en: string };
  amountMinorUnits: number;
  daysAgo: number;
  // The conditions of the rule the row fails; empty for a row the rule moves.
  fails: CategoryRuleMatcher['type'][];
};

const RULE_DEMO_ROWS: RuleDemoRow[] = [
  {
    description: { uk: 'Glovo: піца', en: 'Glovo: pizza' },
    amountMinorUnits: -48_000,
    daysAgo: 3,
    fails: [],
  },
  {
    description: { uk: 'Glovo: повернення коштів', en: 'Glovo: refund' },
    amountMinorUnits: 35_000,
    daysAgo: 5,
    fails: ['direction'],
  },
  {
    description: { uk: 'Glovo: суші', en: 'Glovo: sushi' },
    amountMinorUnits: -62_000,
    daysAgo: 6,
    fails: [],
  },
  {
    description: { uk: 'Glovo: бургери', en: 'Glovo: burgers' },
    amountMinorUnits: -39_500,
    daysAgo: 8,
    fails: [],
  },
  {
    description: { uk: 'Bolt Food: шаурма', en: 'Bolt Food: shawarma' },
    amountMinorUnits: -52_000,
    daysAgo: 10,
    fails: ['nameStartsWith'],
  },
  {
    description: { uk: 'Glovo: замовлення на компанію', en: 'Glovo: group order' },
    amountMinorUnits: -145_000,
    daysAgo: 12,
    fails: ['amount'],
  },
];

// The rule is saved after every stored rule, so it is the newest of its strength.
const SAVED_AT = ANCHOR + DAY_MS;

describe.each(['uk', 'en'] as const)('the live rule demo rows of the %s demo file', (language) => {
  const snapshot = buildDemoSnapshot(buildScreenshotDataset(language, ANCHOR));
  const holdingById = new Map(snapshot.holdings.map((holding) => [holding.id, holding]));
  const demoRows = RULE_DEMO_ROWS.map((row) => ({
    ...row,
    stored: snapshot.transactions.find(
      (transaction) => transaction.description === row.description[language],
    ),
  }));
  const candidates: RewriteCandidate[] = snapshot.transactions.map((transaction) => ({
    ...transaction,
    currency: holdingById.get(transaction.holdingId)?.currency ?? null,
  }));
  const savedRule: StoredCategoryRule = {
    id: 'rule-draft',
    category: RULE_CATEGORY,
    matchers: JSON.stringify(RULE_MATCHERS),
    createdAt: SAVED_AT,
    updatedAt: SAVED_AT,
  };
  const prepared = prepareRules([...snapshot.categoryRules, savedRule]);
  const subjectOf = (transaction: NonNullable<(typeof demoRows)[number]['stored']>) =>
    subjectOfStoredRow({
      ...transaction,
      currency: holdingById.get(transaction.holdingId)?.currency ?? null,
    });

  it('holds all six rows, each once, on the UAH Monobank card', () => {
    const card = holdingById.get(demoRows[0].stored?.holdingId ?? '');
    const account = snapshot.accounts.find((candidate) => candidate.id === card?.accountId);

    expect(demoRows.every((row) => row.stored !== undefined)).toBe(true);
    expect(new Set(demoRows.map((row) => row.stored?.id)).size).toBe(RULE_DEMO_ROWS.length);
    expect(demoRows.every((row) => row.stored?.holdingId === card?.id)).toBe(true);
    expect(card?.currency).toBe('UAH');
    expect(card?.type).toBe('card');
    expect(account?.bankId).toBe('monobank');
  });

  it('files every row under the default category, never picked by hand', () => {
    const [settings] = snapshot.settings;

    for (const row of demoRows) {
      expect(row.stored?.category).toBe(settings.defaultCategoryKey);
      expect(row.stored?.categorySetByHand).toBe(false);
      expect(row.stored?.amountMinorUnits).toBe(row.amountMinorUnits);
    }
  });

  it('dates every row inside the default 30-day window of the anchor day', () => {
    const { from, to } = defaultDateRange(ANCHOR);

    for (const row of demoRows) {
      expect(row.stored?.time).toBe(ANCHOR - row.daysAgo * DAY_MS);
      expect(row.stored?.time).toBeGreaterThanOrEqual(from.getTime());
      expect(row.stored?.time).toBeLessThanOrEqual(to.getTime());
    }
  });

  it('reads 800 as 80 000 minor units and is a rule the editor saves next to the stored rules', () => {
    expect(Money.fromMajor('UAH', parseAmount('800')).minorUnits).toBe(80_000);
    expect(validateRule(RULE_MATCHERS, prepareRules(snapshot.categoryRules).ordered, null)).toEqual(
      { kind: 'valid' },
    );
  });

  it('moves exactly the three Glovo expenses under 800 to Dining, and the confirm sheet counts 3', () => {
    const plan = planRuleRewrite(prepared, savedRule.id, candidates);
    const movers = demoRows.filter((row) => row.fails.length === 0);

    expect(movers).toHaveLength(3);
    expect([...plan].sort()).toEqual(movers.map((row) => row.stored?.id ?? '').sort());
    expect(plan).toHaveLength(3);
  });

  it('leaves each near-miss in the default category because exactly one condition fails', () => {
    const plan = new Set(planRuleRewrite(prepared, savedRule.id, candidates));
    const nearMisses = demoRows.filter((row) => row.fails.length > 0);

    expect(nearMisses).toHaveLength(3);

    for (const row of nearMisses) {
      const stored = row.stored;

      expect(stored === undefined || plan.has(stored.id)).toBe(false);

      const failed = RULE_MATCHERS.filter(
        (matcher) =>
          stored !== undefined &&
          winningRule(
            prepareRules([{ ...savedRule, matchers: JSON.stringify([matcher]) }]),
            subjectOf(stored),
          ) === undefined,
      ).map((matcher) => matcher.type);

      expect(failed).toEqual(row.fails);
    }
  });

  it('matches neither stored demo rule, so no row of this demo is claimed before the live rule', () => {
    const stored = prepareRules(snapshot.categoryRules);

    for (const row of demoRows) {
      expect(row.stored !== undefined && winningRule(stored, subjectOf(row.stored))).toBeFalsy();
    }
  });

  it('moves no other row of the file', () => {
    const plan = new Set(planRuleRewrite(prepared, savedRule.id, candidates));
    const demoIds = new Set(demoRows.map((row) => row.stored?.id));

    expect([...plan].every((id) => demoIds.has(id))).toBe(true);
  });
});
