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

type Draft = {
  description: string;
  amount: string;
  time: number;
  mode: FormMode;
  currency: Currency | null;
  isEditing: boolean;
};

const BLANK_DRAFT: Draft = {
  description: '',
  amount: '',
  time: NOON,
  mode: 'expense',
  currency: 'UAH',
  isEditing: false,
};

const setup = async (rules: CategoryRuleRow[], draft: Partial<Draft> = {}) => {
  mockUseLiveQuery.mockReturnValue({ data: rules });

  const setDescription = jest.fn();
  const hook = await renderHook(
    (current: Draft) => useCategoryPick({ ...current, setDescription }),
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

      await run(() => result.current.onDescriptionBlur());

      expect(result.current.selectedCategory).toBe('dining');
    });

    it('clears the category once a settled description matches no rule', async () => {
      const { result, change, run } = await setup([COFFEE_RULE], { description: 'Coffee' });

      await run(() => result.current.onDescriptionBlur());

      expect(result.current.selectedCategory).toBe('dining');

      await change({ description: 'Other' });
      await run(() => result.current.onDescriptionBlur());

      expect(result.current.selectedCategory).toBeNull();
    });

    it('seats the rule category of a tapped suggestion and fills the description', async () => {
      const { result, run, setDescription } = await setup([COFFEE_RULE]);

      await run(() => result.current.pickSuggestion('Coffee'));

      expect(setDescription).toHaveBeenCalledWith('Coffee');
      expect(result.current.selectedCategory).toBe('dining');
    });

    it('acts on the live description for the category Save writes, before any blur', async () => {
      const { result, run } = await setup([COFFEE_RULE], { description: 'Coffee' });

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBe('dining');

      await run(() => result.current.settleCategory());

      expect(result.current.selectedCategory).toBe('dining');
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

  describe('on an edit', () => {
    it('never pre-selects, whatever the draft becomes', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE, COFFEE_RULE], {
        isEditing: true,
      });

      await change({ amount: '1500', description: 'Coffee' });
      await run(() => result.current.onDescriptionBlur());

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBeNull();
    });

    it('keeps the stored category', async () => {
      const { result, change, run } = await setup([LARGE_EXPENSE_RULE], { isEditing: true });

      await run(() => result.current.setStoredCategory('dining'));
      await change({ amount: '1500' });

      expect(result.current.effectiveCategory).toBe('dining');
    });
  });

  describe('in exchange mode', () => {
    it('never pre-selects, even for a name a rule matches', async () => {
      const { result, change, run } = await setup([COFFEE_RULE], { description: 'Coffee' });

      await run(() => result.current.onDescriptionBlur());
      await change({ mode: 'exchange' });

      expect(result.current.selectedCategory).toBeNull();
      expect(result.current.effectiveCategory).toBeNull();
    });
  });
});
