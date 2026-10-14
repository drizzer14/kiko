import type { ComponentProps } from 'react';
import { State } from 'react-native-gesture-handler';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import {
  DELETE_CONFIRM_TEST_ID,
  HOLD_GESTURE_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { SEEDED_CATEGORIES } from '@kiko/db/__fixtures__/seeded-categories';
import { dropCard, type LiftableGrid, liftCard } from '@kiko/test-support/lift-grid-card';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import CategoriesScreen from './categories.screen';

type CategoryData = { key: string; title: string; icon: string; color?: string | null };
type RuleData = { id: string; category: string; matchers: string };

const mockDelete = jest.fn();
const mockReorder = jest.fn();
const mockCountRules = jest.fn<Promise<number>, [string]>();
const mockCountTemplates = jest.fn<Promise<number>, [string]>();
let mockCategories: CategoryData[] = [];
let mockRules: RuleData[] = [];
let mockSettingsRows: Array<{ defaultCategoryKey: string }> = [];
let mockCategoriesIsLoading = false;
// `false` = the categories are still the cached rows (a cached display mount before its own fresh
// read has applied).
let mockCategoriesIsFresh = true;
let mockRulesIsLoading = false;
let mockSettingsIsLoading = false;

jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    delete: (...args: unknown[]) => mockDelete(...args),
    reorder: (...args: unknown[]) => mockReorder(...args),
  },
}));
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
    countRulesOfCategory: (key: string) => mockCountRules(key),
  },
}));
jest.mock('@kiko/transaction-templates/repo', () => ({
  transactionTemplatesRepo: {
    countReferencingCategory: (key: string) => mockCountTemplates(key),
  },
}));
jest.mock('@kiko/settings/settings.repo', () => ({
  settingsRepo: { getQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, keys: string[]) => {
    if (keys?.[0] === 'settings') {
      return { data: mockSettingsRows, isLoading: mockSettingsIsLoading };
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

type CategoriesProps = ComponentProps<typeof CategoriesScreen>;

const navigation = navigationSpy();

const screenElement = () => (
  <CategoriesScreen
    navigation={asNavigationProp<CategoriesProps['navigation']>(navigation)}
    route={asRouteProp<CategoriesProps['route']>('Categories')}
  />
);

const renderScreen = () => render(screenElement(), { wrapper: GestureRootWrapper });

const ruleOf = (id: string, category: string): RuleData => ({ id, category, matchers: '[]' });

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

describe('CategoriesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCountRules.mockResolvedValue(0);
    mockCountTemplates.mockResolvedValue(0);
    mockCategories = SEEDED_CATEGORIES.map((category) => ({ ...category }));
    mockRules = [];
    // `other` is the seeded default catch-all.
    mockSettingsRows = [{ defaultCategoryKey: 'other' }];
    mockCategoriesIsLoading = false;
    mockCategoriesIsFresh = true;
    mockRulesIsLoading = false;
    mockSettingsIsLoading = false;
  });

  describe('the cards', () => {
    it('shows a card for every category in the stored order, each with its title', async () => {
      const { getAllByTestId } = await renderScreen();
      const cards = getAllByTestId('category-card');

      expect(cards).toHaveLength(SEEDED_CATEGORIES.length);
      SEEDED_CATEGORIES.forEach((category, index) => {
        expect(cards[index]).toHaveTextContent(new RegExp(category.title));
      });
    });

    it('draws each card with the icon of its category', async () => {
      mockCategories = [GROCERIES];

      const { getByTestId } = await renderScreen();

      expect(
        getByTestId('entity-icon-tile').queryAll((node) => node.props.name === 'cart').length,
      ).toBeGreaterThan(0);
    });

    it('counts the rules of each category, whatever the case of the stored key', async () => {
      mockCategories = [GROCERIES, { key: 'dining', title: 'Dining', icon: 'fork.knife' }];
      mockRules = [
        ruleOf('r1', 'groceries'),
        ruleOf('r2', 'Groceries'),
        ruleOf('r3', 'groceries'),
        ruleOf('r4', 'dining'),
      ];

      const { getAllByTestId } = await renderScreen();
      const [groceries, dining] = getAllByTestId('category-card');

      expect(groceries).toHaveTextContent(/3 rules/);
      expect(dining).toHaveTextContent(/1 rule(?!s)/);
    });

    it('says "No rules" for a category without rules', async () => {
      mockCategories = [GROCERIES];

      const { getByText } = await renderScreen();

      expect(getByText('No rules')).toBeTruthy();
    });

    it('marks the default category from the settings and no other', async () => {
      mockSettingsRows = [{ defaultCategoryKey: 'dining' }];

      const { getAllByLabelText, getAllByTestId, queryByText } = await renderScreen();

      expect(getAllByLabelText('Default')).toHaveLength(1);
      expect(within(getAllByTestId('category-card')[1]).getByLabelText('Default').props.name).toBe(
        'star.fill',
      );
      expect(queryByText('Default')).toBeNull();
    });

    it('falls back to the seeded default when the settings row is missing', async () => {
      mockSettingsRows = [];

      const { getAllByTestId } = await renderScreen();
      const otherIndex = SEEDED_CATEGORIES.findIndex((category) => category.key === 'other');

      expect(
        within(getAllByTestId('category-card')[otherIndex]).getByLabelText('Default'),
      ).toBeTruthy();
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

      it('names a seeded category by its translated title and says the rule count in the right plural form', async () => {
        mockCategories = [
          GROCERIES,
          { key: 'a', title: 'A', icon: 'tag' },
          { key: 'b', title: 'B', icon: 'tag' },
          { key: 'c', title: 'C', icon: 'tag' },
          { key: 'd', title: 'D', icon: 'tag' },
        ];
        mockRules = [
          ruleOf('g1', 'groceries'),
          ...['a1', 'a2'].map((id) => ruleOf(id, 'a')),
          ...['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => ruleOf(id, 'b')),
          ...Array.from({ length: 21 }, (_, index) => ruleOf(`c${index}`, 'c')),
        ];

        const { getAllByTestId } = await renderScreen();
        const [groceries, two, five, twentyOne, none] = getAllByTestId('category-card');

        expect(groceries).toHaveTextContent(/Продукти/);
        expect(groceries).toHaveTextContent(/1 правило/);
        expect(two).toHaveTextContent(/2 правила/);
        expect(five).toHaveTextContent(/5 правил/);
        expect(twentyOne).toHaveTextContent(/21 правило/);
        expect(none).toHaveTextContent(/Немає правил/);
      });

      it('labels the default category star with the Ukrainian word', async () => {
        const { getAllByLabelText } = await renderScreen();

        expect(getAllByLabelText('Типова')).toHaveLength(1);
      });
    });
  });

  describe('opening a category', () => {
    it('opens the category screen with its key when a card is tapped', async () => {
      mockCategories = [GROCERIES];

      const { getByText } = await renderScreen();

      await fireEvent.press(getByText('Groceries'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryForm', {
        categoryKey: 'groceries',
      });
    });

    it('does not open a card that a hold lifted', async () => {
      mockCategories = [GROCERIES];

      const { getByText, getByTestId } = await renderScreen();

      await liftCard(getByTestId('sortable-grid') as LiftableGrid, 'groceries');
      await fireEvent.press(getByText('Groceries'));

      expect(navigation.navigate).not.toHaveBeenCalled();

      await dropCard(getByTestId('sortable-grid') as LiftableGrid, 'groceries');
      await fireEvent.press(getByText('Groceries'));

      expect(navigation.navigate).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleting a category', () => {
    it('offers the delete on a hold, named by the displayed title', async () => {
      mockCategories = [GROCERIES];

      const { getByText } = await renderScreen();

      await holdCard();

      expect(getByText('Delete "Groceries"')).toBeTruthy();
    });

    it('names the rules the delete takes with it, read for that category', async () => {
      mockCategories = [GROCERIES];
      mockCountRules.mockResolvedValue(3);

      const { getByText } = await renderScreen();

      await holdCard();

      expect(mockCountRules).toHaveBeenCalledWith('groceries');
      expect(getByText('Its 3 rules will be deleted too.')).toBeTruthy();
    });

    it('says "rule" for a single rule', async () => {
      mockCategories = [GROCERIES];
      mockCountRules.mockResolvedValue(1);

      const { getByText } = await renderScreen();

      await holdCard();

      expect(getByText('Its 1 rule will be deleted too.')).toBeTruthy();
    });

    it('names the templates the delete clears the category in, below the rules, read for that category', async () => {
      mockCategories = [GROCERIES];
      mockCountRules.mockResolvedValue(3);
      mockCountTemplates.mockResolvedValue(2);

      const { getByText } = await renderScreen();

      await holdCard();

      expect(mockCountTemplates).toHaveBeenCalledWith('groceries');
      expect(
        getByText('Its 3 rules will be deleted too.\nThis also clears it in 2 templates.'),
      ).toBeTruthy();
    });

    it('still says the templates are cleared when the template count cannot be read', async () => {
      mockCategories = [GROCERIES];
      mockCountRules.mockResolvedValue(3);
      mockCountTemplates.mockRejectedValue(new Error('read failed'));

      const { getByText, getByTestId } = await renderScreen();

      await holdCard();

      expect(getByText('Delete "Groceries"')).toBeTruthy();
      expect(
        getByText('Its 3 rules will be deleted too.\nThis also clears it in its templates.'),
      ).toBeTruthy();
      expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
    });

    it('keeps the confirm to its title when the category has no rules', async () => {
      mockCategories = [GROCERIES];

      const { getByText, queryByText } = await renderScreen();

      await holdCard();

      expect(getByText('Delete "Groceries"')).toBeTruthy();
      expect(queryByText(/will be deleted too/)).toBeNull();
    });

    it('still says the rules go too when the rule count cannot be read', async () => {
      mockCategories = [GROCERIES];
      mockCountRules.mockRejectedValue(new Error('read failed'));

      const { getByText, getByTestId } = await renderScreen();

      await holdCard();

      expect(getByText('Delete "Groceries"')).toBeTruthy();
      expect(getByText('Its rules will be deleted too.')).toBeTruthy();
      expect(getByTestId(DELETE_CONFIRM_TEST_ID)).toBeTruthy();
    });

    it('gives the card caption and the confirm the same count for a stored key of another case', async () => {
      mockCategories = [GROCERIES];
      mockRules = [ruleOf('r1', 'groceries'), ruleOf('r2', 'GROCERIES')];
      mockCountRules.mockResolvedValue(2);

      const { getByText, getByTestId } = await renderScreen();

      expect(getByTestId('category-card')).toHaveTextContent(/2 rules/);

      await holdCard();

      expect(mockCountRules).toHaveBeenCalledWith('groceries');
      expect(getByText('Its 2 rules will be deleted too.')).toBeTruthy();
    });

    it('deletes the category only when the confirm is pressed', async () => {
      mockCategories = [GROCERIES];

      const { getByTestId } = await renderScreen();

      await holdCard();

      expect(mockDelete).not.toHaveBeenCalled();

      await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

      expect(mockDelete).toHaveBeenCalledWith('groceries');
    });

    it('offers no delete on the default category', async () => {
      mockCategories = [{ key: 'other', title: 'Other', icon: 'square.grid.2x2' }];

      await renderScreen();

      expect(() => getByGestureTestId(HOLD_GESTURE_TEST_ID)).toThrow();
    });
  });

  describe('reordering', () => {
    it('persists the new order when a card is dragged to another slot', async () => {
      const { getByTestId } = await renderScreen();
      const keys = SEEDED_CATEGORIES.map((category) => category.key);
      const reordered = [keys[1], keys[0], ...keys.slice(2)];

      await act(async () => {
        getByTestId('sortable-grid').props.onDragEnd({
          key: keys[1],
          fromIndex: 1,
          toIndex: 0,
          indexToKey: reordered,
        });
      });

      expect(mockReorder).toHaveBeenCalledWith(reordered);
    });

    it('persists nothing for a hold released in place', async () => {
      const { getByTestId } = await renderScreen();

      await act(async () => {
        getByTestId('sortable-grid').props.onDragEnd({
          key: 'groceries',
          fromIndex: 0,
          toIndex: 0,
          indexToKey: SEEDED_CATEGORIES.map((category) => category.key),
        });
      });

      expect(mockReorder).not.toHaveBeenCalled();
    });

    it('allows a drag only once the fresh read applied, a lone card included', async () => {
      const fresh = await renderScreen();

      expect(fresh.getByTestId('sortable-grid').props.sortEnabled).toBe(true);
      await fresh.unmount();

      mockCategoriesIsFresh = false;
      const cached = await renderScreen();

      expect(cached.getByTestId('sortable-grid').props.sortEnabled).toBe(false);
      await cached.unmount();

      mockCategoriesIsFresh = true;
      mockCategories = [GROCERIES];
      const single = await renderScreen();

      expect(single.getByTestId('sortable-grid').props.sortEnabled).toBe(true);
    });

    it('lays the cards out as one column, like the Accounts list', async () => {
      const { getByTestId } = await renderScreen();

      expect(getByTestId('sortable-grid').props.columns).toBe(1);
      expect(getByTestId('sortable-grid').props.overDrag).toBe('vertical');
    });
  });

  describe('adding a category', () => {
    it('opens the category form without a key from the footer', async () => {
      const { getByText } = await renderScreen();

      await fireEvent.press(getByText('Add category'));

      expect(navigation.navigate).toHaveBeenCalledWith('CategoryForm', {});
    });

    it('leads the footer "Add category" action with the category tag glyph', async () => {
      const { getByTestId } = await renderScreen();

      const glyphs = getByTestId('add-category-footer').queryAll(
        (node) => node.props.name === 'tag',
      );

      expect(glyphs.length).toBeGreaterThan(0);
    });
  });

  describe('while a query is on its first load', () => {
    it.each([
      ['categories', () => (mockCategoriesIsLoading = true)],
      ['rules', () => (mockRulesIsLoading = true)],
      ['settings', () => (mockSettingsIsLoading = true)],
    ])('shows the loading state and no card while the %s are loading', async (_name, load) => {
      load();

      const { getByTestId, queryAllByTestId } = await renderScreen();

      expect(getByTestId('categories-loading')).toBeTruthy();
      expect(queryAllByTestId('category-card')).toHaveLength(0);
    });
  });
});
