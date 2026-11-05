import type { CategoryRuleRow } from '@kiko/db';
import type { Currency } from '@kiko/currency/currency';
import { act, renderHook } from '@testing-library/react-native';
import type { FormMode } from '@kiko/screens/forms/mode-select-field';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { useCategoryPick } from './use-category-pick';

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));

const NOON = new Date(2026, 9, 12, 12, 0).getTime();
const MORNING = new Date(2026, 9, 12, 8, 15).getTime();

const ruleOf = (
  id: string,
  category: string,
  matchers: CategoryRuleMatcher[],
): CategoryRuleRow => ({
  id,
  category,
  matchers: JSON.stringify(matchers),
  createdAt: 1,
  updatedAt: 1,
});

const CARD_EXPENSE_RULE = ruleOf('card-expense', 'dining', [
  { type: 'nameStartsWith', text: 'Card expense' },
]);

const COFFEE_RULE = ruleOf('coffee', 'dining', [{ type: 'nameIs', text: 'coffee' }]);
const LARGE_EXPENSE_RULE = ruleOf('large-expense', 'groceries', [
  { type: 'amount', operator: 'gt', minorUnits: 100_000, currency: 'UAH' },
  { type: 'direction', direction: 'expense' },
]);
const MORNING_RULE = ruleOf('morning', 'dining', [
  { type: 'time', operator: 'before', minuteOfDay: 9 * 60 },
]);
const DOLLAR_RULE = ruleOf('dollar', 'dining', [
  { type: 'amount', operator: 'eq', minorUnits: 1200, currency: 'USD' },
]);

const ACCOUNT_RULE = ruleOf('card', 'dining', [{ type: 'account', accountId: 'account-1' }]);

type Draft = {
  description: string;
  amount: string;
  time: number;
  mode: FormMode;
  currency: Currency | null;
  accountId: string | undefined;
  isEditing: boolean;
  ruleDescription: (description: string) => string;
};

const BLANK_DRAFT: Draft = {
  description: '',
  amount: '',
  time: NOON,
  mode: 'expense',
  currency: 'UAH',
  accountId: undefined,
  isEditing: false,
  ruleDescription: (description) => description,
};

// What the form reads for a blank field once a holding is picked: the label the row will show.
const readsLabelWhenBlank = (label: string) => (description: string) =>
  description === '' ? label : description;

const setup = async (rules: CategoryRuleRow[], draft: Partial<Draft> = {}) => {
  mockUseLiveQuery.mockReturnValue({ data: rules });

  const setDescription = jest.fn();
  const hook = await renderHook(
    (current: Draft) =>
      useCategoryPick({ ...current, setDescription, initial: { category: null, isPicked: false } }),
    { initialProps: { ...BLANK_DRAFT, ...draft } },
  );
  // Each change names only the field it moves, over the draft the hook started with.
  const change = async (next: Partial<Draft>): Promise<void> => {
    await hook.rerender({ ...BLANK_DRAFT, ...draft, ...next });
  };
  const run = async (action: () => void): Promise<void> => {
    await act(async () => {
      action();
    });
  };

  return { ...hook, change, run, setDescription };
};

describe('useCategoryPick', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('on a create', () => {
    it('pre-selects once the amount makes a rule on amount and direction match', async () => {
      const { result, change } = await setup([LARGE_EXPENSE_RULE]);

      expect(result.current.selectedCategory).toBeNull();

      await change({ amount: '1500' });

      expect(result.current.selectedCategory).toBe('groceries');
      expect(result.current.effectiveCategory).toBe('groceries');
    });

    it('pre-selects once the time moves into a time rule range', async () => {
      const { result, change } = await setup([MORNING_RULE]);

      expect(result.current.selectedCategory).toBeNull();

      await change({ time: MORNING });

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('pre-selects once the holding gives the amount the rule currency', async () => {
      const { result, change } = await setup([DOLLAR_RULE], { amount: '12', currency: 'UAH' });

      expect(result.current.selectedCategory).toBeNull();

      await change({ currency: 'USD' });

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('pre-selects once the picked holding’s account is the one a rule names', async () => {
      const { result, change } = await setup([ACCOUNT_RULE]);

      expect(result.current.selectedCategory).toBeNull();

      await change({ accountId: 'account-1' });

      expect(result.current.selectedCategory).toBe('dining');

      await change({ accountId: 'account-2' });

      expect(result.current.selectedCategory).toBeNull();
    });

    it('pre-selects by the label a blank description reads as', async () => {
      const { result } = await setup([CARD_EXPENSE_RULE], {
        ruleDescription: readsLabelWhenBlank('Card expense'),
      });

      expect(result.current.selectedCategory).toBe('dining');
      expect(result.current.effectiveCategory).toBe('dining');
      expect(result.current.ruleCategory).toBe('dining');
    });

    it('pre-selects by the label of a description the user clears', async () => {
      const { result, change, run } = await setup([CARD_EXPENSE_RULE], {
        description: 'Silpo',
        ruleDescription: readsLabelWhenBlank('Card expense'),
      });

      expect(result.current.selectedCategory).toBeNull();

      await change({ description: '' });
      await run(result.current.settleDescription);

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('pre-selects nothing for a blank description that has no label yet', async () => {
      const { result } = await setup([CARD_EXPENSE_RULE]);

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.ruleCategory).toBeNull();
    });

    it('pre-selects once the mode matches the direction of the rule', async () => {
      const { result, change } = await setup([LARGE_EXPENSE_RULE], {
        amount: '1500',
        mode: 'income',
      });

      expect(result.current.selectedCategory).toBeNull();

      await change({ mode: 'expense' });

      expect(result.current.selectedCategory).toBe('groceries');
    });

    it('clears the pre-selection once the draft stops matching', async () => {
      const { result, change } = await setup([LARGE_EXPENSE_RULE], { amount: '1500' });

      expect(result.current.selectedCategory).toBe('groceries');

      await change({ amount: '15' });

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBeNull();
    });

    it('takes the description only when it settles on a blur, never from a keystroke', async () => {
      const { result, change, run } = await setup([COFFEE_RULE]);

      await change({ description: 'Coffee' });

      expect(result.current.selectedCategory).toBeNull();

      await run(() => result.current.settleDescription());

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('clears the category once a settled description matches no rule', async () => {
      const { result, change, run } = await setup([COFFEE_RULE], { description: 'Coffee' });

      await run(() => result.current.settleDescription());

      expect(result.current.selectedCategory).toBe('dining');

      await change({ description: 'Other' });
      await run(() => result.current.settleDescription());

      expect(result.current.selectedCategory).toBeNull();
    });

    it('seats the rule category of a tapped suggestion and fills the description', async () => {
      const { result, run, setDescription } = await setup([COFFEE_RULE]);

      await run(() => result.current.pickSuggestion('Coffee'));

      expect(setDescription).toHaveBeenCalledWith('Coffee');
      expect(result.current.selectedCategory).toBe('dining');
    });

    it('acts on the live description for the category Save writes, before any blur', async () => {
      const { result, change, run } = await setup([COFFEE_RULE]);

      await change({ description: 'Coffee' });

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBe('dining');

      await run(() => result.current.settleDescription());

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('opens with the description it is given settled, as a form restored from a draft does', async () => {
      const { result } = await setup([COFFEE_RULE], { description: 'Coffee' });

      expect(result.current.selectedCategory).toBe('dining');
      expect(result.current.userPickedCategory).toBe(false);
    });

    it('never replaces a category the user picked', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE]);

      await run(() => result.current.selectCategory('dining'));
      await change({ amount: '1500' });

      expect(result.current.selectedCategory).toBe('dining');
      expect(result.current.effectiveCategory).toBe('dining');
      expect(result.current.userPickedCategory).toBe(true);
    });

    it('reports a pre-selected category as not picked by hand', async () => {
      const { result } = await setup([LARGE_EXPENSE_RULE], { amount: '1500' });

      expect(result.current.userPickedCategory).toBe(false);
    });
  });

  describe('when seeded', () => {
    it('shows a seeded category and reports it as picked by hand', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE]);

      await run(() => result.current.seedCategory('dining', ''));

      expect(result.current.selectedCategory).toBe('dining');
      expect(result.current.effectiveCategory).toBe('dining');
      expect(result.current.userPickedCategory).toBe(true);

      await change({ amount: '1500' });

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('settles the seeded description, so a rule pre-selects before any blur', async () => {
      const { result, change, run } = await setup([COFFEE_RULE]);

      await change({ description: 'Coffee' });

      expect(result.current.selectedCategory).toBeNull();

      await run(() => result.current.seedCategory(null, 'Coffee'));

      expect(result.current.selectedCategory).toBe('dining');
      expect(result.current.effectiveCategory).toBe('dining');
      expect(result.current.userPickedCategory).toBe(false);
    });
  });

  describe('on an edit', () => {
    it('never pre-selects, whatever the draft becomes', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE, COFFEE_RULE], {
        isEditing: true,
      });

      await change({ amount: '1500', description: 'Coffee' });
      await run(() => result.current.settleDescription());

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBeNull();
    });

    it('keeps the stored category', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE], { isEditing: true });

      await run(() => result.current.seedCategory('dining', ''));
      await change({ amount: '1500' });

      expect(result.current.effectiveCategory).toBe('dining');
    });
  });

  describe('in exchange mode', () => {
    it('never pre-selects, even for a name a rule matches', async () => {
      const { result, change, run } = await setup([COFFEE_RULE], { description: 'Coffee' });

      await run(() => result.current.settleDescription());
      await change({ mode: 'exchange' });

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBeNull();
    });
  });
});
