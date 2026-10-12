import { Alert } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import '@kiko/i18n/init';
import type { CategoryRuleRow } from '@kiko/db';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';

import { emptyMatcherDraft, type MatcherDraft } from '../rule-draft';

import { useSaveRule } from './use-save-rule';

const mockCountRuleRewrite = jest.fn();
const mockSaveRule = jest.fn();

jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    countRuleRewrite: (...args: unknown[]) => mockCountRuleRewrite(...args),
    saveRule: (...args: unknown[]) => mockSaveRule(...args),
  },
}));

const nameDraft = (text: string): MatcherDraft => ({ ...emptyMatcherDraft('UAH'), text });

const timeDraft = (timeOperator: 'before' | 'after', minuteOfDay: number): MatcherDraft => ({
  ...emptyMatcherDraft('UAH'),
  type: 'time',
  timeOperator,
  minuteOfDay,
});

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

type Input = Parameters<typeof useSaveRule>[0];

const onSaved = jest.fn();
const onRefused = jest.fn();

const setup = (overrides: Partial<Input> = {}) =>
  renderHook((input: Input) => useSaveRule(input), {
    initialProps: {
      ruleId: null,
      categoryKey: 'food',
      drafts: [nameDraft('Silpo')],
      rules: [],
      onSaved,
      onRefused,
      ...overrides,
    },
  });

type Hook = Awaited<ReturnType<typeof setup>>;

const pressSave = async (hook: Hook): Promise<void> => {
  await act(async () => {
    hook.result.current.save.onPress();
  });
};

const SILPO: CategoryRuleMatcher = { type: 'nameIs', text: 'Silpo' };

beforeEach(() => {
  jest.clearAllMocks();
  mockCountRuleRewrite.mockResolvedValue(0);
  mockSaveRule.mockResolvedValue({ id: 'saved', changed: 0 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useSaveRule — what a Save press refuses', () => {
  it('shows no error before the first Save press', async () => {
    const hook = await setup({ drafts: [nameDraft('')] });

    expect(hook.result.current.errors).toEqual({ rows: new Map(), rule: undefined });
  });

  it('names each row that cannot become a condition after a Save press, and saves nothing', async () => {
    const hook = await setup({ drafts: [nameDraft('Silpo'), nameDraft('  ')] });

    await pressSave(hook);

    expect(hook.result.current.errors.rows).toEqual(new Map([[1, 'errorName']]));
    expect(onRefused).toHaveBeenCalledWith({ kind: 'row', position: 1 });
    expect(mockCountRuleRewrite).not.toHaveBeenCalled();
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('clears an error as soon as its row is fixed', async () => {
    const hook = await setup({ drafts: [nameDraft('')] });

    await pressSave(hook);
    await hook.rerender({
      ruleId: null,
      categoryKey: 'food',
      drafts: [nameDraft('Silpo')],
      rules: [],
      onSaved,
      onRefused,
    });

    expect(hook.result.current.errors.rows.size).toBe(0);
  });

  it('refuses a rule with no condition', async () => {
    const hook = await setup({ drafts: [] });

    await pressSave(hook);

    expect(hook.result.current.errors.rule).toEqual({ kind: 'noMatchers' });
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('refuses conditions that can never match together', async () => {
    const hook = await setup({
      drafts: [timeDraft('after', 22 * 60), timeDraft('before', 6 * 60)],
    });

    await pressSave(hook);

    expect(hook.result.current.errors.rule).toEqual({ kind: 'neverMatches' });
    expect(onRefused).toHaveBeenCalledWith({ kind: 'rule' });
    expect(mockCountRuleRewrite).not.toHaveBeenCalled();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('refuses a rule another category already has, and names that category', async () => {
    const hook = await setup({
      rules: [ruleOf('taken', 'shops', [{ type: 'nameIs', text: ' SILPO ' }])],
    });

    await pressSave(hook);

    expect(hook.result.current.errors.rule).toEqual({ kind: 'duplicate', category: 'shops' });
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('does not take a rule for a duplicate of itself', async () => {
    const hook = await setup({ ruleId: 'mine', rules: [ruleOf('mine', 'food', [SILPO])] });

    await pressSave(hook);

    expect(hook.result.current.errors.rule).toBeUndefined();
    expect(mockCountRuleRewrite).toHaveBeenCalled();
  });

  it('shows a row error and no rule error until the rows are fixed', async () => {
    const hook = await setup({
      drafts: [nameDraft(''), timeDraft('after', 22 * 60), timeDraft('before', 6 * 60)],
    });

    await pressSave(hook);

    expect(hook.result.current.errors.rows.size).toBe(1);
    expect(hook.result.current.errors.rule).toBeUndefined();
  });
});

describe('useSaveRule — a rule that changes nothing', () => {
  it('asks for the count of the rule as it would be saved, then saves it at once, with no sheet', async () => {
    const hook = await setup();

    await pressSave(hook);

    expect(mockCountRuleRewrite).toHaveBeenCalledWith({
      id: null,
      category: 'food',
      matchers: [SILPO],
    });
    expect(mockSaveRule).toHaveBeenCalledWith({
      id: null,
      category: 'food',
      matchers: [SILPO],
      applyToExisting: false,
    });
    expect(hook.result.current.sheet.visible).toBe(false);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps the id of an edited rule', async () => {
    const hook = await setup({ ruleId: 'mine', rules: [ruleOf('mine', 'shops', [SILPO])] });

    await pressSave(hook);

    expect(mockSaveRule).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' }));
  });
});

describe('useSaveRule — a rule that changes transactions', () => {
  beforeEach(() => {
    mockCountRuleRewrite.mockResolvedValue(3);
  });

  it('opens the sheet with the count and saves nothing yet', async () => {
    const hook = await setup();

    await pressSave(hook);

    expect(hook.result.current.sheet).toMatchObject({ visible: true, count: 3 });
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('applies the rule to the existing transactions, and leaves once the sheet has closed', async () => {
    const hook = await setup();

    await pressSave(hook);
    await act(async () => {
      hook.result.current.sheet.apply.onPress();
    });

    expect(mockSaveRule).toHaveBeenCalledWith({
      id: null,
      category: 'food',
      matchers: [SILPO],
      applyToExisting: true,
    });
    expect(hook.result.current.sheet.visible).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      hook.result.current.sheet.onClosed();
      hook.result.current.sheet.onClosed();
    });

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('saves the rule for new transactions only', async () => {
    const hook = await setup();

    await pressSave(hook);
    await act(async () => {
      hook.result.current.sheet.keepNew.onPress();
    });

    expect(mockSaveRule).toHaveBeenCalledWith(expect.objectContaining({ applyToExisting: false }));
    expect(hook.result.current.sheet.visible).toBe(false);
  });

  it('goes back to the editor with nothing saved when the sheet is cancelled', async () => {
    const hook = await setup();

    await pressSave(hook);
    await act(async () => {
      hook.result.current.sheet.onDismiss();
    });
    await act(async () => {
      hook.result.current.sheet.onClosed();
    });

    expect(hook.result.current.sheet.visible).toBe(false);
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the sheet open and says so when the write fails, so the choice can be made again', async () => {
    mockSaveRule.mockRejectedValueOnce(new Error('disk full'));
    const hook = await setup();

    await pressSave(hook);
    await act(async () => {
      hook.result.current.sheet.apply.onPress();
    });

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(hook.result.current.sheet.visible).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => {
      hook.result.current.sheet.keepNew.onPress();
    });

    expect(mockSaveRule).toHaveBeenCalledTimes(2);
  });

  it('runs one write when a choice is tapped twice', async () => {
    const hook = await setup();

    await pressSave(hook);
    await act(async () => {
      hook.result.current.sheet.apply.onPress();
      hook.result.current.sheet.apply.onPress();
    });

    expect(mockSaveRule).toHaveBeenCalledTimes(1);
  });
});

describe('useSaveRule — a Save pressed twice', () => {
  it('counts and saves once', async () => {
    const hook = await setup();

    await act(async () => {
      hook.result.current.save.onPress();
      hook.result.current.save.onPress();
    });

    expect(mockCountRuleRewrite).toHaveBeenCalledTimes(1);
    expect(mockSaveRule).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('can be pressed again after a failure', async () => {
    mockSaveRule.mockRejectedValueOnce(new Error('disk full'));
    const hook = await setup();

    await pressSave(hook);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(onSaved).not.toHaveBeenCalled();

    await pressSave(hook);

    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('says so, and saves nothing, when the count cannot be read', async () => {
    mockCountRuleRewrite.mockRejectedValueOnce(new Error('read failed'));
    const hook = await setup();

    await pressSave(hook);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(hook.result.current.sheet.visible).toBe(false);
  });
});
