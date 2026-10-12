import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import type { TimeClock } from '@kiko/dates';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import type { CategoryRuleMatcher } from '@kiko/categories/category-rules';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoryDetailScreen from './category-detail.screen';

type CategoryData = { key: string; title: string; icon: string; color?: string | null };
type RuleData = {
  id: string;
  category: string;
  matchers: string;
  createdAt: number;
  updatedAt: number;
};

const mockDeleteRule = jest.fn();
const mockSetDefault = jest.fn();
let mockCategories: CategoryData[] = [];
let mockRules: RuleData[] = [];
let mockSettingsRows: Array<{ defaultCategoryKey: string }> = [];
let mockCategoriesIsLoading = false;
// `false` = the categories are still the cached rows (a cached display mount before its own fresh
// read has applied).
let mockCategoriesIsFresh = true;
let mockRulesIsLoading = false;
let mockSettingsIsLoading = false;
let mockClock: TimeClock = { uses24Hour: true };

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
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
  useLiveQuery: (_query: unknown, keys: string[]) => {
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

type DetailProps = ComponentProps<typeof CategoryDetailScreen>;

type HeaderItem = {
  type: string;
  label?: string;
  icon?: { type: string; name: string };
  onPress: () => void;
};

const navigation = navigationSpy();

const renderScreen = (categoryKey = 'groceries') =>
  render(
    <CategoryDetailScreen
      navigation={asNavigationProp<DetailProps['navigation']>(navigation)}
      route={asRouteProp<DetailProps['route']>('CategoryDetail', { categoryKey })}
    />,
    { wrapper: GestureRootWrapper },
  );

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

const lastOptions = (): { title?: string; unstable_headerRightItems?: () => HeaderItem[] } =>
  navigation.setOptions.mock.calls.at(-1)?.[0] ?? {};

const holdCard = async (): Promise<void> => {
  await act(async () => {
    fireGestureHandler(getByGestureTestId(HOLD_GESTURE_TEST_ID), [
      { state: State.BEGAN },
      { state: State.ACTIVE },
      { state: State.END },
    ]);
  });
};

const GROCERIES: CategoryData = { key: 'groceries', title: 'Groceries', icon: 'cart' };

const EMPTY_HINT = 'Add a rule to set this category on matching transactions.';

describe('CategoryDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCategories = [
      GROCERIES,
      { key: 'other', title: 'Other', icon: 'square.grid.2x2' },
      { key: 'trips', title: 'Trips', icon: 'airplane' },
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

  describe('the header', () => {
    it('is titled with the category name', async () => {
      mockCategories = [{ key: 'trips', title: 'Trips', icon: 'airplane' }];

      await renderScreen('trips');

      expect(lastOptions().title).toBe('Trips');
    });

    it('names a seeded default category by its translated title', async () => {
      await renderScreen('groceries');

      expect(lastOptions().title).toBe('Groceries');
    });

    it('offers an icon-only Edit that opens the category form with the key', async () => {
      await renderScreen('groceries');

      const items = lastOptions().unstable_headerRightItems?.() ?? [];

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: 'button',
        label: 'Edit',
        icon: { type: 'sfSymbol', name: 'pencil' },
      });

      items[0]?.onPress();

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryForm', {
        categoryKey: 'groceries',
      });
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

      it('shows a seeded default under its Ukrainian title and labels Edit in Ukrainian', async () => {
        await renderScreen('groceries');

        expect(lastOptions().title).toBe('Продукти');
        expect(lastOptions().unstable_headerRightItems?.()[0]?.label).toBe('Редагувати');
      });
    });
  });

  describe('the rules', () => {
    it('shows one card per rule of the category with its conditions on one line', async () => {
      mockRules = [
        ruleOf('silpo', 'groceries', [
          { type: 'nameIs', text: 'Silpo' },
          { type: 'direction', direction: 'expense' },
          { type: 'amount', operator: 'gt', minorUnits: 50000, currency: 'UAH' },
          { type: 'time', operator: 'after', minuteOfDay: 18 * 60 },
        ]),
      ];

      const { getAllByTestId } = await renderScreen();

      expect(getAllByTestId('rule-card')).toHaveLength(1);
      expect(getAllByTestId('rule-card')[0]).toHaveTextContent(
        'Name is "Silpo" · Expense · More than 500.00 ₴ · After 18:00',
      );
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

      const { getAllByTestId } = await renderScreen();
      const cards = getAllByTestId('rule-card');

      expect(cards).toHaveLength(3);
      expect(cards[0]).toHaveTextContent('Name is "Silpo" · Expense');
      expect(cards[1]).toHaveTextContent('Name is "Novus"');
      expect(cards[2]).toHaveTextContent('Name is "Atb"');
    });

    it('matches the category key whatever the case of the stored one', async () => {
      mockRules = [ruleOf('legacy', 'Groceries', [{ type: 'nameIs', text: 'Atb' }])];

      const { getAllByTestId } = await renderScreen();

      expect(getAllByTestId('rule-card')).toHaveLength(1);
    });

    it('shows the text as the user typed it, not the lowercased form used to match', async () => {
      mockRules = [ruleOf('typed', 'groceries', [{ type: 'nameStartsWith', text: 'SiLpO' }])];

      const { getAllByTestId } = await renderScreen();

      expect(getAllByTestId('rule-card')[0]).toHaveTextContent('Name starts with "SiLpO"');
    });

    it('shows an amount in the currency of its own scale', async () => {
      mockRules = [
        ruleOf('crypto', 'groceries', [
          { type: 'amount', operator: 'gte', minorUnits: 100000, currency: 'BTC' },
        ]),
      ];

      const { getAllByTestId } = await renderScreen();

      expect(getAllByTestId('rule-card')[0]).toHaveTextContent('At least ₿0.00100000');
    });

    it('reads a time on the 12-hour clock when the device uses it', async () => {
      mockClock = { uses24Hour: false, beforeNoon: 'AM', afterNoon: 'PM' };
      mockRules = [
        ruleOf('evening', 'groceries', [{ type: 'time', operator: 'after', minuteOfDay: 18 * 60 }]),
      ];

      const { getAllByTestId } = await renderScreen();

      expect(getAllByTestId('rule-card')[0]).toHaveTextContent('After 6:00 PM');
    });

    it('says the rule can not be read when its stored conditions are not valid', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getAllByTestId, getByText } = await renderScreen();

      expect(getAllByTestId('rule-card')).toHaveLength(1);
      expect(getByText("This rule can't be read")).toBeTruthy();
    });

    it('lists a rule that can not be read after the readable ones', async () => {
      mockRules = [
        ruleOf('broken', 'groceries', 'not json'),
        ruleOf('fine', 'groceries', [{ type: 'nameIs', text: 'Atb' }]),
      ];

      const { getAllByTestId } = await renderScreen();
      const cards = getAllByTestId('rule-card');

      expect(cards[0]).toHaveTextContent('Name is "Atb"');
      expect(cards[1]).toHaveTextContent("This rule can't be read");
    });

    it('hints at adding a rule when the category has none, and shows no card', async () => {
      mockRules = [ruleOf('elsewhere', 'trips', [{ type: 'nameIs', text: 'Wizz' }])];

      const { getByText, queryAllByTestId } = await renderScreen();

      expect(getByText(EMPTY_HINT)).toBeTruthy();
      expect(queryAllByTestId('rule-card')).toHaveLength(0);
    });

    it('shows no hint once the category has a rule', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { queryByText } = await renderScreen();

      expect(queryByText(EMPTY_HINT)).toBeNull();
    });

    it('heads the list "Rules"', async () => {
      const { getByText } = await renderScreen();

      expect(getByText('Rules')).toBeTruthy();
    });
  });

  describe('adding and opening a rule', () => {
    it('opens the rule editor for a new rule of this category from "Add rule"', async () => {
      const { getByText } = await renderScreen('groceries');

      await fireEvent.press(getByText('Add rule'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryRuleForm', {
        categoryKey: 'groceries',
      });
    });

    it('offers "Add rule" beside the rules too, not only on an empty page', async () => {
      mockRules = [ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }])];

      const { getByText } = await renderScreen();

      expect(getByText('Add rule')).toBeTruthy();
    });

    it('opens the editor for the rule that is tapped', async () => {
      mockRules = [
        ruleOf('silpo', 'groceries', [{ type: 'nameIs', text: 'Silpo' }]),
        ruleOf('atb', 'groceries', [{ type: 'nameIs', text: 'Atb' }]),
      ];

      const { getByText } = await renderScreen('groceries');

      await fireEvent.press(getByText('Name is "Atb"'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryRuleForm', {
        categoryKey: 'groceries',
        ruleId: 'atb',
      });
      expect(navigation.navigate).toHaveBeenCalledTimes(1);
    });

    it('opens nothing for a rule that can not be read, which only offers its delete', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getByText } = await renderScreen();

      await fireEvent.press(getByText("This rule can't be read"));

      expect(navigation.navigate).not.toHaveBeenCalled();
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

      it('labels the button and hints at the first rule in Ukrainian', async () => {
        const { getByText } = await renderScreen('groceries');

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

      const { getByText, getByTestId } = await renderScreen();

      await holdCard();

      expect(getByText('Delete Rule')).toBeTruthy();
      expect(mockDeleteRule).not.toHaveBeenCalled();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockDeleteRule).toHaveBeenCalledWith('silpo');
    });

    it('offers only the delete for a rule that can not be read', async () => {
      mockRules = [ruleOf('broken', 'groceries', 'not json')];

      const { getByText, getByTestId } = await renderScreen();

      await holdCard();

      expect(getByText('Delete Rule')).toBeTruthy();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockDeleteRule).toHaveBeenCalledWith('broken');
    });
  });

  describe('setting the default category', () => {
    it('sets the category as the default from a row under the rules', async () => {
      const { getByText } = await renderScreen('groceries');

      await fireEvent.press(getByText('Set as default'));

      expect(mockSetDefault).toHaveBeenCalledWith('groceries');
    });

    it('offers it on no category that is already the default', async () => {
      const { queryByText } = await renderScreen('other');

      expect(queryByText('Set as default')).toBeNull();
    });

    it('moves to the settings default when the settings change', async () => {
      mockSettingsRows = [{ defaultCategoryKey: 'groceries' }];

      const { queryByText } = await renderScreen('groceries');

      expect(queryByText('Set as default')).toBeNull();
    });
  });

  describe('a category that is gone', () => {
    it('goes back once the fresh read no longer has it', async () => {
      await renderScreen('deleted-elsewhere');

      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('does not go back on a cached read, which may be one read old', async () => {
      mockCategoriesIsFresh = false;

      const { getByTestId } = await renderScreen('just-created');

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(getByTestId('category-detail-loading')).toBeTruthy();
    });

    it('shows the page once the fresh read brings the category', async () => {
      mockCategoriesIsFresh = false;

      const { rerender, queryByTestId, getByText } = await renderScreen('just-created');

      mockCategories = [...mockCategories, { key: 'just-created', title: 'New', icon: 'tag' }];
      mockCategoriesIsFresh = true;
      await act(async () => {
        await rerender(
          <CategoryDetailScreen
            navigation={asNavigationProp<DetailProps['navigation']>(navigation)}
            route={asRouteProp<DetailProps['route']>('CategoryDetail', {
              categoryKey: 'just-created',
            })}
          />,
        );
      });

      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(queryByTestId('category-detail-loading')).toBeNull();
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

      const { getByTestId, queryByText } = await renderScreen();

      expect(getByTestId('category-detail-loading')).toBeTruthy();
      expect(queryByText(EMPTY_HINT)).toBeNull();
      expect(queryByText('Add rule')).toBeNull();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });
  });
});
