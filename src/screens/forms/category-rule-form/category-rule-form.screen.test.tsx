import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  asNavigationProp,
  asRouteProp,
  navigationSpy,
  paramsAfter,
} from '@kiko/test-support/navigation-props';
import { fieldSuffix } from '@kiko/test-support/field-suffix';
import { holdCurrencies } from '@kiko/test-support/held-currencies';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { expectNavBarSaveOnly, pressSave, saveItem } from '@kiko/test-support/form-header-items';

import { emptyMatcherDraft } from './rule-draft';
import CategoryRuleFormScreen from './category-rule-form.screen';

type CategoryData = { key: string; title: string; icon: string; color: string | null };
type AccountData = {
  id: string;
  name: string;
  kind: 'bank' | 'cash' | 'property' | 'debt';
  archivedAt: number | null;
};
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
let mockAccounts: AccountData[] = [];
let mockAccountsLoading = false;

jest.mock('@kiko/accounts', () => ({
  accountsRepo: {
    listQuery: () => ({ __kind: 'accounts', toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
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
jest.mock(
  '@kiko/holdings/use-held-currencies',
  () => jest.requireActual('@kiko/test-support/held-currencies').heldCurrenciesModule,
);
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (query: { __kind?: string }, keys: string[]) => {
    if (query.__kind === 'accounts') {
      return { data: mockAccounts, isLoading: mockAccountsLoading, isFresh: true };
    }

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

const AMOUNT_NEGATIVE_ERROR = 'Enter an amount of 0 or more.';

const pickType = async (screen: Screen, position: number, type: string): Promise<void> => {
  await fireEvent.press(screen.getByTestId(`matcher-type-${position}`));
  await fireEvent.press(screen.getByTestId(`matcher-type-${position}-option-${type}`));
};

const typeName = async (screen: Screen, text: string): Promise<void> => {
  await fireEvent.changeText(screen.getByLabelText('Name'), text);
};

const registeredTitle = (): string | undefined =>
  navigation.setOptions.mock.calls
    .map(([options]) => options)
    .filter((options) => 'title' in options)
    .at(-1)?.title;

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
  mockAccounts = [];
  mockAccountsLoading = false;
  holdCurrencies([]);
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

  it('offers Save only as the nav-bar item, enabled before anything is typed', async () => {
    const screen = await renderCreate();

    expectNavBarSaveOnly(navigation.setOptions, screen);
    expect(saveItem(navigation.setOptions)?.disabled).toBe(false);
  });

  it('offers no Save until the form has loaded', async () => {
    mockSettingsLoading = true;

    await renderCreate();

    expect(saveItem(navigation.setOptions)).toBeUndefined();
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

  it('amount currency lists the user’s currencies first', async () => {
    holdCurrencies(['USD', 'BTC']);

    const screen = await renderCreate();

    await pickType(screen, 0, 'amount');
    await fireEvent.press(screen.getByTestId('matcher-currency-0'));

    expect(
      screen
        .getAllByTestId(/^currency-(group|option)-/)
        .slice(0, 6)
        .map((row) => String(row.props.testID)),
    ).toEqual([
      'currency-group-held',
      'currency-option-BTC',
      'currency-option-USD',
      'currency-group-fiat',
      'currency-option-UAH',
      'currency-option-EUR',
    ]);
    expect(screen.getByTestId('currency-group-held')).toHaveTextContent('Your currencies');
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

  it('keeps a typed merchant code when the type of the row is changed and changed back', async () => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'mcc');
    await fireEvent.changeText(screen.getByLabelText('Merchant code (MCC)'), '5411');
    await pickType(screen, 0, 'direction');
    await pickType(screen, 0, 'mcc');

    expect(screen.getByLabelText('Merchant code (MCC)').props.value).toBe('5411');
  });
});

describe('CategoryRuleFormScreen — the rules read again after a Save', () => {
  // The write stores the rule, so the live query holds it from the next read on; `goBack` is a
  // spy here, so the form stays mounted for that read.
  const storeOnSave = (id: string | null, category: string): void => {
    mockSaveRule.mockImplementation(async () => {
      mockRules = [
        ...mockRules.filter((rule) => rule.id !== id),
        ruleOf(id ?? 'saved', category, [SILPO]),
      ];

      return { id: id ?? 'saved', changed: 0 };
    });
  };

  const rerenderAfterWrite = async (screen: Screen, ruleId?: string): Promise<void> => {
    await act(async () => {
      await screen.rerender(formElement({ categoryKey: 'food', ruleId }));
    });
  };

  it.each([
    ['a rule that changes nothing', 0, undefined],
    ['a rule applied to the existing transactions', 3, 'Apply to existing'],
    ['a rule kept for new transactions only', 3, 'New transactions only'],
  ])(
    'shows no duplicate error on a new rule once it is stored: %s',
    async (_label, count, choice) => {
      mockCountRuleRewrite.mockResolvedValue(count);
      storeOnSave(null, 'food');

      const screen = await renderCreate();

      await typeName(screen, 'Silpo');
      await pressSave(navigation.setOptions);

      if (choice !== undefined) {
        await waitFor(() => expect(screen.getByText(choice)).toBeTruthy());
        await fireEvent.press(screen.getByText(choice));
      }

      await waitFor(() => expect(mockSaveRule).toHaveBeenCalledTimes(1));
      await rerenderAfterWrite(screen);

      expect(screen.queryByText(/already exists/)).toBeNull();
    },
  );

  it('shows no duplicate error on an edited rule once it is stored', async () => {
    mockRules = [ruleOf('mine', 'food', [SILPO])];
    storeOnSave('mine', 'food');

    const screen = await renderEdit('mine');

    await typeName(screen, 'Silpo ');
    await pressSave(navigation.setOptions);
    await waitFor(() => expect(mockSaveRule).toHaveBeenCalledTimes(1));
    await rerenderAfterWrite(screen, 'mine');

    expect(screen.queryByText(/already exists/)).toBeNull();
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

    expect(registeredTitle()).toBe('Edit Rule');
  });

  it('keeps the title of a new rule for a new rule', async () => {
    await renderCreate();

    expect(registeredTitle()).toBeUndefined();
  });

  it('saves the rule with its own id and the category it belongs to', async () => {
    const screen = await renderEdit('mine');

    await typeName(screen, 'Silpo Market');
    await pressSave(navigation.setOptions);

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

    await pressSave(navigation.setOptions);

    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(mockCountRuleRewrite).not.toHaveBeenCalled();
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(scrollToField).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['UAH', '', 'blank', AMOUNT_NEGATIVE_ERROR],
    ['UAH', '-5', 'negative', AMOUNT_NEGATIVE_ERROR],
    ['UAH', 'abc', 'not a number', AMOUNT_NEGATIVE_ERROR],
    [
      'UAH',
      '1.005',
      'past the 2 decimals of the currency',
      'This currency allows up to 2 decimal places.',
    ],
    [
      'BHD',
      '1.2345',
      'past the 3 decimals of the currency',
      'This currency allows up to 3 decimal places.',
    ],
    [
      'BIF',
      '1.5',
      'a fraction of a currency without decimals',
      'For this currency, you can enter only a whole amount.',
    ],
    ['UAH', '99999999999999999999', 'too large to hold', 'This amount is too large.'],
  ])(
    'names an amount in %s that is %s with the text that fits it',
    async (baseCurrency, amount, _label, message) => {
      mockSettingsRows = [{ baseCurrency }];

      const screen = await renderCreate();

      await pickType(screen, 0, 'amount');
      await fireEvent.changeText(screen.getByLabelText('Amount'), amount);
      await pressSave(navigation.setOptions);

      expect(screen.getByText(message)).toBeTruthy();
      expect(mockSaveRule).not.toHaveBeenCalled();
    },
  );

  it('names every refused row at once', async () => {
    const screen = await renderCreate();

    await fireEvent.press(screen.getByText('Add condition'));
    await pickType(screen, 1, 'amount');
    await pressSave(navigation.setOptions);

    expect(screen.getByText('Enter a name.')).toBeTruthy();
    expect(screen.getByText(AMOUNT_NEGATIVE_ERROR)).toBeTruthy();
  });

  it('refuses times that can never match together, and points to two rules for a window over midnight', async () => {
    const screen = await renderCreate();

    await pickType(screen, 0, 'time');
    await fireEvent.press(screen.getByText('Add condition'));
    await pickType(screen, 1, 'time');
    await fireEvent.press(screen.getAllByText('After')[0] as never);
    await fireEvent.press(screen.getAllByText('Before')[1] as never);
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    expect(screen.getByText('These conditions can never match together.')).toBeTruthy();
    expect(screen.queryByText(/midnight/)).toBeNull();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('refuses a rule another category already has, and names that category', async () => {
    mockRules = [ruleOf('taken', 'shops', [{ type: 'nameIs', text: 'SILPO' }])];

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(navigation.setOptions);

    expect(
      screen.getByText('A rule with these conditions already exists in Rozetka.'),
    ).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('names a category that is gone by its raw key', async () => {
    mockRules = [ruleOf('taken', 'gone-shop', [SILPO])];

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(navigation.setOptions);

    expect(
      screen.getByText('A rule with these conditions already exists in gone-shop.'),
    ).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('clears the error once the conditions are fixed', async () => {
    mockRules = [ruleOf('taken', 'shops', [SILPO])];

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(navigation.setOptions);
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
      await pressSave(navigation.setOptions, 'Зберегти');

      expect(screen.getByText('Правило з такими умовами вже є в категорії Продукти.')).toBeTruthy();
    });
  });
});

describe('CategoryRuleFormScreen — a Save that is accepted', () => {
  it('saves a rule that changes nothing at once, and goes back', async () => {
    const screen = await renderCreate();

    await typeName(screen, '  Silpo ');
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    await waitFor(() => expect(screen.getByText('This changes 3 transactions.')).toBeTruthy());
    expect(screen.getByText('Apply Rule')).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('applies the rule to the existing transactions, and goes back once the sheet has closed', async () => {
    mockCountRuleRewrite.mockResolvedValue(3);

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(navigation.setOptions);
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
    await pressSave(navigation.setOptions);
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
    await pressSave(navigation.setOptions);
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
    await pressSave(navigation.setOptions);

    expect(saveItem(navigation.setOptions)?.disabled).toBe(true);

    // The item is disabled while the first save is pending, so the second tap is the raw handler.
    await act(async () => {
      saveItem(navigation.setOptions)?.onPress();
    });

    expect(mockCountRuleRewrite).toHaveBeenCalledTimes(1);

    resolveCount(0);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(mockSaveRule).toHaveBeenCalledTimes(1);
  });

  it('keeps the editor open and says so when the write fails', async () => {
    mockSaveRule.mockRejectedValueOnce(new Error('disk full'));

    const screen = await renderCreate();

    await typeName(screen, 'Silpo');
    await pressSave(navigation.setOptions);

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith('Could not save', 'Please try again.'),
    );
    expect(navigation.goBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
  });
});

describe('CategoryRuleFormScreen — the draft kept over a remount', () => {
  // The route the screen is opened on again after a fold: what it opened with, plus every param
  // it saved.
  const renderReopened = (opened: { categoryKey: string; ruleId?: string }) =>
    render(
      <CategoryRuleFormScreen
        navigation={asNavigationProp<FormProps['navigation']>(navigation)}
        route={asRouteProp<FormProps['route']>('CategoryRuleForm', paramsAfter(navigation, opened))}
      />,
    );

  const blurName = async (screen: Screen): Promise<void> => {
    await fireEvent(screen.getAllByLabelText('Name')[0], 'blur');
  };

  it('brings back the conditions, their types and what was typed in them', async () => {
    const first = await renderCreate();
    await typeName(first, 'Silpo');
    await fireEvent.press(first.getByText('Add condition'));
    await pickType(first, 1, 'amount');
    await fireEvent.changeText(first.getByLabelText('Amount'), '500');
    await blurName(first);
    await first.unmount();

    const second = await renderReopened({ categoryKey: 'food' });

    expect(second.getAllByLabelText('Condition')).toHaveLength(2);
    expect(second.getByLabelText('Name').props.value).toBe('Silpo');
    expect(second.getByLabelText('Amount').props.value).toBe('500');

    await pressSave(navigation.setOptions);

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith({
        id: null,
        category: 'food',
        matchers: [SILPO, { type: 'amount', operator: 'eq', minorUnits: 50000, currency: 'UAH' }],
        applyToExisting: false,
      }),
    );
  });

  it('keeps a removed condition removed', async () => {
    const first = await renderCreate();
    await typeName(first, 'Silpo');
    await fireEvent.press(first.getByText('Add condition'));
    await fireEvent.press(first.getAllByText('Remove')[1]);
    await blurName(first);
    await first.unmount();

    const second = await renderReopened({ categoryKey: 'food' });

    expect(second.getAllByLabelText('Condition')).toHaveLength(1);
    expect(second.getByLabelText('Name').props.value).toBe('Silpo');
  });

  it('keeps the draft to plain rows, with no row key', async () => {
    const screen = await renderCreate();
    await typeName(screen, 'Silpo');
    await blurName(screen);

    expect(navigation.setParams).toHaveBeenCalledWith({
      draft: { rows: [{ ...emptyMatcherDraft('UAH'), text: 'Silpo' }] },
    });
  });

  it('writes the draft once per blur, never while typing', async () => {
    const screen = await renderCreate();

    await typeName(screen, 'S');
    await typeName(screen, 'Si');
    await typeName(screen, 'Sil');

    expect(navigation.setParams).not.toHaveBeenCalled();

    await blurName(screen);

    expect(navigation.setParams).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a second blur that changed nothing', async () => {
    const screen = await renderCreate();

    await blurName(screen);
    await blurName(screen);

    expect(navigation.setParams).toHaveBeenCalledTimes(1);
  });

  it('lets the draft of an edit win over the stored rule, and still saves that rule', async () => {
    mockRules = [ruleOf('mine', 'food', [SILPO])];

    const first = await renderEdit('mine');
    await typeName(first, 'Atb');
    await blurName(first);
    await first.unmount();

    const second = await renderReopened({ categoryKey: 'food', ruleId: 'mine' });

    expect(second.getByLabelText('Name').props.value).toBe('Atb');

    await pressSave(navigation.setOptions);

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith({
        id: 'mine',
        category: 'food',
        matchers: [{ type: 'nameIs', text: 'Atb' }],
        applyToExisting: false,
      }),
    );
  });

  it('opens an edit from the stored rule when the route carries no draft', async () => {
    mockRules = [ruleOf('mine', 'food', [SILPO])];

    const screen = await renderEdit('mine');

    expect(screen.getByLabelText('Name').props.value).toBe('Silpo');
    expect(navigation.setParams).not.toHaveBeenCalled();
  });

  it('goes back from a draft of an edit when the rule is gone', async () => {
    mockRules = [ruleOf('mine', 'food', [SILPO])];

    const first = await renderEdit('mine');
    await typeName(first, 'Atb');
    await blurName(first);
    await first.unmount();
    mockRules = [];

    await renderReopened({ categoryKey: 'food', ruleId: 'mine' });

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
  });

  it('leaves no draft behind once saved: it goes back and writes nothing more', async () => {
    const screen = await renderCreate();
    await typeName(screen, 'Silpo');
    await blurName(screen);
    navigation.setParams.mockClear();

    await pressSave(navigation.setOptions);

    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
    expect(navigation.setParams).not.toHaveBeenCalled();
  });
});

describe('CategoryRuleFormScreen — an account condition', () => {
  const accountRuleOf = (accountId: string): RuleData =>
    ruleOf('mine', 'food', [{ type: 'account', accountId }]);

  const MAIN_CARD: AccountData = {
    id: 'account-1',
    name: 'Main card',
    kind: 'bank',
    archivedAt: null,
  };
  const OLD_CARD: AccountData = {
    id: 'account-2',
    name: 'Old card',
    kind: 'bank',
    archivedAt: 1000,
  };
  const CASH_WALLET: AccountData = {
    id: 'account-3',
    name: 'Cash wallet',
    kind: 'cash',
    archivedAt: null,
  };

  const openAccountPicker = async (screen: Screen, label = 'Account'): Promise<void> => {
    await fireEvent.press(screen.getByLabelText(label));
  };

  it('keeps a live account id when the accounts read lands after the rules read', async () => {
    mockRules = [accountRuleOf('account-1')];
    mockAccountsLoading = true;

    const screen = await renderEdit('mine');

    mockAccounts = [MAIN_CARD];
    mockAccountsLoading = false;
    await act(async () => {
      await screen.rerender(formElement({ categoryKey: 'food', ruleId: 'mine' }));
    });
    await pressSave(navigation.setOptions);

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith({
        id: 'mine',
        category: 'food',
        matchers: [{ type: 'account', accountId: 'account-1' }],
        applyToExisting: false,
      }),
    );
    expect(screen.queryByText('Select an account.')).toBeNull();
  });

  it('a rule on a deleted account asks for a pick on Save', async () => {
    mockRules = [accountRuleOf('gone')];
    mockAccounts = [MAIN_CARD];

    const screen = await renderEdit('mine');

    await pressSave(navigation.setOptions);

    expect(screen.getByText('Select an account.')).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('an account deleted after it was picked asks for a pick on Save', async () => {
    mockRules = [accountRuleOf('account-1')];
    mockAccounts = [MAIN_CARD, CASH_WALLET];

    const screen = await renderEdit('mine');

    mockAccounts = [CASH_WALLET];
    await act(async () => {
      await screen.rerender(formElement({ categoryKey: 'food', ruleId: 'mine' }));
    });
    await pressSave(navigation.setOptions);

    expect(screen.getByText('Select an account.')).toBeTruthy();
    expect(mockSaveRule).not.toHaveBeenCalled();
  });

  it('an archived account the row holds stays a valid pick on Save', async () => {
    mockRules = [accountRuleOf('account-2')];
    mockAccounts = [MAIN_CARD, OLD_CARD];

    const screen = await renderEdit('mine');
    await pressSave(navigation.setOptions);

    await waitFor(() =>
      expect(mockSaveRule).toHaveBeenCalledWith({
        id: 'mine',
        category: 'food',
        matchers: [{ type: 'account', accountId: 'account-2' }],
        applyToExisting: false,
      }),
    );
    expect(screen.queryByText('Select an account.')).toBeNull();
  });

  it('leaves an archived account out unless it is the row’s own', async () => {
    mockRules = [accountRuleOf('account-1')];
    mockAccounts = [MAIN_CARD, OLD_CARD, CASH_WALLET];

    const screen = await renderEdit('mine');

    await openAccountPicker(screen);

    expect(screen.getAllByText('Cash wallet').length).toBeGreaterThan(0);
    expect(screen.queryByText('Old card')).toBeNull();
  });

  it('lists an archived account when it is the row’s own', async () => {
    mockRules = [accountRuleOf('account-2')];
    mockAccounts = [MAIN_CARD, OLD_CARD, CASH_WALLET];

    const screen = await renderEdit('mine');

    await openAccountPicker(screen);

    expect(screen.getAllByText('Cash wallet').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Old card').length).toBeGreaterThan(1);
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

    it('lists the accounts by accountDisplayName, the implicit ones translated', async () => {
      mockRules = [accountRuleOf('account-1')];
      mockAccounts = [
        MAIN_CARD,
        { id: 'account-4', name: 'Properties', kind: 'property', archivedAt: null },
      ];

      const screen = await renderEdit('mine');

      await openAccountPicker(screen, 'Рахунок');

      expect(screen.getAllByText(i18n.t('accounts.implicitName.property')).length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByText('Properties')).toBeNull();
      expect(screen.getAllByText('Main card').length).toBeGreaterThan(0);
    });
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
