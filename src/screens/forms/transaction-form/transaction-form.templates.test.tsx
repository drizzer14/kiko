import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import type { TransactionFormParams } from '@kiko/navigation/types';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Overrides
// ONLY `useAnimatedRef` — see the module for the full rationale.
import { mockReanimatedScrollToEnd } from '@kiko/test-support/mock-reanimated-scroll-to-end';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import TransactionFormScreen from './transaction-form.screen';

const mockScrollToEnd = jest.fn();

jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const mockRecordManual = jest.fn();
const mockRecordManualWithReturns = jest.fn();
const mockRecordExchange = jest.fn();
const mockUseLiveQuery = jest.fn();

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...args),
    recordManualWithReturns: (...args: unknown[]) => mockRecordManualWithReturns(...args),
    recordExchange: (...args: unknown[]) => mockRecordExchange(...args),
    getByIdQuery: (transactionId: string) => ({
      toSQL: () => ({ sql: '', params: [transactionId] }),
    }),
    distinctDescriptionsQuery: () => ({
      __kind: 'distinctDescriptions',
      toSQL: () => ({ sql: '', params: [] }),
    }),
    latestManualHoldingQuery: () => ({
      __kind: 'latestManualHolding',
      toSQL: () => ({ sql: '', params: [] }),
    }),
  },
}));
// The real `toTransactionTemplate` narrows the stored draft; only the query is replaced.
jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    getByIdQuery: (templateId: string) => ({ toSQL: () => ({ sql: '', params: [templateId] }) }),
  },
}));
jest.mock('@kiko/holdings/repo', () => ({
  holdingsRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/accounts/accounts.repo', () => ({
  accountsRepo: { listQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/repo', () => ({
  categoriesRepo: { allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }) },
}));
jest.mock('@kiko/categories/category-overrides-repo', () => ({
  categoryOverridesRepo: {
    upsertCategoryOverride: jest.fn(),
    allQuery: () => ({ toSQL: () => ({ sql: '', params: [] }) }),
  },
}));
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (...args: unknown[]) => mockUseLiveQuery(...args),
}));

type TransactionFormProps = ComponentProps<typeof TransactionFormScreen>;

const NOW = new Date(2025, 2, 15, 14, 30, 0).getTime();

const HOLDINGS = [
  { id: 'h1', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Wallet UAH' },
  { id: 'usd', currency: 'USD', balanceMinorUnits: 0, type: 'cash', name: 'Wallet USD' },
  { id: 'friend', currency: 'UAH', balanceMinorUnits: 0, type: 'cash', name: 'Alice' },
].map((holding) => ({ ...holding, accountId: 'acc' }));

const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

const draftOf = (overrides: Partial<TemplateDraft>): TemplateDraft => ({
  version: 1,
  mode: 'expense',
  holdingId: null,
  currency: null,
  amountMinorUnits: null,
  description: '',
  category: null,
  exchange: null,
  returns: [],
  ...overrides,
});

const EXPENSE = draftOf({
  holdingId: 'h1',
  currency: 'UAH',
  amountMinorUnits: 105000,
  description: 'Rent',
  category: 'groceries',
});

type LiveData = {
  draft: TemplateDraft;
  overrideRules?: { normalizedName: string; category: string }[];
  latestManualHoldingId?: string | null;
  isTemplateLoading?: boolean;
};

// The by-id template read shares its `['transaction_templates']` key with nothing else, so the
// table name is enough to tell it apart; the two tagged `['transactions']` reads need their tag.
const setLiveData = ({
  draft,
  overrideRules = [],
  latestManualHoldingId = null,
  isTemplateLoading = false,
}: LiveData) => {
  const template = { id: 'tpl', name: 'Rent', draft, createdAt: 1, updatedAt: 1 };
  const dataByTable: Record<string, unknown[]> = {
    holdings: HOLDINGS,
    accounts: [{ id: 'acc', name: 'Home' }],
    categories: CATEGORIES,
    category_overrides: overrideRules,
    transaction_templates: [template],
  };

  mockUseLiveQuery.mockImplementation((query: unknown, tables: string[]) => {
    const kind = (query as { __kind?: string })?.__kind;

    if (kind === 'latestManualHolding') {
      return {
        data: latestManualHoldingId ? [{ holdingId: latestManualHoldingId }] : [],
        isLoading: false,
      };
    }

    if (kind === 'distinctDescriptions') {
      return { data: [], isLoading: false };
    }

    if (isTemplateLoading && tables[0] === 'transaction_templates') {
      return { data: [], isLoading: true };
    }

    return { data: dataByTable[tables[0]] ?? [], isLoading: false };
  });
};

const navigation = navigationSpy();

const templateScreen = () => {
  const params: TransactionFormParams = { templateId: 'tpl' };

  return (
    <TransactionFormScreen
      route={asRouteProp<TransactionFormProps['route']>('TransactionForm', params)}
      navigation={asNavigationProp<TransactionFormProps['navigation']>(navigation)}
    />
  );
};

describe('TransactionFormScreen — filled from a template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fills an expense, dated at now, through the Duplicate seed', async () => {
    setLiveData({ draft: EXPENSE });

    const { getByLabelText, getByText } = await render(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');
    expect(getByLabelText('Amount').props.value).toBe('1 050');
    expect(getByLabelText('Description').props.value).toBe('Rent');
    expect(getByText('Groceries')).toBeTruthy();

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith({
      holdingId: 'h1',
      amountMinorUnits: -105000,
      time: NOW,
      description: 'Rent',
      category: 'groceries',
    });
  });

  it('fills an income as an income', async () => {
    setLiveData({ draft: { ...EXPENSE, mode: 'income' } });

    const { getByText } = await render(templateScreen());

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: 105000, time: NOW }),
    );
  });

  it('fills an exchange with its destination and Value in, dated at now', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 10000,
        exchange: {
          destinationHoldingId: 'usd',
          destinationCurrency: 'USD',
          valueInMinorUnits: 250,
        },
      }),
    });

    const { getByLabelText, getByText } = await render(templateScreen());

    expect(getByLabelText('Value out').props.value).toBe('100');
    expect(getByLabelText('Value in').props.value).toBe('2.5');
    expect(getByLabelText('To')).toHaveTextContent('Wallet USDHome');

    await fireEvent.press(getByText('Save'));

    expect(mockRecordExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceHoldingId: 'h1',
        valueOutMinorUnits: 10000,
        destinationHoldingId: 'usd',
        valueInMinorUnits: 250,
        time: NOW,
      }),
    );
  });

  it('fills a split with its return rows, dated at now', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'split',
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 10000,
        description: 'Dinner',
        category: 'dining',
        returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
      }),
    });

    const { getByLabelText, getByText } = await render(templateScreen());

    expect(getByLabelText('Return to 1')).toHaveTextContent('AliceHome');
    expect(getByLabelText('Return 1').props.value).toBe('5');

    await fireEvent.press(getByText('Save'));

    expect(mockRecordManualWithReturns).toHaveBeenCalledWith({
      payment: {
        holdingId: 'h1',
        amountMinorUnits: -10000,
        time: NOW,
        description: 'Dinner',
        category: 'dining',
      },
      returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
    });
  });

  it('leaves the holding picker empty for a null holding, and never seeds the default over it', async () => {
    setLiveData({
      draft: draftOf({ description: 'Coffee', category: 'groceries' }),
      latestManualHoldingId: 'h1',
    });

    const { getByLabelText } = await render(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');
    expect(getByLabelText('Description').props.value).toBe('Coffee');
  });

  it('turns a deleted holding into an empty picker and still reads the amount from the stored currency', async () => {
    setLiveData({
      draft: draftOf({ holdingId: 'gone', currency: 'JPY', amountMinorUnits: 1050 }),
    });

    const { getByLabelText } = await render(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');
    expect(getByLabelText('Amount').props.value).toBe('1 050');
  });

  it('leaves Destination empty for a dangling destination, keeping the rest of the fill', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 10000,
        exchange: {
          destinationHoldingId: 'gone',
          destinationCurrency: 'USD',
          valueInMinorUnits: 250,
        },
      }),
    });

    const { getByLabelText, getByText } = await render(templateScreen());

    expect(getByLabelText('To')).toHaveTextContent('Select holding');
    expect(getByLabelText('Value in').props.value).toBe('2.5');

    await fireEvent.press(getByText('Save'));

    expect(mockRecordExchange).not.toHaveBeenCalled();
    expect(getByText('Select a destination account.')).toBeTruthy();
  });

  it('keeps a seeded category when the description settles on a name with a rule', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: 'groceries' },
      overrideRules: [{ normalizedName: 'coffee', category: 'dining' }],
    });

    const { getByLabelText, getByText, queryByText } = await render(templateScreen());

    await fireEvent(getByLabelText('Description'), 'blur');

    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Dining')).toBeNull();
  });

  it('lets the name rule seat a category when the template carries none', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: null },
      overrideRules: [{ normalizedName: 'coffee', category: 'dining' }],
    });

    const { getByLabelText, getByText } = await render(templateScreen());

    await fireEvent(getByLabelText('Description'), 'blur');

    expect(getByText('Dining')).toBeTruthy();
  });

  it('waits for the template to load, seating no default holding before the fill', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'usd', isTemplateLoading: true });

    const { getByLabelText, rerender } = await render(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');

    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'usd' });
    await rerender(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');
    expect(getByLabelText('Amount').props.value).toBe('1 050');
  });

  it('fills once: a live refresh of the template never clobbers an edit', async () => {
    setLiveData({ draft: EXPENSE });

    const { getByLabelText, rerender } = await render(templateScreen());

    await fireEvent.changeText(getByLabelText('Amount'), '5');
    setLiveData({ draft: { ...EXPENSE, amountMinorUnits: 999900 } });
    await rerender(templateScreen());

    expect(getByLabelText('Amount').props.value).toBe('5');
  });
});
