import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import type { TransactionFormParams } from '@kiko/navigation/types';
import type { TemplateDraft } from '@kiko/transaction-templates/draft';
import { TemplateNameTakenError } from '@kiko/transaction-templates/repo';
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
const mockCreateTemplate = jest.fn();
const mockUpdateTemplate = jest.fn();

// The real `toTransactionTemplate` narrows the stored draft; only the queries and the writes are
// replaced.
jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    getByIdQuery: (templateId: string) => ({
      __kind: 'templateById',
      toSQL: () => ({ sql: '', params: [templateId] }),
    }),
    listQuery: () => ({ __kind: 'templateList', toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreateTemplate(...args),
    update: (...args: unknown[]) => mockUpdateTemplate(...args),
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
  templateName?: string;
  // Every stored template, as the name check reads them. Empty unless a test needs a taken name.
  templateList?: { id: string; name: string }[];
};

const queryParams = (query: unknown): unknown[] =>
  (query as { toSQL: () => { params: unknown[] } }).toSQL().params;

// The by-id template read shares its `['transaction_templates']` key with the list read, so the
// list is told apart by its tag, like the two tagged `['transactions']` reads.
const setLiveData = ({
  draft,
  overrideRules = [],
  latestManualHoldingId = null,
  isTemplateLoading = false,
  templateName = 'Rent',
  templateList = [],
}: LiveData) => {
  const template = { id: 'tpl', name: templateName, draft, createdAt: 1, updatedAt: 1 };
  const dataByTable: Record<string, unknown[]> = {
    holdings: HOLDINGS,
    accounts: [{ id: 'acc', name: 'Home' }],
    categories: CATEGORIES,
    category_overrides: overrideRules,
  };
  const dataByKind: Record<string, unknown[]> = {
    latestManualHolding: latestManualHoldingId ? [{ holdingId: latestManualHoldingId }] : [],
    distinctDescriptions: [],
    templateList,
    // An entry that names no template reads an empty id, which the real query matches to no row.
    templateById: [template],
  };

  mockUseLiveQuery.mockImplementation((query: unknown, tables: string[]) => {
    const kind = (query as { __kind?: string })?.__kind ?? '';

    if (kind === 'templateById') {
      const isEmptyId = queryParams(query).at(0) === '';

      return {
        data: isEmptyId || isTemplateLoading ? [] : dataByKind.templateById,
        isLoading: isTemplateLoading && !isEmptyId,
      };
    }

    return { data: dataByKind[kind] ?? dataByTable[tables[0]] ?? [], isLoading: false };
  });
};

const navigation = navigationSpy();

const templateScreen = (params: TransactionFormParams = { templateId: 'tpl' }) => {
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

const TAKEN_MESSAGE = 'A template with this name already exists.';

describe('TransactionFormScreen — Add template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is titled "Add Template", with no date row, no toggle and no loan field', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });

    const { getByLabelText, queryByTestId, queryByText, queryByLabelText } = await render(
      templateScreen({ newTemplate: true }),
    );

    expect(navigation.setOptions).toHaveBeenLastCalledWith({ title: 'Add Template' });
    expect(getByLabelText('Template name')).toBeTruthy();
    expect(getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');
    expect(queryByTestId('transaction-date-field')).toBeNull();
    expect(queryByTestId('transaction-time-field')).toBeNull();
    expect(queryByLabelText('Date')).toBeNull();
    expect(queryByText('Save as a new template')).toBeNull();
    expect(queryByTestId('transaction-loan-payment-field')).toBeNull();
    expect(queryByText('Create transaction')).toBeNull();
  });

  it('saves with only a name and a holding, writing no transaction', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockResolvedValue('new');

    const { getByLabelText, getByText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Rent');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateTemplate).toHaveBeenCalledWith({
      name: 'Rent',
      draft: draftOf({ holdingId: 'h1', currency: 'UAH' }),
    });
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockRecordManual).not.toHaveBeenCalled();
  });

  it('stores what was entered, with the category lowercased and no date', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockResolvedValue('new');

    const { getByLabelText, getByText, queryByText } = await render(
      templateScreen({ newTemplate: true }),
    );

    await fireEvent.changeText(getByLabelText('Template name'), 'Rent');
    await fireEvent.changeText(getByLabelText('Amount'), '250');
    await fireEvent.changeText(getByLabelText('Description'), 'Flat');
    await fireEvent.press(getByText('Category'));
    await fireEvent.press(getByText('Groceries'));
    await fireEvent.press(getByText('Save'));

    expect(mockCreateTemplate).toHaveBeenCalledWith({
      name: 'Rent',
      draft: draftOf({
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 25000,
        description: 'Flat',
        category: 'groceries',
      }),
    });
    expect(queryByText('Just for this one')).toBeNull();
  });

  it('blocks Save on an empty name, showing its error and writing nothing', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });

    const { getByText, queryByText } = await render(templateScreen({ newTemplate: true }));

    expect(queryByText('Enter a template name.')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(getByText('Enter a template name.')).toBeTruthy();
    expect(mockCreateTemplate).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('blocks Save on a filled amount of zero, but not on an empty one', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockResolvedValue('new');

    const { getByLabelText, getByText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Rent');
    await fireEvent.changeText(getByLabelText('Amount'), '0');
    await fireEvent.press(getByText('Save'));

    expect(getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(mockCreateTemplate).not.toHaveBeenCalled();

    await fireEvent.changeText(getByLabelText('Amount'), '');
    await fireEvent.press(getByText('Save'));

    expect(mockCreateTemplate).toHaveBeenCalledTimes(1);
  });

  it('shows the taken error for a name another template holds, ignoring case and spaces', async () => {
    setLiveData({
      draft: EXPENSE,
      latestManualHoldingId: 'h1',
      templateList: [{ id: 'other', name: 'Оренда' }],
    });

    const { getByLabelText, getByText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), ' оренда ');
    await fireEvent.press(getByText('Save'));

    expect(getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  it('shows the taken error when the write itself rejects the name, with no alert', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockRejectedValue(new TemplateNameTakenError());

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Tea');
    await fireEvent.press(getByText('Save'));

    expect(getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('alerts on any other write failure and stays open', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockRejectedValue(new Error('disk full'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText, getByText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Tea');
    await fireEvent.press(getByText('Save'));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});

describe('TransactionFormScreen — Edit template', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is titled "Edit Template" and fills the name and the fields', async () => {
    setLiveData({ draft: EXPENSE });

    const { getByLabelText, getByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    expect(navigation.setOptions).toHaveBeenLastCalledWith({ title: 'Edit Template' });
    expect(getByLabelText('Template name').props.value).toBe('Rent');
    expect(getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');
    expect(getByLabelText('Amount').props.value).toBe('1 050');
    expect(getByLabelText('Description').props.value).toBe('Rent');
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('saves through update with the id, the name and the draft, then goes back', async () => {
    setLiveData({ draft: EXPENSE });
    mockUpdateTemplate.mockResolvedValue(undefined);

    const { getByLabelText, getByText, queryByText } = await render(
      templateScreen({ editTemplateId: 'tpl' }),
    );

    await fireEvent.changeText(getByLabelText('Amount'), '5');
    await fireEvent.press(getByText('Save'));

    expect(mockUpdateTemplate).toHaveBeenCalledWith({
      id: 'tpl',
      name: 'Rent',
      draft: { ...EXPENSE, amountMinorUnits: 500 },
    });
    expect(mockCreateTemplate).not.toHaveBeenCalled();
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(queryByText('Just for this one')).toBeNull();
  });

  it('does not count its own name as taken', async () => {
    setLiveData({
      draft: EXPENSE,
      templateName: 'Оренда',
      templateList: [{ id: 'tpl', name: 'Оренда' }],
    });
    mockUpdateTemplate.mockResolvedValue(undefined);

    const { getByLabelText, getByText, queryByText } = await render(
      templateScreen({ editTemplateId: 'tpl' }),
    );

    await fireEvent.changeText(getByLabelText('Template name'), 'оренда');
    await fireEvent.press(getByText('Save'));

    expect(queryByText(TAKEN_MESSAGE)).toBeNull();
    expect(mockUpdateTemplate).toHaveBeenCalledTimes(1);
  });

  it('shows the taken error for another template name', async () => {
    setLiveData({
      draft: EXPENSE,
      templateList: [
        { id: 'tpl', name: 'Rent' },
        { id: 'other', name: 'Tea' },
      ],
    });

    const { getByLabelText, getByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    await fireEvent.changeText(getByLabelText('Template name'), 'TEA');
    await fireEvent.press(getByText('Save'));

    expect(getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(mockUpdateTemplate).not.toHaveBeenCalled();
  });

  it('asks for the holding when the template holds none', async () => {
    setLiveData({ draft: draftOf({ description: 'Coffee' }) });

    const { getByLabelText, getByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');

    await fireEvent.press(getByText('Save'));

    expect(getByText('No holding selected.')).toBeTruthy();
    expect(mockUpdateTemplate).not.toHaveBeenCalled();
  });

  it('shows an exchange with no date row, and saves it with its destination left empty', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'h1',
        currency: 'UAH',
        exchange: {
          destinationHoldingId: null,
          destinationCurrency: null,
          valueInMinorUnits: null,
        },
      }),
    });
    mockUpdateTemplate.mockResolvedValue(undefined);

    const { getByLabelText, getByText, queryByLabelText } = await render(
      templateScreen({ editTemplateId: 'tpl' }),
    );

    expect(getByLabelText('Value out')).toBeTruthy();
    expect(queryByLabelText('Date')).toBeNull();

    await fireEvent.press(getByText('Save'));

    expect(mockUpdateTemplate).toHaveBeenCalledWith({
      id: 'tpl',
      name: 'Rent',
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'h1',
        currency: 'UAH',
        exchange: {
          destinationHoldingId: null,
          destinationCurrency: null,
          valueInMinorUnits: null,
        },
      }),
    });
  });

  it('offers Create transaction, which opens a transaction form from the stored template', async () => {
    setLiveData({ draft: EXPENSE });

    const { getByLabelText, getByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    await fireEvent.changeText(getByLabelText('Amount'), '5');
    await fireEvent.changeText(getByLabelText('Template name'), 'Edited');
    await fireEvent.press(getByText('Create transaction'));

    expect(navigation.push).toHaveBeenCalledWith('TransactionForm', { templateId: 'tpl' });
    expect(mockUpdateTemplate).not.toHaveBeenCalled();
    expect(mockCreateTemplate).not.toHaveBeenCalled();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });
});
