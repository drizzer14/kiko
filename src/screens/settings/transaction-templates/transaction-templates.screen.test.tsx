import type { ComponentProps } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';
import { holdCard } from '@kiko/test-support/hold-card';
import {
  DELETE_ACTION_TEST_ID,
  DELETE_CONFIRM_TEST_ID,
  EDIT_ACTION_TEST_ID,
} from '@kiko/design-system/components/card-context-menu';
import GestureRootWrapper from '@kiko/test-support/gesture-root-wrapper';
import { transactionTemplatesRepo } from '@kiko/transaction-templates/repo';
import { EMPTY_DRAFT, type TemplateDraft } from '@kiko/transaction-templates/draft';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TransactionTemplatesScreen from '.';

type ScreenProps = ComponentProps<typeof TransactionTemplatesScreen>;

const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

const draftOf = (overrides: Partial<TemplateDraft> = {}): TemplateDraft => ({
  ...EMPTY_DRAFT,
  ...overrides,
});

const templateRow = (id: string, name: string, draft: TemplateDraft, createdAt = 1) => ({
  id,
  name,
  draft,
  createdAt,
  updatedAt: createdAt,
});

const RENT = templateRow(
  't-rent',
  'Rent',
  draftOf({
    holdingId: 'h-wallet',
    currency: 'UAH',
    amountMinorUnits: 1250000,
    category: 'groceries',
  }),
  1,
);
const SALARY = templateRow('t-salary', 'Salary', draftOf({ mode: 'income' }), 2);

type Seed = {
  templates?: ReturnType<typeof templateRow>[];
  isLoading?: Partial<Record<string, boolean>>;
  extraCategories?: { key: string; title: string; icon: string; color: string }[];
};

const seed = ({ templates = [], isLoading = {}, extraCategories = [] }: Seed = {}): void => {
  const byTable: Record<string, unknown[]> = {
    transaction_templates: templates,
    holdings: [{ id: 'h-wallet', name: 'Wallet', type: 'cash', currency: 'UAH' }],
    categories: [
      { key: 'groceries', title: 'Groceries', icon: 'cart', color: '#FFCC00' },
      ...extraCategories,
    ],
  };

  mockUseLiveQuery.mockImplementation((_query: unknown, tables: string[]) => ({
    data: byTable[tables[0]] ?? [],
    isLoading: isLoading[tables[0]] ?? false,
    isFresh: true,
  }));
};

let navigation = navigationSpy();

const renderScreen = () =>
  render(
    <TransactionTemplatesScreen
      navigation={asNavigationProp<ScreenProps['navigation']>(navigation)}
      route={asRouteProp<ScreenProps['route']>('TransactionTemplates')}
    />,
    { wrapper: GestureRootWrapper },
  );

const EMPTY_TITLE = 'No templates yet';

beforeEach(() => {
  navigation = navigationSpy();
  mockUseLiveQuery.mockReset();
  jest.restoreAllMocks();
});

describe('TransactionTemplatesScreen — loading and empty', () => {
  it('reads the templates live on their own table', async () => {
    seed();

    await renderScreen();

    expect(mockUseLiveQuery).toHaveBeenCalledWith(
      expect.anything(),
      ['transaction_templates'],
      true,
      { cached: true },
    );
  });

  it.each(['transaction_templates', 'holdings', 'categories'])(
    'shows no empty state, and no footer, while the %s read has not settled',
    async (table) => {
      seed({ isLoading: { [table]: true } });

      const { queryByText, queryByTestId, getByTestId } = await renderScreen();

      expect(getByTestId('transaction-templates-loading')).toBeTruthy();
      expect(queryByText(EMPTY_TITLE)).toBeNull();
      expect(queryByTestId('add-template-footer')).toBeNull();
    },
  );

  it('shows the empty state, without the footer, when ready with no templates', async () => {
    seed();

    const { getByText, queryByTestId } = await renderScreen();

    expect(getByText(EMPTY_TITLE)).toBeTruthy();
    expect(
      getByText(
        'Save a transaction you enter often as a template, then add it again in a few taps.',
      ),
    ).toBeTruthy();
    expect(queryByTestId('add-template-footer')).toBeNull();
  });

  it('opens a new template from the empty state action', async () => {
    seed();

    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('transaction-templates-empty-action'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', { newTemplate: true });
  });
});

describe('TransactionTemplatesScreen — list', () => {
  it('lists the cards in the order the query returns them (created_at ascending)', async () => {
    seed({ templates: [RENT, SALARY] });

    const { getAllByTestId } = await renderScreen();

    expect(getAllByTestId('transaction-template-card')).toHaveLength(2);
    expect(getAllByTestId('transaction-template-card')[0]).toHaveTextContent(/Rent/);
    expect(getAllByTestId('transaction-template-card')[1]).toHaveTextContent(/Salary/);
  });

  it('shows the amount of a template that stores one, and none for one that does not', async () => {
    seed({ templates: [RENT, SALARY] });

    const { getAllByTestId } = await renderScreen();
    const [rent, salary] = getAllByTestId('transaction-template-card');

    expect(rent).toHaveTextContent(/-12,500\.00 ₴/);
    expect(salary).not.toHaveTextContent(/\d/);
  });

  it.each([
    ['expense', /-12,500\.00 ₴/],
    ['exchange', /-12,500\.00 ₴/],
    ['split', /-12,500\.00 ₴/],
    ['income', /(?<!-)12,500\.00 ₴/],
  ] as const)('signs the amount of the %s template by its mode', async (mode, amount) => {
    seed({
      templates: [
        templateRow(
          't-signed',
          'Signed',
          draftOf({ mode, currency: 'UAH', amountMinorUnits: 1250000 }),
        ),
      ],
    });

    const { getByTestId } = await renderScreen();

    expect(getByTestId('transaction-template-card')).toHaveTextContent(amount);
  });

  it('shows the holding and the type as the caption, and the type alone with no holding', async () => {
    seed({ templates: [RENT, SALARY] });

    const { getByText } = await renderScreen();

    expect(getByText('Wallet · Expense')).toBeTruthy();
    expect(getByText('Income')).toBeTruthy();
  });

  it('shows the category icon, or a neutral one with none', async () => {
    seed({ templates: [RENT, SALARY] });

    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Groceries')).toBeTruthy();
    expect(getByLabelText('Uncategorized')).toBeTruthy();
  });

  it('shows the neutral icon, not the default category, for an unknown category', async () => {
    seed({
      templates: [templateRow('t-ghost', 'Ghost', draftOf({ category: 'vanished' }))],
      extraCategories: [{ key: 'other', title: 'Other', icon: 'ellipsis', color: '#8E8E93' }],
    });

    const { getByLabelText, queryByLabelText } = await renderScreen();

    expect(getByLabelText('Uncategorized')).toBeTruthy();
    expect(queryByLabelText('Other')).toBeNull();
  });

  it('opens the template for editing on a tap', async () => {
    seed({ templates: [RENT] });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Rent'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', {
      editTemplateId: 't-rent',
    });
  });

  it('opens the same edit from the context menu', async () => {
    seed({ templates: [RENT] });

    const { getByTestId } = await renderScreen();

    await holdCard();
    await fireEvent.press(getByTestId(EDIT_ACTION_TEST_ID));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', {
      editTemplateId: 't-rent',
    });
  });

  it('removes a template only after the confirm', async () => {
    const remove = jest.spyOn(transactionTemplatesRepo, 'remove').mockResolvedValue(undefined);

    seed({ templates: [RENT] });

    const { getByTestId, getByText } = await renderScreen();

    await holdCard();
    await act(async () => {
      await fireEvent.press(getByTestId(DELETE_ACTION_TEST_ID));
    });

    expect(getByText('Delete "Rent"')).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId(DELETE_CONFIRM_TEST_ID));

    expect(remove).toHaveBeenCalledWith('t-rent');
  });

  it('adds a template from the footer button', async () => {
    seed({ templates: [RENT] });

    const { getByText } = await renderScreen();

    await fireEvent.press(getByText('Add template'));

    expect(navigation.navigate).toHaveBeenCalledWith('TransactionForm', { newTemplate: true });
  });
});
