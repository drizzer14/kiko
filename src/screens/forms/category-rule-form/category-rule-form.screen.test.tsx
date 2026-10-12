import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { fieldSuffix } from '@kiko/test-support/field-suffix';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoryRuleFormScreen from './category-rule-form.screen';

type CategoryData = { key: string; title: string; icon: string; color: string | null };
type RuleData = {
  id: string;
  category: string;
  matchers: string;
  createdAt: number;
  updatedAt: number;
};

const mockCountRuleRewrite = jest.fn();
const mockSaveRule = jest.fn();
let mockRules: RuleData[] = [];
let mockCategories: CategoryData[] = [];
let mockSettingsRows: Array<{ baseCurrency: string }> = [];
let mockRulesLoading = false;
let mockSettingsLoading = false;

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    countRuleRewrite: (...args: unknown[]) => mockCountRuleRewrite(...args),
    saveRule: (...args: unknown[]) => mockSaveRule(...args),
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, keys: string[]) => {
    if (keys?.[0] === 'settings') {
      return { data: mockSettingsRows, isLoading: mockSettingsLoading, isFresh: true };
    }

    if (keys?.[0] === 'category_rules') {
      return { data: mockRules, isLoading: mockRulesLoading, isFresh: true };
    }

    return { data: mockCategories, isLoading: false, isFresh: true };
  },
}));

type FormProps = ComponentProps<typeof CategoryRuleFormScreen>;

const navigation = navigationSpy();

const formElement = (params: { categoryKey: string; ruleId?: string }) => (
  <CategoryRuleFormScreen
    navigation={asNavigationProp<FormProps['navigation']>(navigation)}
    route={asRouteProp<FormProps['route']>('CategoryRuleForm', params)}
  />
);

const renderCreate = () => render(formElement({ categoryKey: 'food' }));

const renderEdit = (ruleId: string) => render(formElement({ categoryKey: 'food', ruleId }));

type Screen = Awaited<ReturnType<typeof renderCreate>>;

const ruleOf = (id: string, category: string, matchers: CategoryRuleMatcher[]): RuleData => ({
  id,
  category,
  matchers: JSON.stringify(matchers),
  createdAt: 500,
  updatedAt: 1000,
});

const SILPO: CategoryRuleMatcher = { type: 'nameIs', text: 'Silpo' };

const AMOUNT_ERROR =
  'Enter an amount of 0 or more, with no more decimals than the currency allows.';

const pickType = async (screen: Screen, position: number, type: string): Promise<void> => {
  await fireEvent.press(screen.getByTestId(`matcher-type-${position}`));
  await fireEvent.press(screen.getByTestId(`matcher-type-${position}-option-${type}`));
};

const typeName = async (screen: Screen, text: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('Name'), text);
};

const pressSave = async (screen: Screen): Promise<void> => {
  await fireEvent.press(screen.getByText('Save'));
};

const lastOptions = (): { title?: string } => navigation.setOptions.mock.calls.at(-1)?.[0] ?? {};

beforeEach(() => {
  jest.clearAllMocks();
  mockRules = [];
  mockCategories = [
    { key: 'food', title: 'Food', icon: 'fork.knife', color: null },
    { key: 'groceries', title: 'Groceries', icon: 'cart', color: null },
    { key: 'shops', title: 'Rozetka', icon: 'bag', color: null },
  ];
  mockSettingsRows = [{ baseCurrency: 'UAH' }];
  mockRulesLoading = false;
  mockSettingsLoading = false;
  mockCountRuleRewrite.mockResolvedValue(0);
  mockSaveRule.mockResolvedValue({ id: 'saved', changed: 0 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('CategoryRuleFormScreen — a new rule', () => {
  it('starts with one blank "Name is" condition and nothing to remove', async () => {
    const { getAllByLabelText, getByLabelText, getByText, queryByText } = await renderCreate();

    expect(getAllByLabelText('Condition')).toHaveLength(1);
    expect(getByText('Name is')).toBeTruthy();
    expect(getByLabelText('Name').props.value).toBe('');
    expect(queryByText('Remove')).toBeNull();
  });

  it('says that a transaction must match every condition', async () => {
    const { getByText } = await renderCreate();

    expect(getByText('A transaction must match every condition.')).toBeTruthy();
  });

  it('shows a loading state, not a blank condition, until the settings are read', async () => {
    mockSettingsLoading = true;

    const { getByTestId, queryAllByLabelText } = await renderCreate();

    expect(getByTestId('category-rule-form-loading')).toBeTruthy();
    expect(queryAllByLabelText('Condition')).toHaveLength(0);
  });

  it('adds a condition below the others', async () => {
    const { getByText, getAllByLabelText } = await renderCreate();

    await fireEvent.press(getByText('Add condition'));

    expect(getAllByLabelText('Condition')).toHaveLength(2);
  });

  it('starts an amount in the base currency', async () => {
    mockSettingsRows = [{ baseCurrency: 'USD' }];

    const screen = await renderCreate();

    await pickType(screen, 0, 'amount');

    expect(fieldSuffix(screen.getByLabelText('Amount'))).toBe('$');
    expect(screen.getByTestId('matcher-currency-0')).toHaveTextContent(/US Dollar/);
  });

  it('removes a condition, and offers no removal on the one left', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Add condition'));

    expect(screen.getAllByText('Remove')).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Remove condition 1'));

    expect(screen.getAllByLabelText('Condition')).toHaveLength(1);
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('changes the inputs with the type of the condition', async () => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'amount');

    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.getByLabelText('Amount')).toBeTruthy();
    expect(screen.getByTestId('matcher-operator-0')).toBeTruthy();

    await pickType(screen, 0, 'direction');

    expect(screen.queryByLabelText('Amount')).toBeNull();
    expect(screen.getByText('Expense')).toBeTruthy();
    expect(screen.getByText('Income')).toBeTruthy();

    await pickType(screen, 0, 'time');

    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.getByText('After')).toBeTruthy();
    expect(
      screen.getByText("Statement rows without a time count as noon in the statement's time zone."),
    ).toBeTruthy();
  });

  it('keeps what was typed in a row when its type is changed and changed back', async () => {
    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pickType(screen, 0, 'direction');
    await pickType(screen, 0, 'nameIs');

    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
  });
});

describe('CategoryRuleFormScreen — an existing rule', () => {
  const stored = ruleOf('mine', 'food', [
    SILPO,
    { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
  ]);

  beforeEach(() => {
    mockRules = [stored];
  });

  it('opens with the conditions of the rule, in order', async () => {
    const screen = await renderEdit('mine');

    expect(screen.getAllByLabelText('Condition')).toHaveLength(2);
    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
    expect(screen.getByLabelText('Amount').props.value).toBe('500');
    expect(screen.getByText('More than')).toBeTruthy();
    expect(screen.getAllByText('Remove')).toHaveLength(2);
  });

  it('is titled for an edit', async () => {
    await renderEdit('mine');

    expect(lastOptions().title).toBe('Edit Rule');
  });

  it('keeps the title of a new rule for a new rule', async () => {
    await renderCreate();

    expect(navigation.setOptions).not.toHaveBeenCalled();
  });

  it('saves the rule with its own id and the category it belongs to', async () => {
    const screen = await renderEdit('mine');

    await typeName(screen, 'Silpo Market');
    await pressSave(screen);

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith({
        id: 'mine',
        category: 'food',
        matchers: [
          { type: 'nameIs', text: 'Silpo Market' },
          { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
        ],
        applyToExisting: false,
      }),
    );
  });

  it('does not take what the user typed back when the rules read again', async () => {
    const screen = await renderEdit('mine');

    await typeName(screen, 'Atb');

    mockRules = [{ ...stored }];
    await act(async () => {
      await screen.rerender(formElement({ categoryKey: 'food', ruleId: 'mine' }));
    });

    expect(screen.getByLabelText('Name').props.value).toBe('Atb');
  });

  it('goes back when the rule is gone', async () => {
    mockRules = [];

    await renderEdit('mine');

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it('shows a loading state while the rules are read, and does not go back yet', async () => {
    mockRulesLoading = true;

    const { getByTestId } = await renderEdit('mine');

    expect(getByTestId('category-rule-form-loading')).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe('CategoryRuleFormScreen — a Save that is refused', () => {
  it('names a blank name under its field, saves nothing, and scrolls to it', async () => {
    const screen = await renderCreate();

    expect(screen.queryByText('Enter a name.')).toBeNull();

    await pressSave(screen);

    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(mockCountRuleRewrite).not.toHaveBeenCalled();
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(scrollToField).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['blank', ''],
    ['negative', '-5'],
    ['more decimals than the currency has', '1.005'],
    ['not a number', 'abc'],
  ])('names an amount that is %s under its field', async (_label, amount) => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'amount');
    await fireEvent.changeText(screen.getByLabelText('Amount'), amount);
    await pressSave(screen);

    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('names every refused row at once', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Add condition'));
    await pickType(screen, 1, 'amount');
    await pressSave(screen);

    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText(AMOUNT_ERROR)).toBeTruthy();
  });

  it('refuses times that can never match together, and points to two rules for a window over midnight', async () => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'time');
    await fireEvent.press(screen.getByText('Add condition'));
    await pickType(screen, 1, 'time');
    await fireEvent.press(screen.getAllByText('After')[0] as never);
    await fireEvent.press(screen.getAllByText('Before')[1] as never);
    await pressSave(screen);

    expect(
      screen.getByText(
        'These times can never match together. For a window over midnight, use two rules.',
      ),
    ).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('refuses two directions without the hint about midnight', async () => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'direction');
    await fireEvent.press(screen.getByText('Add condition'));
    await pickType(screen, 1, 'direction');
    await fireEvent.press(screen.getAllByText('Income')[1] as never);
    await pressSave(screen);

    expect(screen.getByText('These conditions can never match together.')).toBeTruthy();
    expect(screen.queryByText(/midnight/)).toBeNull();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('refuses a rule another category already has, and names that category', async () => {
    mockRules = [ruleOf('taken', 'shops', [{ type: 'nameIs', text: 'SILPO' }])];

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);

    expect(
      screen.getByText('A rule with these conditions already exists in Rozetka.'),
    ).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('clears the error once the conditions are fixed', async () => {
    mockRules = [ruleOf('taken', 'shops', [SILPO])];

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);
    await typeName(screen, 'Silpo Market');

    expect(screen.queryByText(/already exists/)).toBeNull();
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('names a seeded category by its Ukrainian title', async () => {
      mockRules = [ruleOf('taken', 'groceries', [SILPO])];

      const screen = await renderCreate();

      await fireEvent.changeText(screen.getByLabelText('Назва'), 'Silpo');
      await fireEvent.press(screen.getByText('Зберегти'));

      expect(screen.getByText('Правило з такими умовами вже є в категорії Продукти.')).toBeTruthy();
    });
  });
});

describe('CategoryRuleFormScreen — a Save that is accepted', () => {
  it('saves a rule that changes nothing at once, and goes back', async () => {
    const screen = await renderCreate();

    await typeName(screen, '  Silpo ');
    await pressSave(screen);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockSaveRule).toHaveBeenCalledWith({
      id: null,
      category: 'food',
      matchers: [SILPO],
      applyToExisting: false,
    });
    expect(screen.queryByText('Apply Rule')).toBeNull();
  });

  it('asks about the transactions a rule changes before it saves anything', async () => {
    mockCountRuleRewrite.mockResolvedValue(3);

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);

    await waitFor(() => expect(screen.getByText('This changes 3 transactions.')).toBeTruthy());
    expect(screen.getByText('Apply Rule')).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('applies the rule to the existing transactions, and goes back once the sheet has closed', async () => {
    mockCountRuleRewrite.mockResolvedValue(3);

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);
    await waitFor(() => expect(screen.getByText('Apply to existing')).toBeTruthy());

    // The Jest Modal unmounts once hidden, so the close report is read while the sheet is up.
    const closed = screen.getByTestId('rule-rewrite-sheet-modal').props.onDismiss;

    await fireEvent.press(screen.getByText('Apply to existing'));

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith(expect.objectContaining({ applyToExisting: true })),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();

    await act(async () => {
      closed();
    });

    expect(navigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('saves the rule for new transactions only', async () => {
    mockCountRuleRewrite.mockResolvedValue(3);

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);
    await waitFor(() => expect(screen.getByText('New transactions only')).toBeTruthy());
    await fireEvent.press(screen.getByText('New transactions only'));

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith(
        expect.objectContaining({ applyToExisting: false }),
      ),
    );
  });

  it('returns to the editor, with its conditions and nothing saved, when the sheet is cancelled', async () => {
    mockCountRuleRewrite.mockResolvedValue(3);

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);
    await waitFor(() => expect(screen.getByText('Cancel')).toBeTruthy());
    await fireEvent.press(screen.getByText('Cancel'));

    expect(screen.queryByText('Apply Rule')).toBeNull();
    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('saves once when Save is tapped twice', async () => {
    let resolveCount: (count: number) => void = () => {};
    mockCountRuleRewrite.mockReturnValue(
      new Promise<number>((resolve) => {
        resolveCount = resolve;
      }),
    );

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);
    await pressSave(screen);

    expect(mockCountRuleRewrite).toHaveBeenCalledTimes(1);

    resolveCount(0);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockSaveRule).toHaveBeenCalledTimes(1);
  });

  it('keeps the editor open and says so when the write fails', async () => {
    mockSaveRule.mockRejectedValueOnce(new Error('disk full'));

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(screen);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
  });
});

describe('CategoryRuleFormScreen — there is no delete here', () => {
  it('offers no way to delete the rule from its editor', async () => {
    mockRules = [ruleOf('mine', 'food', [SILPO])];

    const { queryByText } = await renderEdit('mine');

    expect(queryByText('Delete rule')).toBeNull();
    expect(queryByText('Delete')).toBeNull();
  });
});
