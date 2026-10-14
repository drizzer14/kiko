import { Alert, TextInput } from 'react-native';
import type { ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { TimeClock } from '@kiko/dates';
import { darkTheme } from '@kiko/design-system/theme';
import { holdCard } from '@kiko/test-support/hold-card';
import { genericEntitySymbol } from '@kiko/holdings/entity-symbols';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';
import { resolveCategoryColor } from '@kiko/statistics/category-breakdown';
import type { RenderedElement } from '@kiko/test-support/rendered-element';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { KIKO_CATEGORIES_ICONS } from '@kiko/design-system/components/icon-pools';
import { DELETE_CONFIRM_TEST_ID } from '@kiko/design-system/components/card-context-menu';
import { expectNavBarSaveOnly, pressSave, saveItem } from '@kiko/test-support/form-header-items';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoryFormScreen from './category-form.screen';

type CategoryData = { key: string; title: string; icon: string; color: string | null };
type RuleData = {
  id: string;
  category: string;
  matchers: string;
  createdAt: number;
  updatedAt: number;
};
type HeaderItem = {
  type: string;
  label?: string;
  icon?: { type: string; name: string };
  disabled?: boolean;
  onPress: () => void;
};

type ButtonProps = {
  variant?: string;
  icon?: string;
  children: ReactNode;
  testID?: string;
  onPress: () => void;
};

const mockButtonProps: Omit<ButtonProps, 'onPress'>[] = [];
const mockCreate = jest.fn();
const mockUpdateTitle = jest.fn();
const mockUpdateIcon = jest.fn();
const mockUpdateColor = jest.fn();
const mockDeleteRule = jest.fn();
const mockSetDefault = jest.fn();
let mockCategories: CategoryData[] = [];
let mockRules: RuleData[] = [];
let mockSettingsRows: Array<{ defaultCategoryKey: string }> = [];
let mockCategoriesIsLoading = false;
// `false` = the categories read did not apply a result of its own, as after a failed read.
let mockCategoriesIsFresh = true;
let mockRulesIsLoading = false;
let mockSettingsIsLoading = false;
let mockClock: TimeClock = { uses24Hour: true };

// The Button variant maps to a themed fill inside a react-native-unistyles `variants` block, which
// the project's Jest mock strips out of the resolved style, so the screen's wiring is proven by
// recording the props Button receives; the variant to colour contract is Button's own test.
jest.mock('@kiko/design-system/components/button', () => {
  const { Pressable, Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: (props: ButtonProps) => {
      mockButtonProps.push({
        variant: props.variant,
        icon: props.icon,
        children: props.children,
      });

      return (
        <Pressable accessibilityRole="button" testID={props.testID} onPress={props.onPress}>
          <RNText>{props.children}</RNText>
        </Pressable>
      );
    },
  };
});
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreate(...args),
    updateTitle: (...args: unknown[]) => mockUpdateTitle(...args),
    updateIcon: (...args: unknown[]) => mockUpdateIcon(...args),
    updateColor: (...args: unknown[]) => mockUpdateColor(...args),
  },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    deleteRule: (...args: unknown[]) => mockDeleteRule(...args),
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: {
    getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    setDefaultCategoryKey: (...args: unknown[]) => mockSetDefault(...args),
  },
}));
jest.mock('@kiko/i18n/use-time-clock', () => ({ useTimeClock: () => mockClock }));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, keys: string[], enabled = true) => {
    if (!enabled) {
      return { data: [], isLoading: false, isFresh: true };
    }

    if (keys?.[0] === 'settings') {
      return { data: mockSettingsRows, isLoading: mockSettingsIsLoading, isFresh: true };
    }

    if (keys?.[0] === 'category_rules') {
      return { data: mockRules, isLoading: mockRulesIsLoading, isFresh: true };
    }

    return {
      data: mockCategories,
      isLoading: mockCategoriesIsLoading,
      isFresh: mockCategoriesIsFresh,
    };
  },
}));

type FormProps = ComponentProps<typeof CategoryFormScreen>;

const navigation = navigationSpy();

const formElement = (categoryKey?: string) => (
  <CategoryFormScreen
    navigation={asNavigationProp<FormProps['navigation']>(navigation)}
    route={asRouteProp<FormProps['route']>('CategoryForm', { categoryKey })}
  />
);

const renderForm = (categoryKey?: string) =>
  render(formElement(categoryKey), { wrapper: GestureRootWrapper });

const ruleOf = (
  id: string,
  category: string,
  matchers: CategoryRuleMatcher[] | string,
  updatedAt = 1000,
): RuleData => ({
  id,
  category,
  matchers: typeof matchers === 'string' ? matchers : JSON.stringify(matchers),
  createdAt: 500,
  updatedAt,
});

// The trailing items the screen last registered, read as the native bar would.
const headerItems = (): HeaderItem[] => {
  const registrations = navigation.setOptions.mock.calls
    .map(([options]) => options)
    .filter((options) => 'unstable_headerRightItems' in options);

  return registrations.at(-1)?.unstable_headerRightItems?.({ canGoBack: false }) ?? [];
};

const headerLabels = (): Array<string | undefined> => headerItems().map((item) => item.label);

const shownTitle = (): string | undefined =>
  navigation.setOptions.mock.calls
    .map(([options]) => options)
    .filter((options) => 'title' in options)
    .at(-1)?.title;

// A rule card holds one table row per condition: the label and the value share the row.
const expectRow = (card: RenderedElement, label: string, value: string): void => {
  const row = ancestorWithStyle(within(card).getByText(label), 'justifyContent');

  expect(within(row).getByText(value)).toBeTruthy();
};

const withUkrainian = (): void => {
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
};

// The swatch the colour picker rings when a new category's form opens: the palette's own fallback
// for the placeholder key, read from the same resolver the form uses.
const openPreviewHex = resolveCategoryColor(null, 'new-category');
const openSwatchName = Object.entries(darkTheme.colors.entityColors).find(
  ([, hex]) => hex === openPreviewHex,
)?.[0];

const GROCERIES: CategoryData = {
  key: 'groceries',
  title: 'Groceries',
  icon: 'cart',
  color: darkTheme.colors.entityColors.khaki,
};
const OTHER: CategoryData = { key: 'other', title: 'Other', icon: 'square.grid.2x2', color: null };

const EMPTY_HINT = 'Add a rule to set this category on matching transactions.';

describe('CategoryFormScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue('new-key');
    mockUpdateTitle.mockResolvedValue(undefined);
    mockCategories = [
      GROCERIES,
      { key: 'trips', title: 'Trips', icon: 'airplane', color: null },
      OTHER,
    ];
    mockRules = [];
    // `other` is the seeded default catch-all.
    mockSettingsRows = [{ defaultCategoryKey: 'other' }];
    mockCategoriesIsLoading = false;
    mockCategoriesIsFresh = true;
    mockRulesIsLoading = false;
    mockSettingsIsLoading = false;
    mockClock = { uses24Hour: true };
  });

  describe('creating a category', () => {
    it('shows the name, icon and colour fields, and no delete', async () => {
      const { getByLabelText, getByText, queryByText } = await renderForm();

      expect(getByLabelText('Name')).toBeTruthy();
      expect(getByLabelText('Change Icon')).toBeTruthy();
      expect(getByText('Color')).toBeTruthy();
      expect(queryByText('Delete')).toBeNull();
    });

    it('offers Save only as the nav-bar item, not in the body', async () => {
      const utils = await renderForm();

      expectNavBarSaveOnly(navigation.setOptions, utils);
    });

    it('shows no rules section and no default star before the category exists', async () => {
      const { queryByText } = await renderForm();

      expect(queryByText('Rules')).toBeNull();
      expect(queryByText(EMPTY_HINT)).toBeNull();
      expect(queryByText('Add rule')).toBeNull();
      expect(headerLabels()).toEqual(['Save']);
    });

    it('shows no divider, since there is no rules section to divide the fields from', async () => {
      const { queryByTestId } = await renderForm();

      expect(queryByTestId('form-divider')).toBeNull();
    });

    it('leaves Save enabled before anything is typed, and checks the name on press', async () => {
      await renderForm();

      expect(saveItem(navigation.setOptions)?.disabled).toBe(false);
    });

    it('keeps the stack title, which already reads "New Category"', async () => {
      await renderForm();

      expect(navigation.setOptions).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.anything() }),
      );
    });

    it('focuses the name input on mount, deferred to the next frame, without native autoFocus', async () => {
      const focusSpy = jest.spyOn(TextInput.prototype, 'focus');

      const { getByLabelText } = await renderForm();

      await waitFor(() => expect(focusSpy).toHaveBeenCalled());
      expect(getByLabelText('Name').props.autoFocus).toBeUndefined();

      focusSpy.mockRestore();
    });

    it('offers the default new-category icon in the category picker pool', () => {
      expect(KIKO_CATEGORIES_ICONS).toContain(genericEntitySymbol.category);
    });

    it('rings a concrete default colour on open without choosing one', async () => {
      expect(openSwatchName).toBeDefined();

      const { getByLabelText } = await renderForm();

      expect(getByLabelText(`Color ${openSwatchName}`).props.accessibilityState.selected).toBe(
        true,
      );
    });

    it('moves the ring to a swatch the user taps', async () => {
      const { getByLabelText } = await renderForm();
      const pickedName = openSwatchName === 'red' ? 'blue' : 'red';

      await fireEvent.press(getByLabelText(`Color ${pickedName}`));

      expect(getByLabelText(`Color ${pickedName}`).props.accessibilityState.selected).toBe(true);
      expect(getByLabelText(`Color ${openSwatchName}`).props.accessibilityState.selected).toBe(
        false,
      );
    });

    it('saves the name with the default icon and no colour when none was picked', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), '  Travel  ');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(mockCreate).toHaveBeenCalledWith({ title: 'Travel', icon: 'tag', color: null }),
      );
    });

    it('saves the icon and the colour the user picked', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon basket'));
      await fireEvent.press(getByLabelText('Color yellow'));
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(mockCreate).toHaveBeenCalledWith({
          title: 'Travel',
          icon: 'basket',
          color: darkTheme.colors.entityColors.yellow,
        }),
      );
    });

    it('opens the screen of the category it made, in place of the form', async () => {
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith('CategoryForm', {
          categoryKey: 'new-key',
        }),
      );
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('shows a name-required error and creates nothing when Save is pressed with a blank name', async () => {
      const { findByText } = await renderForm();

      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it('refuses a whitespace-only name the same way', async () => {
      const { getByLabelText, findByText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), '   ');
      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('clears the error once a name is typed', async () => {
      const { getByLabelText, findByText, queryByText } = await renderForm();

      await pressSave(navigation.setOptions);
      expect(await findByText('Enter a name.')).toBeTruthy();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');

      expect(queryByText('Enter a name.')).toBeNull();
    });

    it('creates once even when Save is pressed twice quickly', async () => {
      let resolveCreate: (key: string) => void = () => {};
      mockCreate.mockReturnValue(
        new Promise<string>((resolve) => {
          resolveCreate = resolve;
        }),
      );
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      expect(saveItem(navigation.setOptions)?.disabled).toBe(true);

      // The bar item is disabled while the write is pending, so the second tap is the raw handler.
      await act(async () => {
        saveItem(navigation.setOptions)?.onPress();
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);

      resolveCreate('new-key');
      await waitFor(() => expect(navigation.replace).toHaveBeenCalledTimes(1));
    });

    it('alerts and stays on the form when the write fails', async () => {
      mockCreate.mockRejectedValue(new Error('disk full'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const { getByLabelText } = await renderForm();

      await fireEvent.changeText(getByLabelText('Name'), 'Travel');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
      );
      expect(navigation.replace).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });
  });

  describe('editing a category', () => {
    it('titles the screen with the category name', async () => {
      await renderForm('groceries');

      expect(shownTitle()).toBe('Groceries');
    });

    it('shows its rule cards in the body while the header holds the star, then Save', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { getAllByTestId } = await renderForm('groceries');

      expect(getAllByTestId('rule-card')).toHaveLength(1);
      expect(headerLabels()).toEqual(['Set as default', 'Save']);
    });

    it('opens with the stored name, icon and colour', async () => {
      const { getByLabelText, getByDisplayValue } = await renderForm('groceries');

      expect(getByDisplayValue('Groceries')).toBeTruthy();
      expect(
        getByLabelText('Change Icon').queryAll((node) => node.props.name === 'cart').length,
      ).toBeGreaterThan(0);
      expect(getByLabelText('Color khaki').props.accessibilityState.selected).toBe(true);
    });

    it('offers no delete', async () => {
      const { queryByText } = await renderForm('groceries');

      expect(queryByText('Delete')).toBeNull();
    });

    it('offers Save only as the nav-bar item, and it stays enabled', async () => {
      const { queryByText } = await renderForm('groceries');

      expect(saveItem(navigation.setOptions)).toMatchObject({
        label: 'Save',
        variant: 'prominent',
        disabled: false,
      });
      expect(queryByText('Save')).toBeNull();
    });

    it('saves a changed name, icon and colour through their own writes, then goes back', async () => {
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), '  Food  ');
      await fireEvent.press(getByLabelText('Change Icon'));
      await fireEvent.press(getByLabelText('Choose icon basket'));
      await fireEvent.press(getByLabelText('Color yellow'));
      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
      expect(mockUpdateIcon).toHaveBeenCalledWith('groceries', 'basket');
      expect(mockUpdateColor).toHaveBeenCalledWith(
        'groceries',
        darkTheme.colors.entityColors.yellow,
      );
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('writes only what changed', async () => {
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
      expect(mockUpdateIcon).not.toHaveBeenCalled();
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing changed', async () => {
      await renderForm('groceries');

      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(mockUpdateIcon).not.toHaveBeenCalled();
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('saves no colour for a category that has none and whose colour was not picked', async () => {
      await renderForm('trips');

      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('refuses a blank name and writes nothing', async () => {
      const { getByLabelText, findByText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), '   ');
      await pressSave(navigation.setOptions);

      expect(await findByText('Enter a name.')).toBeTruthy();
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('alerts and stays on the form when a write fails', async () => {
      mockUpdateTitle.mockRejectedValue(new Error('disk full'));
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await pressSave(navigation.setOptions);

      await waitFor(() =>
        expect(alertSpy).toHaveBeenCalledWith('Could not save', 'Please try again.'),
      );
      expect(navigation.goBack).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('disables Save until the category has loaded', async () => {
      mockCategories = [];
      mockCategoriesIsLoading = true;
      await renderForm('groceries');

      expect(saveItem(navigation.setOptions)?.disabled).toBe(true);
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('enables Save once the category has loaded', async () => {
      mockCategories = [];
      mockCategoriesIsLoading = true;
      const { rerender } = await renderForm('groceries');

      mockCategories = [GROCERIES];
      mockCategoriesIsLoading = false;
      await act(async () => {
        await rerender(formElement('groceries'));
      });

      expect(saveItem(navigation.setOptions)?.disabled).toBe(false);
    });

    it('writes only what the user changed, not a field a restore changed under the form', async () => {
      const { getByLabelText, rerender } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      mockCategories = [
        { ...GROCERIES, icon: 'basket', color: darkTheme.colors.entityColors.yellow },
      ];
      await act(async () => {
        await rerender(formElement('groceries'));
      });
      await pressSave(navigation.setOptions);

      await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
      expect(mockUpdateTitle).toHaveBeenCalledWith('groceries', 'Food');
      expect(mockUpdateIcon).not.toHaveBeenCalled();
      expect(mockUpdateColor).not.toHaveBeenCalled();
    });

    it('keeps the user’s edits when the category refreshes', async () => {
      const { getByLabelText, getByDisplayValue, rerender } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      mockCategories = [{ ...GROCERIES, title: 'Groceries again' }];
      await act(async () => {
        await rerender(formElement('groceries'));
      });

      expect(getByDisplayValue('Food')).toBeTruthy();
    });

    describe('under the uk language', () => {
      withUkrainian();

      it('shows a seeded default under its Ukrainian title and does not rename it unless edited', async () => {
        const { getByDisplayValue } = await renderForm('groceries');

        expect(shownTitle()).toBe('Продукти');
        expect(getByDisplayValue('Продукти')).toBeTruthy();

        await pressSave(navigation.setOptions, 'Зберегти');

        await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(1));
        expect(mockUpdateTitle).not.toHaveBeenCalled();
      });
    });
  });

  describe('the rules', () => {
    it('shows one card per rule of the category with its conditions as label/value rows', async () => {
      mockRules = [
        ruleOf('silpo', 'groceries', [
          { type: 'nameIs', text: 'Silpo' },
          { type: 'direction', direction: 'expense' },
          { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
          { type: 'time', operator: 'after', minuteOfDay: 18 * 60 },
        ]),
      ];

      const { getAllByTestId } = await renderForm('groceries');

      expect(getAllByTestId('rule-card')).toHaveLength(1);
      const card = getAllByTestId('rule-card')[0] as RenderedElement;

      expectRow(card, 'Name is', '"Silpo"');
      expectRow(card, 'Type', 'Expense');
      expectRow(card, 'Amount is more than', '500.00 ₴');
      expectRow(card, 'Time is after', '18:00');
    });

    it('lists the rules in the order that decides, the strongest first, and only this category', async () => {
      mockRules = [
        ruleOf('older-single', 'groceries', [{ type: 'nameIs', text: 'Atb' }], 1000),
        ruleOf('elsewhere', 'trips', [{ type: 'nameIs', text: 'Wizz' }], 9000),
        ruleOf('newer-single', 'groceries', [{ type: 'nameIs', text: 'Novus' }], 2000),
        ruleOf(
          'double',
          'groceries',
          [
            { type: 'nameIs', text: 'Silpo' },
            { type: 'direction', direction: 'expense' },
          ],
          500,
        ),
      ];

      const { getAllByTestId } = await renderForm('groceries');
      const cards = getAllByTestId('rule-card');

      expect(cards).toHaveLength(3);
      expectRow(cards[0] as RenderedElement, 'Name is', '"Silpo"');
      expectRow(cards[0] as RenderedElement, 'Type', 'Expense');
      expectRow(cards[1] as RenderedElement, 'Name is', '"Novus"');
      expectRow(cards[2] as RenderedElement, 'Name is', '"Atb"');
    });

    it('matches the category key whatever the case of the stored one', async () => {
      mockRules = [ruleOf('legacy', 'Groceries', [{ type: 'nameIs', text: 'Atb' }])];

      const { getAllByTestId } = await renderForm('groceries');

      expect(getAllByTestId('rule-card')).toHaveLength(1);
    });

    it('shows the text as the user typed it, not the lowercased form used to match', async () => {
      mockRules = [ruleOf('typed', 'groceries', [{ type: 'nameStartsWith', text: 'SiLpO' }])];

      const { getAllByTestId } = await renderForm('groceries');

      expectRow(getAllByTestId('rule-card')[0] as RenderedElement, 'Name starts with', '"SiLpO"');
    });

    it('shows an amount in the currency of its own scale', async () => {
      mockRules = [
        ruleOf('crypto', 'groceries', [
          { type: 'amount', operator: 'gte', minorUnits: 100000, currency: 'BTC' },
        ]),
      ];

      const { getAllByTestId } = await renderForm('groceries');

      expectRow(
        getAllByTestId('rule-card')[0] as RenderedElement,
        'Amount is at least',
        '₿0.00100000',
      );
    });

    it('reads a time on the 12-hour clock when the device uses it', async () => {
      mockClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };
      mockRules = [
        ruleOf('evening', 'groceries', [{ type: 'time', operator: 'after', minuteOfDay: 18 * 60 }]),
      ];

      const { getAllByTestId } = await renderForm('groceries');

      expectRow(getAllByTestId('rule-card')[0] as RenderedElement, 'Time is after', '6:00 PM');
    });

    it('says the rule can not be read when its stored conditions are not valid', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getAllByTestId, getByText } = await renderForm('groceries');

      expect(getAllByTestId('rule-card')).toHaveLength(1);
      expect(getByText("This rule can't be read")).toBeTruthy();
    });

    it('lists a rule that can not be read after the readable ones', async () => {
      mockRules = [
        ruleOf('broken', 'groceries', 'not json'),
        ruleOf('fine', 'groceries', [{ type: 'nameIs', text: 'Atb' }]),
      ];

      const { getAllByTestId } = await renderForm('groceries');
      const cards = getAllByTestId('rule-card');

      expectRow(cards[0] as RenderedElement, 'Name is', '"Atb"');
      expect(cards[1]).toHaveTextContent("This rule can't be read");
    });

    it('hints at adding a rule when the category has none, and shows no card', async () => {
      mockRules = [ruleOf('elsewhere', 'trips', [{ type: 'nameIs', text: 'Wizz' }])];

      const { getByText, queryAllByTestId } = await renderForm('groceries');

      expect(getByText(EMPTY_HINT)).toBeTruthy();
      expect(queryAllByTestId('rule-card')).toHaveLength(0);
    });

    it('shows no hint once the category has a rule', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { queryByText } = await renderForm('groceries');

      expect(queryByText(EMPTY_HINT)).toBeNull();
    });

    it('heads the list "Rules"', async () => {
      const { getByText } = await renderForm('groceries');

      expect(getByText('Rules')).toBeTruthy();
    });

    it('divides the name, icon and colour fields from the rules with one divider', async () => {
      const { getAllByTestId } = await renderForm('groceries');

      expect(getAllByTestId('form-divider')).toHaveLength(1);
    });

    describe('under the uk language', () => {
      withUkrainian();

      it('labels the amount and time rows with their subject in Ukrainian', async () => {
        mockRules = [
          ruleOf('evening', 'groceries', [
            { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
            { type: 'time', operator: 'after', minuteOfDay: 18 * 60 },
          ]),
        ];

        const { getAllByTestId } = await renderForm('groceries');
        const card = getAllByTestId('rule-card')[0] as RenderedElement;

        expect(within(card).getByText('Сума більша ніж')).toBeTruthy();
        expectRow(card, 'Час після', '18:00');
      });
    });
  });

  describe('adding and opening a rule', () => {
    it('opens the rule editor for a new rule of this category from "Add rule"', async () => {
      const { getByText } = await renderForm('groceries');

      await fireEvent.press(getByText('Add rule'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryRuleForm', {
        categoryKey: 'groceries',
      });
    });

    it('offers "Add rule" beside the rules too, not only on an empty page', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { getByText } = await renderForm('groceries');

      expect(getByText('Add rule')).toBeTruthy();
    });

    it('leads "Add rule" with the rule symbol as the lone secondary action of the footer', async () => {
      const { getByTestId } = await renderForm('groceries');
      const addRuleProps = mockButtonProps.filter((props) => props.children === 'Add rule');

      expect(addRuleProps.length).toBeGreaterThan(0);

      for (const props of addRuleProps) {
        expect(props.variant).toBe('secondaryTonal');
        expect(props.icon).toBe(genericEntitySymbol.rule);
      }

      expect(within(getByTestId('screen-footer')).getAllByRole('button')).toHaveLength(1);
    });

    it('opens the editor for the rule that is tapped', async () => {
      mockRules = [
        ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }]),
        ruleOf('atb', 'groceries', [{ type: 'nameIs', text: 'Atb' }]),
      ];

      const { getByText } = await renderForm('groceries');

      await fireEvent.press(getByText('"Atb"'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryRuleForm', {
        categoryKey: 'groceries',
        ruleId: 'atb',
      });
      expect(navigation.navigate).toHaveBeenCalledTimes(1);
    });

    it('keeps the typed name when a rule card is tapped', async () => {
      mockRules = [ruleOf('atb', 'groceries', [{ type: 'nameIs', text: 'Atb' }])];

      const { getByText, getByLabelText, getByDisplayValue } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await fireEvent.press(getByText('"Atb"'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryRuleForm', {
        categoryKey: 'groceries',
        ruleId: 'atb',
      });
      expect(getByDisplayValue('Food')).toBeTruthy();
      expect(mockUpdateTitle).not.toHaveBeenCalled();
    });

    it('keeps the typed name when "Add rule" is pressed', async () => {
      const { getByText, getByLabelText, getByDisplayValue } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      await fireEvent.press(getByText('Add rule'));

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
      expect(getByDisplayValue('Food')).toBeTruthy();
    });

    it('opens nothing for a rule that can not be read, which only offers its delete', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getByText } = await renderForm('groceries');

      await fireEvent.press(getByText("This rule can't be read"));

      expect(navigation.navigate).not.toHaveBeenCalled();
    });

    describe('under the uk language', () => {
      withUkrainian();

      it('labels the button and hints at the first rule in Ukrainian', async () => {
        const { getByText } = await renderForm('groceries');

        expect(getByText('Додати правило')).toBeTruthy();
        expect(
          getByText('Додайте правило, щоб ставити цю категорію відповідним транзакціям.'),
        ).toBeTruthy();
      });
    });
  });

  describe('deleting a rule', () => {
    it('asks first, under a title of its own, and deletes only that rule once confirmed', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { getByText, getByTestId } = await renderForm('groceries');

      await holdCard();

      expect(getByText('Delete Rule')).toBeTruthy();
      expect(mockDeleteRule).not.toHaveBeenCalled();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockDeleteRule).toHaveBeenCalledWith('silpo');
    });

    it('offers only the delete for a rule that can not be read', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getByText, getByTestId } = await renderForm('groceries');

      await holdCard();

      expect(getByText('Delete Rule')).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockDeleteRule).toHaveBeenCalledWith('broken');
    });
  });

  describe('setting the default category', () => {
    it('offers the outline star, then Save, as native header buttons', async () => {
      await renderForm('groceries');

      expect(headerItems().map((item) => [item.type, item.label, item.icon?.name])).toEqual([
        ['button', 'Set as default', 'star'],
        ['button', 'Save', undefined],
      ]);
    });

    it('sets the category as the default at once from the star, without saving the form', async () => {
      const { getByLabelText } = await renderForm('groceries');

      await fireEvent.changeText(getByLabelText('Name'), 'Food');
      headerItems()[0]?.onPress();

      expect(mockSetDefault).toHaveBeenCalledWith('groceries');
      expect(mockUpdateTitle).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('shows the default category as a disabled filled star', async () => {
      await renderForm('other');

      expect(headerItems()[0]).toMatchObject({
        type: 'button',
        label: 'Default category',
        icon: { type: 'sfSymbol', name: 'star.fill' },
        disabled: true,
      });
      expect(headerLabels()).toEqual(['Default category', 'Save']);
    });

    it('moves from the outline to the filled star when the settings change', async () => {
      const { rerender } = await renderForm('groceries');

      expect(headerItems()[0]).toMatchObject({ label: 'Set as default', icon: { name: 'star' } });

      mockSettingsRows = [{ defaultCategoryKey: 'groceries' }];
      await act(async () => {
        await rerender(formElement('groceries'));
      });

      expect(headerItems()[0]).toMatchObject({
        label: 'Default category',
        icon: { name: 'star.fill' },
        disabled: true,
      });
    });

    it('adds the star only once the settings are read, so the fallback default never shows', async () => {
      mockSettingsIsLoading = true;
      mockSettingsRows = [];
      const { rerender } = await renderForm('other');

      expect(headerLabels()).toEqual(['Save']);

      mockSettingsIsLoading = false;
      mockSettingsRows = [{ defaultCategoryKey: 'groceries' }];
      await act(async () => {
        await rerender(formElement('other'));
      });

      expect(headerLabels()).toEqual(['Set as default', 'Save']);
    });

    it('adds no star while the category is not read, so it never writes a default it could not see', async () => {
      mockCategories = [];
      mockCategoriesIsFresh = false;
      await renderForm('groceries');

      expect(headerLabels()).toEqual(['Save']);
    });

    it('adds no star for a category the fresh read no longer has', async () => {
      await renderForm('deleted-elsewhere');

      expect(headerLabels()).toEqual(['Save']);
    });

    it('keeps the action out of the body', async () => {
      const { queryByText } = await renderForm('groceries');

      expect(queryByText('Set as default')).toBeNull();
    });

    describe('under the uk language', () => {
      withUkrainian();

      it('labels the star in Ukrainian, as the action and as the state', async () => {
        await renderForm('groceries');

        expect(headerItems()[0]?.label).toBe('Зробити типовою');

        await renderForm('other');

        expect(headerItems()[0]?.label).toBe('Типова категорія');
      });
    });
  });

  describe('a category that is gone', () => {
    it('goes back once the fresh read no longer has it', async () => {
      await renderForm('deleted-elsewhere');

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('does not go back on a read that is not fresh, as after a failed read', async () => {
      mockCategoriesIsFresh = false;

      const { getByTestId } = await renderForm('just-created');

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(getByTestId('category-form-loading')).toBeTruthy();
    });

    it('shows the screen once the fresh read brings the category', async () => {
      mockCategoriesIsFresh = false;

      const { rerender, queryByTestId, getByText } = await renderForm('just-created');

      mockCategories = [
        ...mockCategories,
        { key: 'just-created', title: 'New', icon: 'tag', color: null },
      ];
      mockCategoriesIsFresh = true;
      await act(async () => {
        await rerender(formElement('just-created'));
      });

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(queryByTestId('category-form-loading')).toBeNull();
      expect(getByText(EMPTY_HINT)).toBeTruthy();
    });
  });

  describe('while a query is on its first load', () => {
    it.each([
      ['categories', () => (mockCategoriesIsLoading = true)],
      ['rules', () => (mockRulesIsLoading = true)],
      ['settings', () => (mockSettingsIsLoading = true)],
    ])('shows the loading state, not the empty hint, while the %s load', async (_name, load) => {
      load();

      const { getByTestId, queryByText } = await renderForm('groceries');

      expect(getByTestId('category-form-loading')).toBeTruthy();
      expect(queryByText(EMPTY_HINT)).toBeNull();
      expect(queryByText('Add rule')).toBeNull();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });
  });
});
