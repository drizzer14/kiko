import { Alert } from 'react-native';
import type { ComponentProps } from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { DAY_MS } from '@kiko/dates';
import { scrollToField } from '@kiko/design-system/scroll-to-field';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { TemplateNameTakenError } from '@kiko/transaction-templates/repo';
import { pressSave, saveItem } from '@kiko/test-support/form-header-items';
import { EMPTY_DRAFT, type TemplateDraft } from '@kiko/transaction-templates/draft';
// Prefixed `mock*` so Jest's hoisted mock factory may reference it. Overrides
// ONLY `useAnimatedRef` — see the module for the full rationale.
import { mockReanimatedScrollToEnd } from '@kiko/test-support/mock-reanimated-scroll-to-end';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';

import { readRouteEntry } from './route-entry';
import TransactionFormScreen from './transaction-form.screen';

const mockScrollToEnd = jest.fn();

jest.mock('react-native-reanimated', () => mockReanimatedScrollToEnd(() => mockScrollToEnd));
jest.mock('@kiko/design-system/scroll-to-field/scroll-to-field');

const mockRecordManual = jest.fn();
const mockRecordManualWithReturns = jest.fn();
const mockRecordExchange = jest.fn();
const mockUpdateTransaction = jest.fn();
const mockSetLoanPayment = jest.fn();
const mockUndoAutoLoanLink = jest.fn();
const mockUseLiveQuery = jest.fn();

// A write takes its optional template step last, and an undefined one is the same call as none.
const mockWithoutUndefinedTail = (args: unknown[]): unknown[] =>
  args.at(-1) === undefined ? args.slice(0, -1) : args;

jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    recordManual: (...args: unknown[]) => mockRecordManual(...mockWithoutUndefinedTail(args)),
    recordManualWithReturns: (...args: unknown[]) =>
      mockRecordManualWithReturns(...mockWithoutUndefinedTail(args)),
    recordExchange: (...args: unknown[]) => mockRecordExchange(...mockWithoutUndefinedTail(args)),
    update: (...args: unknown[]) => mockUpdateTransaction(...mockWithoutUndefinedTail(args)),
    setLoanPayment: (...args: unknown[]) => mockSetLoanPayment(...args),
    undoAutoLoanLink: (...args: unknown[]) => mockUndoAutoLoanLink(...args),
    getByIdQuery: (transactionId: string) => ({
      __kind: 'transactionById',
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
const mockInsertTemplate = jest.fn();

// The real `toTransactionTemplate` narrows the stored draft; only the queries and the writes are
// replaced.
jest.mock('@kiko/transaction-templates/repo', () => ({
  ...jest.requireActual('@kiko/transaction-templates/repo'),
  transactionTemplatesRepo: {
    listQuery: () => ({ __kind: 'templateList', toSQL: () => ({ sql: '', params: [] }) }),
    create: (...args: unknown[]) => mockCreateTemplate(...args),
    update: (...args: unknown[]) => mockUpdateTemplate(...args),
    insertDatabaseTransaction: (...args: unknown[]) => mockInsertTemplate(...args),
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
jest.mock('@kiko/categories/category-rules-repo', () => ({
  categoryRulesRepo: {
    applyNameRule: jest.fn(),
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
  { id: 'card', currency: 'UAH', balanceMinorUnits: 0, type: 'card', name: 'Card UAH' },
].map((holding) => ({ ...holding, accountId: 'acc' }));

const CATEGORIES = [
  { key: 'groceries', title: 'Groceries', icon: 'cart' },
  { key: 'dining', title: 'Dining', icon: 'fork.knife' },
];

const draftOf = (overrides: Partial<TemplateDraft>): TemplateDraft => ({
  ...EMPTY_DRAFT,
  ...overrides,
});

const EXPENSE = draftOf({
  holdingId: 'h1',
  currency: 'UAH',
  amountMinorUnits: 105000,
  description: 'Rent',
  category: 'groceries',
});

type TransactionRowFixture = {
  id: string;
  holdingId: string;
  amountMinorUnits: number;
  time: number;
  description: string;
  source: 'manual' | 'monobank' | 'binance' | 'import' | 'btc_wallet';
  category: string | null;
  comment: string | null;
  loanHoldingId: string | null;
  loanLinkSource: 'auto' | 'manual' | null;
};

// A stored rule row as the rules table holds it: its matchers as a JSON list.
const nameRule = (text: string, category: string) => ({
  id: `name-${text}`,
  category,
  matchers: JSON.stringify([{ type: 'nameIs', text }]),
  createdAt: 1,
  updatedAt: 1,
});

type LiveData = {
  draft: TemplateDraft;
  categoryRules?: ReturnType<typeof nameRule>[];
  latestManualHoldingId?: string | null;
  templateName?: string;
  // Every stored template, as the name check and the template select read them. Empty unless a
  // test needs a taken name or a template to pick; a row with no draft reads as an empty one. The
  // template that `draft` and `templateName` describe joins this list when the route names `tpl`.
  templateList?: { id: string; name: string; draft?: TemplateDraft }[];
  // The list read of every stored template has not settled yet.
  isTemplateListLoading?: boolean;
  // The transaction row the route names (to edit, or to duplicate). Absent on an add.
  transactionRow?: TransactionRowFixture;
};

// The template id of the route the screen was last built for: the stored list holds the route's
// template, which the screen finds in it by this id.
let routeTemplateId = '';

const setLiveData = ({
  draft,
  categoryRules = [],
  latestManualHoldingId = null,
  templateName = 'Rent',
  templateList = [],
  isTemplateListLoading = false,
  transactionRow,
}: LiveData) => {
  const template = { id: 'tpl', name: templateName, draft, createdAt: 1, updatedAt: 1 };
  const dataByTable: Record<string, unknown[]> = {
    holdings: HOLDINGS,
    accounts: [{ id: 'acc', name: 'Home' }],
    categories: CATEGORIES,
    category_rules: categoryRules,
  };
  const storedTemplates = (): unknown[] => {
    const rows = templateList.map((item) => ({ createdAt: 1, updatedAt: 1, draft: {}, ...item }));

    if (routeTemplateId !== template.id) {
      return rows;
    }

    return rows.some((row) => row.id === template.id)
      ? rows.map((row) => (row.id === template.id ? template : row))
      : [...rows, template];
  };
  const dataByKind: Record<string, () => unknown[]> = {
    latestManualHolding: () =>
      latestManualHoldingId ? [{ holdingId: latestManualHoldingId }] : [],
    distinctDescriptions: () => [],
    templateList: storedTemplates,
    transactionById: () => (transactionRow ? [transactionRow] : []),
  };

  // The template list shares its `['transaction_templates']` key with no other read, but it is
  // tagged like the two `['transactions']` reads so every read here is told apart the same way.
  mockUseLiveQuery.mockImplementation((query: unknown, tables: string[]) => {
    const kind = (query as { __kind?: string })?.__kind ?? '';

    if (kind === 'templateList' && isTemplateListLoading) {
      return { data: [], isLoading: true };
    }

    return { data: dataByKind[kind]?.() ?? dataByTable[tables[0]] ?? [], isLoading: false };
  });
};

const navigation = navigationSpy();

const templateScreen = (params: TransactionFormParams = { templateId: 'tpl' }) => {
  routeTemplateId = readRouteEntry(params).templateQueryId;

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

    await pressSave(navigation.setOptions);

    expect(mockRecordManual).toHaveBeenCalledWith({
      holdingId: 'h1',
      amountMinorUnits: -105000,
      time: NOW,
      description: 'Rent',
      category: 'groceries',
      categorySetByHand: true,
    });
  });

  it('fills an income as an income', async () => {
    setLiveData({ draft: { ...EXPENSE, mode: 'income' } });

    await render(templateScreen());

    await pressSave(navigation.setOptions);

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

    const { getByLabelText } = await render(templateScreen());

    expect(getByLabelText('Value out').props.value).toBe('100');
    expect(getByLabelText('Value in').props.value).toBe('2.5');
    expect(getByLabelText('To')).toHaveTextContent('Wallet USDHome');

    await pressSave(navigation.setOptions);

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

    const { getByLabelText } = await render(templateScreen());

    expect(getByLabelText('Return to 1')).toHaveTextContent('AliceHome');
    expect(getByLabelText('Return 1').props.value).toBe('5');

    await pressSave(navigation.setOptions);

    expect(mockRecordManualWithReturns).toHaveBeenCalledWith({
      payment: {
        holdingId: 'h1',
        amountMinorUnits: -10000,
        time: NOW,
        description: 'Dinner',
        category: 'dining',
        categorySetByHand: true,
      },
      returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
    });
  });

  it('saves the category a template carries as a hand pick, whichever rules exist', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: 'groceries' },
      categoryRules: [nameRule('coffee', 'dining')],
    });

    await render(templateScreen());
    await pressSave(navigation.setOptions);

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'groceries', categorySetByHand: true }),
    );
  });

  it('saves the rule pre-select of a template with no category as no pick', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: null },
      categoryRules: [nameRule('coffee', 'dining')],
    });

    const { getByText } = await render(templateScreen());

    expect(getByText('Dining')).toBeTruthy();

    await pressSave(navigation.setOptions);

    expect(mockRecordManual).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'dining', categorySetByHand: false }),
    );
  });

  it('saves the category a template with a split carries as a hand pick too', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'split',
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 10000,
        description: 'Coffee',
        category: 'groceries',
        returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
      }),
      categoryRules: [nameRule('coffee', 'dining')],
    });

    await render(templateScreen());
    await pressSave(navigation.setOptions);

    expect(mockRecordManualWithReturns).toHaveBeenCalledWith({
      payment: expect.objectContaining({ category: 'groceries', categorySetByHand: true }),
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

  it('leaves Destination and Value in empty for a dangling destination, keeping the rest of the fill', async () => {
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
    expect(getByLabelText('Value in').props.value).toBe('');

    await pressSave(navigation.setOptions);

    expect(mockRecordExchange).not.toHaveBeenCalled();
    expect(getByText('Select a destination account.')).toBeTruthy();
  });

  it('keeps a seeded category when the description settles on a name with a rule', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: 'groceries' },
      categoryRules: [nameRule('coffee', 'dining')],
    });

    const { getByLabelText, getByText, queryByText } = await render(templateScreen());

    await fireEvent(getByLabelText('Description'), 'blur');

    expect(getByText('Groceries')).toBeTruthy();
    expect(queryByText('Dining')).toBeNull();
  });

  it('lets the name rule seat a category when the template carries none', async () => {
    setLiveData({
      draft: { ...EXPENSE, description: 'Coffee', category: null },
      categoryRules: [nameRule('coffee', 'dining')],
    });

    const { getByLabelText, getByText } = await render(templateScreen());

    await fireEvent(getByLabelText('Description'), 'blur');

    expect(getByText('Dining')).toBeTruthy();
  });

  it('waits for the list of templates to load, seating no default holding before the fill', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'usd', isTemplateListLoading: true });

    const { getByLabelText, rerender } = await render(templateScreen());

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');
    expect(getByLabelText('Amount').props.value).toBe('');

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

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Add Template' });
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

    const { getByLabelText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Rent');
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

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

    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    expect(getByText('Amount must be greater than 0.')).toBeTruthy();
    expect(mockCreateTemplate).not.toHaveBeenCalled();

    await fireEvent.changeText(getByLabelText('Amount'), '');
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    expect(getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(mockCreateTemplate).not.toHaveBeenCalled();
  });

  it('hands the shared save-error alert a name the write itself refuses (a race)', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockRejectedValue(new TemplateNameTakenError());

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Tea');
    await pressSave(navigation.setOptions);

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it('alerts on any other write failure and stays open', async () => {
    setLiveData({ draft: EXPENSE, latestManualHoldingId: 'h1' });
    mockCreateTemplate.mockRejectedValue(new Error('disk full'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { getByLabelText } = await render(templateScreen({ newTemplate: true }));

    await fireEvent.changeText(getByLabelText('Template name'), 'Tea');
    await pressSave(navigation.setOptions);

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

    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Edit Template' });
    expect(getByLabelText('Template name').props.value).toBe('Rent');
    expect(getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');
    expect(getByLabelText('Amount').props.value).toBe('1 050');
    expect(getByLabelText('Description').props.value).toBe('Rent');
    expect(getByText('Groceries')).toBeTruthy();
  });

  it('saves through update with the id, the name and the draft, then goes back', async () => {
    setLiveData({ draft: EXPENSE });
    mockUpdateTemplate.mockResolvedValue(undefined);

    const { getByLabelText, queryByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    await fireEvent.changeText(getByLabelText('Amount'), '5');
    await pressSave(navigation.setOptions);

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

    const { getByLabelText, queryByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    await fireEvent.changeText(getByLabelText('Template name'), 'оренда');
    await pressSave(navigation.setOptions);

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
    await pressSave(navigation.setOptions);

    expect(getByText(TAKEN_MESSAGE)).toBeTruthy();
    expect(mockUpdateTemplate).not.toHaveBeenCalled();
  });

  it('asks for the holding when the template holds none', async () => {
    setLiveData({ draft: draftOf({ description: 'Coffee' }) });

    const { getByLabelText, getByText } = await render(templateScreen({ editTemplateId: 'tpl' }));

    expect(getByLabelText('Holding')).toHaveTextContent('Select holding');

    await pressSave(navigation.setOptions);

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

    const { getByLabelText, queryByLabelText } = await render(
      templateScreen({ editTemplateId: 'tpl' }),
    );

    expect(getByLabelText('Value out')).toBeTruthy();
    expect(queryByLabelText('Date')).toBeNull();

    await pressSave(navigation.setOptions);

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

  it('marks no split return required, since a template asks for none', async () => {
    setLiveData({
      draft: draftOf({
        mode: 'split',
        holdingId: 'h1',
        currency: 'UAH',
        returns: [{ holdingId: null, amountMinorUnits: null }],
      }),
    });

    const { getByLabelText, getAllByText } = await render(
      templateScreen({ editTemplateId: 'tpl' }),
    );

    expect(getByLabelText('Return 1')).toBeTruthy();
    // The name and the holding are the only required fields of a template.
    expect(getAllByText('*', { includeHiddenElements: true })).toHaveLength(2);
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

describe('TransactionFormScreen — a holding change in a template entry settles the mode', () => {
  const SWAP = draftOf({
    mode: 'exchange',
    holdingId: 'h1',
    currency: 'UAH',
    amountMinorUnits: 10000,
    exchange: { destinationHoldingId: 'usd', destinationCurrency: 'USD', valueInMinorUnits: 250 },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    ['an Add template', { newTemplate: true }],
    ['an Edit template', { editTemplateId: 'tpl' }],
  ] as const)('settles an exchange to Expense when %s picks a card', async (_name, params) => {
    setLiveData({ draft: SWAP, latestManualHoldingId: 'h1' });

    const utils = await render(templateScreen(params));

    if ('newTemplate' in params) {
      await fireEvent.press(utils.getByLabelText('Type'));
      await fireEvent.press(utils.getByTestId('transaction-type-field-option-exchange'));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');

    await fireEvent.press(utils.getByLabelText('Holding'));
    await fireEvent.press(utils.getByLabelText('Card UAH, Home'));

    expect(utils.getByLabelText('Type')).toHaveTextContent('Expense');
  });
});

const SWITCH_LABEL = 'Save as a new template';
const NAME_REQUIRED_MESSAGE = 'Enter a template name.';

// Stands in for the write's own database transaction: the form hands its `alongside` step to the
// repo, which would run it inside the one `write()`.
const DATABASE_TRANSACTION = { marker: 'inside the write' };

const MANUAL_ROW: TransactionRowFixture = {
  id: 'txn-1',
  holdingId: 'h1',
  amountMinorUnits: -5000,
  time: NOW - DAY_MS,
  description: 'Lunch',
  source: 'manual',
  category: 'groceries',
  comment: null,
  loanHoldingId: null,
  loanLinkSource: null,
};

const LUNCH_DRAFT = draftOf({
  holdingId: 'h1',
  currency: 'UAH',
  amountMinorUnits: 5000,
  description: 'Lunch',
  category: 'groceries',
});

// The write's own `alongside` step, run the way the repo runs it inside its database transaction.
const runAlongside = async (writeMock: jest.Mock): Promise<void> => {
  const alongside = writeMock.mock.calls.at(0)?.at(1) as (
    databaseTransaction: unknown,
  ) => Promise<void>;

  await alongside(DATABASE_TRANSACTION);
};

describe('TransactionFormScreen — Save as a new template', () => {
  type Utils = Awaited<ReturnType<typeof render>>;

  const pickCategory = async (utils: Utils, title: string): Promise<void> => {
    await fireEvent.press(utils.getByText('Category'));
    await fireEvent.press(utils.getByText(title));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    // Reset, not just cleared: the write-failure tests below install their own implementations.
    mockUpdateTransaction.mockReset();
    mockInsertTemplate.mockReset().mockResolvedValue('new');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('on an Add', () => {
    it('is off by default, with no name field, and writes with no alongside step', async () => {
      setLiveData({ draft: EXPENSE });

      const utils = await render(templateScreen({ holdingId: 'h1' }));

      expect(utils.getByText(SWITCH_LABEL)).toBeTruthy();
      expect(utils.getByRole('switch').props.value).toBe(false);
      expect(utils.queryByLabelText('Template name')).toBeNull();

      await fireEvent.changeText(utils.getByLabelText('Amount'), '250');
      await pickCategory(utils, 'Groceries');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledTimes(1);
      expect(mockRecordManual.mock.calls[0].at(1)).toBeUndefined();
      expect(mockInsertTemplate).not.toHaveBeenCalled();
    });

    it('sits after the comment row, in the body and not in the footer', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: { ...MANUAL_ROW, comment: 'Paid cash' } });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));
      const tree = JSON.stringify(utils.toJSON());

      expect(tree.indexOf('Paid cash')).toBeGreaterThan(-1);
      expect(tree.indexOf(SWITCH_LABEL)).toBeGreaterThan(tree.indexOf('Paid cash'));
      expect(tree.indexOf(SWITCH_LABEL)).toBeGreaterThan(tree.indexOf('Description'));
      expect(utils.queryByTestId('screen-footer')).toBeNull();
      expect(within(utils.getByTestId('transaction-form')).getByText(SWITCH_LABEL)).toBeTruthy();
    });

    it('shows the name field when turned on, and saves the transaction with the template', async () => {
      setLiveData({ draft: EXPENSE });

      const utils = await render(templateScreen({ holdingId: 'h1' }));

      await fireEvent.changeText(utils.getByLabelText('Amount'), '250');
      await fireEvent.changeText(utils.getByLabelText('Description'), 'Flat');
      await pickCategory(utils, 'Groceries');
      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Rent');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledTimes(1);
      expect(mockRecordManual).toHaveBeenCalledWith(
        {
          holdingId: 'h1',
          amountMinorUnits: -25000,
          time: NOW,
          description: 'Flat',
          category: 'groceries',
          categorySetByHand: true,
        },
        expect.any(Function),
      );

      await runAlongside(mockRecordManual);

      expect(mockInsertTemplate).toHaveBeenCalledWith(DATABASE_TRANSACTION, {
        name: 'Rent',
        draft: draftOf({
          holdingId: 'h1',
          currency: 'UAH',
          amountMinorUnits: 25000,
          description: 'Flat',
          category: 'groceries',
        }),
      });
      expect(mockCreateTemplate).not.toHaveBeenCalled();
    });

    it('passes no alongside step again once the switch is turned back off', async () => {
      setLiveData({ draft: EXPENSE });

      const utils = await render(templateScreen({ holdingId: 'h1' }));

      await fireEvent.changeText(utils.getByLabelText('Amount'), '250');
      await pickCategory(utils, 'Groceries');
      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent(utils.getByRole('switch'), 'valueChange', false);
      await pressSave(navigation.setOptions);

      expect(mockRecordManual.mock.calls[0].at(1)).toBeUndefined();
      expect(utils.queryByLabelText('Template name')).toBeNull();
    });

    it('hands a split its alongside step', async () => {
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

      const utils = await render(templateScreen());

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Dinner out');
      await pressSave(navigation.setOptions);

      expect(mockRecordManualWithReturns).toHaveBeenCalledWith(
        expect.objectContaining({ returns: [{ holdingId: 'friend', amountMinorUnits: 500 }] }),
        expect.any(Function),
      );

      await runAlongside(mockRecordManualWithReturns);

      expect(mockInsertTemplate).toHaveBeenCalledWith(DATABASE_TRANSACTION, {
        name: 'Dinner out',
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
    });

    it('hands an exchange its alongside step, with no category or description', async () => {
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

      const utils = await render(templateScreen());

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Dollars');
      await pressSave(navigation.setOptions);

      expect(mockRecordExchange).toHaveBeenCalledWith(
        expect.objectContaining({ sourceHoldingId: 'h1', destinationHoldingId: 'usd' }),
        expect.any(Function),
      );

      await runAlongside(mockRecordExchange);

      expect(mockInsertTemplate).toHaveBeenCalledWith(DATABASE_TRANSACTION, {
        name: 'Dollars',
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
    });
  });

  describe('on a Duplicate', () => {
    it('saves the copy with a template of the copied fields', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ duplicateOfTransactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Lunch again');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'h1', amountMinorUnits: -5000, time: NOW }),
        expect.any(Function),
      );

      await runAlongside(mockRecordManual);

      expect(mockInsertTemplate).toHaveBeenCalledWith(DATABASE_TRANSACTION, {
        name: 'Lunch again',
        draft: LUNCH_DRAFT,
      });
    });

    it('is off by default and passes no alongside step', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ duplicateOfTransactionId: 'txn-1' }));

      expect(utils.getByRole('switch').props.value).toBe(false);

      await pressSave(navigation.setOptions);

      expect(mockRecordManual.mock.calls[0].at(1)).toBeUndefined();
    });
  });

  describe('on an Edit of a manual row', () => {
    it('saves the edit through update with the template as its alongside step', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent.changeText(utils.getByLabelText('Amount'), '75');
      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Lunch');
      await pressSave(navigation.setOptions);

      expect(mockUpdateTransaction).toHaveBeenCalledWith(
        {
          transactionId: 'txn-1',
          amountMinorUnits: -7500,
          time: MANUAL_ROW.time,
          description: 'Lunch',
        },
        expect.any(Function),
      );

      await runAlongside(mockUpdateTransaction);

      expect(mockInsertTemplate).toHaveBeenCalledWith(DATABASE_TRANSACTION, {
        name: 'Lunch',
        draft: { ...LUNCH_DRAFT, amountMinorUnits: 7500 },
      });
      expect(navigation.goBack).toHaveBeenCalledTimes(1);
    });

    it('passes no alongside step with the switch off', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      await render(templateScreen({ transactionId: 'txn-1' }));

      await pressSave(navigation.setOptions);

      expect(mockUpdateTransaction).toHaveBeenCalledTimes(1);
      expect(mockUpdateTransaction.mock.calls[0].at(1)).toBeUndefined();
    });

    it('writes a draft with no loan for a loan-linked row, and leaves the row its link', async () => {
      setLiveData({
        draft: EXPENSE,
        transactionRow: { ...MANUAL_ROW, loanHoldingId: 'loan-1', loanLinkSource: 'manual' },
      });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Loan payment');
      await pressSave(navigation.setOptions);
      await runAlongside(mockUpdateTransaction);

      const [, input] = mockInsertTemplate.mock.calls[0] as [unknown, { draft: TemplateDraft }];

      expect(Object.keys(input.draft).sort()).toEqual(Object.keys(LUNCH_DRAFT).sort());
      expect(input.draft).not.toHaveProperty('loanHoldingId');
      expect(mockUpdateTransaction.mock.calls[0][0]).not.toHaveProperty('loanHoldingId');
      expect(mockSetLoanPayment).not.toHaveBeenCalled();
      expect(mockUndoAutoLoanLink).not.toHaveBeenCalled();
    });
  });

  describe('where the template would be dropped', () => {
    it.each(['monobank', 'import', 'btc_wallet', 'binance'] as const)(
      'is hidden on a %s row, which update never writes alongside',
      async (source) => {
        setLiveData({ draft: EXPENSE, transactionRow: { ...MANUAL_ROW, source } });

        const utils = await render(templateScreen({ transactionId: 'txn-1' }));

        expect(utils.queryByText(SWITCH_LABEL)).toBeNull();
        expect(utils.queryByRole('switch')).toBeNull();
        expect(utils.queryByLabelText('Template name')).toBeNull();
      },
    );

    it('is hidden while converting a manual row to an exchange, even when it was on', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.press(utils.getByText('Exchange'));

      expect(utils.queryByText(SWITCH_LABEL)).toBeNull();
      expect(utils.queryByLabelText('Template name')).toBeNull();
    });

    it('does not ask for a name on a convert it was turned on before', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.press(utils.getByText('Exchange'));
      await pressSave(navigation.setOptions);

      expect(utils.queryByText(NAME_REQUIRED_MESSAGE)).toBeNull();
    });
  });

  describe('its name', () => {
    it('blocks Save on an empty name, showing its error and writing nothing', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);

      expect(utils.queryByText(NAME_REQUIRED_MESSAGE)).toBeNull();

      await pressSave(navigation.setOptions);

      expect(utils.getByText(NAME_REQUIRED_MESSAGE)).toBeTruthy();
      expect(mockUpdateTransaction).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });

    it('blocks Save on a taken name, ignoring case and spaces', async () => {
      setLiveData({
        draft: EXPENSE,
        transactionRow: MANUAL_ROW,
        templateList: [{ id: 'other', name: 'Оренда' }],
      });

      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), ' оренда ');
      await pressSave(navigation.setOptions);

      expect(utils.getByText(TAKEN_MESSAGE)).toBeTruthy();
      expect(mockUpdateTransaction).not.toHaveBeenCalled();
    });

    it('is the last field the blocked Save scrolls to', async () => {
      setLiveData({ draft: EXPENSE });

      const scrollToFieldMock = scrollToField as jest.Mock;
      const utils = await render(templateScreen({ holdingId: 'h1' }));
      const blockedTarget = async (): Promise<unknown> => {
        scrollToFieldMock.mockClear();
        await pressSave(navigation.setOptions);

        expect(scrollToFieldMock).toHaveBeenCalledTimes(1);

        return scrollToFieldMock.mock.calls[0][1];
      };
      // Compared as booleans: a failing `toBe` on two refs would serialize their fiber graphs.
      const same = (first: unknown, second: unknown): boolean => first === second;

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);

      const amountFirst = await blockedTarget();

      await fireEvent.changeText(utils.getByLabelText('Amount'), '250');

      const categoryNext = await blockedTarget();

      await pickCategory(utils, 'Groceries');

      const nameLast = await blockedTarget();

      expect(same(amountFirst, categoryNext)).toBe(false);
      expect(same(categoryNext, nameLast)).toBe(false);
      expect(same(amountFirst, nameLast)).toBe(false);
      expect(mockRecordManual).not.toHaveBeenCalled();
    });
  });

  describe('when a write fails', () => {
    it('shows the shared save-error alert and stays open when the template step rejects', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });
      mockInsertTemplate.mockRejectedValue(new Error('disk full'));
      // The repo's write runs the step inside itself, so a rejected step rejects the whole write.
      mockUpdateTransaction.mockImplementation(
        async (_input: unknown, alongside: (databaseTransaction: unknown) => Promise<void>) => {
          await alongside(DATABASE_TRANSACTION);
        },
      );

      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Lunch');
      await pressSave(navigation.setOptions);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(navigation.goBack).not.toHaveBeenCalled();
      expect(utils.getByLabelText('Template name').props.value).toBe('Lunch');
    });

    it('shows the same alert, and inserts no template, when the transaction write rejects', async () => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW });
      mockUpdateTransaction.mockRejectedValue(new Error('disk full'));

      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
      const utils = await render(templateScreen({ transactionId: 'txn-1' }));

      await fireEvent(utils.getByRole('switch'), 'valueChange', true);
      await fireEvent.changeText(utils.getByLabelText('Template name'), 'Lunch');
      await pressSave(navigation.setOptions);

      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(mockInsertTemplate).not.toHaveBeenCalled();
      expect(navigation.goBack).not.toHaveBeenCalled();
    });
  });
});

describe('TransactionFormScreen — Manual and Template tabs', () => {
  type Utils = Awaited<ReturnType<typeof render>>;

  const RENT = { id: 't1', name: 'Rent', draft: EXPENSE };
  const LUNCH = {
    id: 't2',
    name: 'Lunch',
    draft: draftOf({
      holdingId: 'usd',
      currency: 'USD',
      amountMinorUnits: 2500,
      description: 'Lunch',
      category: 'dining',
    }),
  };
  // No holding and no amount: only a description and a category.
  const COFFEE = {
    id: 't3',
    name: 'Coffee',
    draft: draftOf({ description: 'Coffee', category: 'dining' }),
  };
  const TEMPLATES = [RENT, LUNCH, COFFEE];

  const pickTemplate = async (utils: Utils, id: string): Promise<void> => {
    await fireEvent.press(utils.getByTestId('template-field'));
    await fireEvent.press(utils.getByTestId(`template-field-option-${id}`));
  };

  const pickHolding = async (utils: Utils, optionLabel: string): Promise<void> => {
    await fireEvent.press(utils.getByLabelText('Holding'));
    await fireEvent.press(utils.getByLabelText(optionLabel));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each([
    ['a global add', {}],
    ['an add from a holding', { holdingId: 'h1' }],
  ] as const)('on %s', (_name, params) => {
    it('shows the tabs, opening on Manual with the whole form and no select', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));
      const tabs = within(utils.getByTestId('entry-tabs'));

      expect(tabs.getByText('Manual')).toBeTruthy();
      expect(tabs.getByText('Template')).toBeTruthy();
      expect(utils.getByLabelText('Amount')).toBeTruthy();
      expect(saveItem(navigation.setOptions)).toBeDefined();
      expect(utils.queryByTestId('template-field')).toBeNull();
    });

    it('shows only the select on the Template tab before a pick, with no fields and no Save', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Select a template');
      expect(utils.queryByLabelText('Amount')).toBeNull();
      expect(utils.queryByLabelText('Description')).toBeNull();
      expect(utils.queryByLabelText('Holding')).toBeNull();
      expect(saveItem(navigation.setOptions)).toBeUndefined();
      expect(utils.queryByText('Save as a new template')).toBeNull();
    });

    it('shows the select with the hint when there are no templates', async () => {
      setLiveData({ draft: EXPENSE });

      const utils = await render(templateScreen(params));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Select a template');
      expect(
        utils.getByText(
          'No templates yet. Turn on "Save as a new template" when you save a transaction.',
        ),
      ).toBeTruthy();
      expect(saveItem(navigation.setOptions)).toBeUndefined();
    });

    it('shows no hint while the list of templates is still loading', async () => {
      setLiveData({ draft: EXPENSE, isTemplateListLoading: true });

      const utils = await render(templateScreen(params));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Select a template');
      expect(utils.queryByText(/No templates yet/)).toBeNull();
    });

    it('keeps every edit when the template already picked is picked again', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't1');
      await fireEvent.changeText(utils.getByLabelText('Amount'), '77');
      await pickTemplate(utils, 't1');

      expect(utils.getByLabelText('Amount').props.value).toBe('77');
    });

    it('fills the whole form from a pick, then again from a second pick', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't1');

      expect(utils.getByTestId('template-field')).toHaveTextContent('Rent');
      expect(utils.getByLabelText('Amount').props.value).toBe('1 050');
      expect(utils.getByLabelText('Description').props.value).toBe('Rent');

      await pickTemplate(utils, 't2');

      expect(utils.getByTestId('template-field')).toHaveTextContent('Lunch');
      expect(utils.getByLabelText('Amount').props.value).toBe('25');
      expect(utils.getByLabelText('Description').props.value).toBe('Lunch');

      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith({
        holdingId: 'usd',
        amountMinorUnits: -2500,
        time: NOW,
        description: 'Lunch',
        category: 'dining',
        categorySetByHand: true,
      });
    });

    it('keeps the values when switching back to Manual, and again on Template', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));
      const tabs = within(utils.getByTestId('entry-tabs'));

      await fireEvent.press(tabs.getByText('Template'));
      await pickTemplate(utils, 't1');
      await fireEvent.changeText(utils.getByLabelText('Amount'), '77');
      await fireEvent.press(tabs.getByText('Manual'));

      expect(utils.queryByTestId('template-field')).toBeNull();
      expect(utils.getByLabelText('Amount').props.value).toBe('77');
      expect(utils.getByLabelText('Description').props.value).toBe('Rent');

      await fireEvent.press(tabs.getByText('Template'));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Rent');
      expect(utils.getByLabelText('Amount').props.value).toBe('77');
    });

    it('keeps what was typed on Manual while the Template tab waits for a pick', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));
      const tabs = within(utils.getByTestId('entry-tabs'));

      await fireEvent.changeText(utils.getByLabelText('Amount'), '42');
      await fireEvent.press(tabs.getByText('Template'));
      await fireEvent.press(tabs.getByText('Manual'));

      expect(utils.getByLabelText('Amount').props.value).toBe('42');
    });
  });

  describe('on a global add', () => {
    it('clears the default holding for a template with no holding, leaving the picker empty', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES, latestManualHoldingId: 'h1' });

      const utils = await render(templateScreen({}));

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't3');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Select holding');
      expect(utils.getByLabelText('Description').props.value).toBe('Coffee');
    });

    it('lets the name rule seat a category after a re-pick of a template with none', async () => {
      const UBER = { id: 't4', name: 'Uber', draft: draftOf({ description: 'Uber' }) };

      setLiveData({
        draft: EXPENSE,
        templateList: [...TEMPLATES, UBER],
        latestManualHoldingId: 'h1',
        categoryRules: [nameRule('uber', 'dining')],
      });

      const utils = await render(templateScreen({}));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't1');

      expect(utils.getByText('Groceries')).toBeTruthy();

      await pickTemplate(utils, 't4');

      expect(utils.queryByText('Groceries')).toBeNull();

      await fireEvent(utils.getByLabelText('Description'), 'blur');

      expect(utils.getByText('Dining')).toBeTruthy();
    });

    it("seats a resolved template's holding over the default", async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES, latestManualHoldingId: 'h1' });

      const utils = await render(templateScreen({}));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't2');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet USDHome');
    });
  });

  describe('on an add from a holding', () => {
    it('replaces the page holding with the holding of a resolved template', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't1');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(expect.objectContaining({ holdingId: 'h1' }));
    });

    it('keeps the page holding for a template with none', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't3');
      await fireEvent.changeText(utils.getByLabelText('Amount'), '5');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'usd', description: 'Coffee', category: 'dining' }),
      );
    });
  });

  describe('on an add from a holding, re-picking', () => {
    it('writes the page holding once the later pick holds none, after an earlier pick held one', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't1');
      await pickTemplate(utils, 't3');
      await fireEvent.changeText(utils.getByLabelText('Amount'), '5');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'usd', description: 'Coffee' }),
      );
    });
  });

  describe('on an add from a holding, once a template seats another holding', () => {
    // An exchange from the wallet, so a card picked in the shown field cannot keep it.
    const WALLET_EXCHANGE = {
      id: 't5',
      name: 'Swap',
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'h1',
        currency: 'UAH',
        amountMinorUnits: 10000,
        category: 'groceries',
        exchange: {
          destinationHoldingId: 'usd',
          destinationCurrency: 'USD',
          valueInMinorUnits: 250,
        },
      }),
    };

    const openOnTemplate = async (templateId: string): Promise<Utils> => {
      setLiveData({ draft: EXPENSE, templateList: [...TEMPLATES, WALLET_EXCHANGE] });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, templateId);

      return utils;
    };

    it('shows the holding field with the template holding, and writes to it', async () => {
      const utils = await openOnTemplate('t1');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet UAHHome');

      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(expect.objectContaining({ holdingId: 'h1' }));
    });

    it('writes to the holding picked in the field instead', async () => {
      const utils = await openOnTemplate('t1');

      await pickHolding(utils, 'Alice, Home');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('AliceHome');

      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'friend' }),
      );
    });

    it('settles an exchange to Expense when the field picks a card, and writes it from the card', async () => {
      const utils = await openOnTemplate('t5');

      expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');

      await pickHolding(utils, 'Card UAH, Home');

      expect(utils.getByLabelText('Type')).toHaveTextContent('Expense');

      await pressSave(navigation.setOptions);

      expect(mockRecordExchange).not.toHaveBeenCalled();
      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'card', amountMinorUnits: -10000 }),
      );
    });

    it('keeps the field, showing the page holding, after a re-pick of a template with none', async () => {
      const utils = await openOnTemplate('t1');

      await pickTemplate(utils, 't3');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet USDHome');

      await fireEvent.changeText(utils.getByLabelText('Amount'), '5');
      await pressSave(navigation.setOptions);

      expect(mockRecordManual).toHaveBeenCalledWith(
        expect.objectContaining({ holdingId: 'usd', description: 'Coffee' }),
      );
    });

    it('keeps the field, showing the page holding, after a re-pick of a template holding it', async () => {
      const utils = await openOnTemplate('t1');

      await pickTemplate(utils, 't2');

      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet USDHome');
    });

    it.each([
      ['holds the page holding', 't2'],
      ['holds no holding', 't3'],
    ])('keeps the field hidden for a template that %s', async (_name, templateId) => {
      const utils = await openOnTemplate(templateId);

      expect(utils.queryByLabelText('Holding')).toBeNull();
    });

    it('shows no holding field on the Manual tab', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      expect(utils.queryByLabelText('Holding')).toBeNull();
    });
  });

  describe('where the seated holding offers fewer modes', () => {
    // An exchange whose own source holding was deleted, so the template holds none.
    const EXCHANGE = {
      id: 't5',
      name: 'Swap',
      draft: draftOf({
        mode: 'exchange',
        holdingId: 'gone',
        currency: 'UAH',
        amountMinorUnits: 10000,
        exchange: {
          destinationHoldingId: 'usd',
          destinationCurrency: 'USD',
          valueInMinorUnits: 250,
        },
      }),
    };

    it('falls back to a mode a card offers, dropping the exchange fields', async () => {
      setLiveData({ draft: EXPENSE, templateList: [EXCHANGE] });

      const utils = await render(templateScreen({ holdingId: 'card' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't5');

      expect(utils.getByLabelText('Type')).toHaveTextContent('Expense');
      expect(utils.queryByLabelText('Value in')).toBeNull();
      expect(utils.getByLabelText('Amount').props.value).toBe('100');
    });

    it('keeps the exchange, leaving its destination empty when the destination is the page holding', async () => {
      setLiveData({ draft: EXPENSE, templateList: [EXCHANGE] });

      const utils = await render(templateScreen({ holdingId: 'usd' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't5');

      expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');
      expect(utils.getByLabelText('To')).toHaveTextContent('Select holding');

      await pressSave(navigation.setOptions);

      expect(mockRecordExchange).not.toHaveBeenCalled();
      expect(utils.getByText('Select a destination account.')).toBeTruthy();
    });
  });

  describe('where the seated holding is in another currency than the split returns', () => {
    const splitWithoutPayer = (holdingId: string | null) => ({
      id: 't6',
      name: 'Dinner',
      draft: draftOf({
        mode: 'split',
        holdingId,
        currency: 'UAH',
        amountMinorUnits: 10000,
        category: 'groceries',
        returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
      }),
    });

    it.each([
      ['holds no holding', null],
      ['holds a holding that is gone', 'gone'],
    ])(
      'asks for the return holding, keeping its amount, for a template that %s',
      async (_name, payerId) => {
        setLiveData({ draft: EXPENSE, templateList: [splitWithoutPayer(payerId)] });

        const utils = await render(templateScreen({ holdingId: 'usd' }));

        await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
        await pickTemplate(utils, 't6');

        expect(utils.getByLabelText('Type')).toHaveTextContent('Split');
        expect(utils.getByLabelText('Return to 1')).toHaveTextContent('Select holding');
        expect(utils.getByLabelText('Return 1').props.value).toBe('5');

        await pressSave(navigation.setOptions);

        expect(mockRecordManualWithReturns).not.toHaveBeenCalled();
      },
    );

    it('keeps the return holding when the seated holding shares its currency', async () => {
      setLiveData({ draft: EXPENSE, templateList: [splitWithoutPayer(null)] });

      const utils = await render(templateScreen({ holdingId: 'h1' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 't6');

      expect(utils.getByLabelText('Return to 1')).toHaveTextContent('AliceHome');
    });
  });

  describe('where a holding picked after the fill offers fewer modes', () => {
    // A null holding leaves the picker empty, so the mode stays as stored until a holding is
    // picked.
    const EXCHANGE_WITHOUT_HOLDING = draftOf({
      mode: 'exchange',
      currency: 'UAH',
      amountMinorUnits: 10000,
      category: 'groceries',
      exchange: { destinationHoldingId: 'usd', destinationCurrency: 'USD', valueInMinorUnits: 250 },
    });
    const SPLIT_WITHOUT_HOLDING = draftOf({
      mode: 'split',
      currency: 'UAH',
      amountMinorUnits: 10000,
      category: 'groceries',
      returns: [{ holdingId: 'friend', amountMinorUnits: 500 }],
    });
    const SPLIT_FROM_WALLET = { ...SPLIT_WITHOUT_HOLDING, holdingId: 'h1' };

    const openTemplate = async (
      entry: 'the Template tab' | 'a template to create from',
      draft: TemplateDraft,
    ): Promise<Utils> => {
      setLiveData({ draft, templateList: [{ id: 'tpl', name: 'Swap', draft }] });

      if (entry === 'a template to create from') {
        return render(templateScreen({ templateId: 'tpl' }));
      }

      const utils = await render(templateScreen({}));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Template'));
      await pickTemplate(utils, 'tpl');

      return utils;
    };

    describe.each([['the Template tab'], ['a template to create from']] as const)(
      'on %s',
      (entry) => {
        it('settles an exchange to Expense for a card', async () => {
          const utils = await openTemplate(entry, EXCHANGE_WITHOUT_HOLDING);

          expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');

          await pickHolding(utils, 'Card UAH, Home');

          expect(utils.getByLabelText('Type')).toHaveTextContent('Expense');
        });

        it('writes the expense, not an exchange, from the card', async () => {
          const utils = await openTemplate(entry, EXCHANGE_WITHOUT_HOLDING);

          await pickHolding(utils, 'Card UAH, Home');
          await pressSave(navigation.setOptions);

          expect(mockRecordExchange).not.toHaveBeenCalled();
          expect(mockRecordManual).toHaveBeenCalledWith(
            expect.objectContaining({
              holdingId: 'card',
              amountMinorUnits: -10000,
              category: 'groceries',
            }),
          );
        });

        it('settles a split to Expense for a card', async () => {
          const utils = await openTemplate(entry, SPLIT_WITHOUT_HOLDING);

          expect(utils.getByLabelText('Type')).toHaveTextContent('Split');

          await pickHolding(utils, 'Card UAH, Home');

          expect(utils.getByLabelText('Type')).toHaveTextContent('Expense');
        });

        it('writes the expense, not a split, from the card', async () => {
          const utils = await openTemplate(entry, SPLIT_WITHOUT_HOLDING);

          await pickHolding(utils, 'Card UAH, Home');
          await pressSave(navigation.setOptions);

          expect(mockRecordManualWithReturns).not.toHaveBeenCalled();
          expect(mockRecordManual).toHaveBeenCalledWith(
            expect.objectContaining({ holdingId: 'card', amountMinorUnits: -10000 }),
          );
        });

        it('empties a return holding in another currency than the picked holding, keeping its amount', async () => {
          const utils = await openTemplate(entry, SPLIT_FROM_WALLET);

          expect(utils.getByLabelText('Return to 1')).toHaveTextContent('AliceHome');

          await pickHolding(utils, 'Wallet USD, Home');

          expect(utils.getByLabelText('Type')).toHaveTextContent('Split');
          expect(utils.getByLabelText('Return to 1')).toHaveTextContent('Select holding');
          expect(utils.getByLabelText('Return 1').props.value).toBe('5');
        });

        it('writes no split with the return holding left in the old currency', async () => {
          const utils = await openTemplate(entry, SPLIT_FROM_WALLET);

          await pickHolding(utils, 'Wallet USD, Home');
          await pressSave(navigation.setOptions);

          expect(mockRecordManualWithReturns).not.toHaveBeenCalled();
        });

        it('keeps a return holding when the picked holding shares its currency', async () => {
          const utils = await openTemplate(entry, SPLIT_FROM_WALLET);

          await pickHolding(utils, 'Wallet UAH, Home');

          expect(utils.getByLabelText('Return to 1')).toHaveTextContent('AliceHome');
          expect(utils.getByLabelText('Return 1').props.value).toBe('5');
        });

        it('keeps the exchange for a cash holding', async () => {
          const utils = await openTemplate(entry, EXCHANGE_WITHOUT_HOLDING);

          await pickHolding(utils, 'Wallet UAH, Home');

          expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');
          expect(utils.getByLabelText('Value in').props.value).toBe('2.5');

          await pressSave(navigation.setOptions);

          expect(mockRecordExchange).toHaveBeenCalledWith(
            expect.objectContaining({ sourceHoldingId: 'h1', destinationHoldingId: 'usd' }),
          );
        });

        it('drops the destination, and its Value in, when the pick is that holding', async () => {
          const utils = await openTemplate(entry, EXCHANGE_WITHOUT_HOLDING);

          await pickHolding(utils, 'Wallet USD, Home');

          expect(utils.getByLabelText('Type')).toHaveTextContent('Exchange');
          expect(utils.getByLabelText('To')).toHaveTextContent('Select holding');
          expect(utils.getByLabelText('Value in').props.value).toBe('');
          expect(utils.getByLabelText('Value out').props.value).toBe('100');
        });
      },
    );
  });

  describe('on a template to create from', () => {
    const TEMPLATE_ROW = { id: 'tpl', name: 'Rent', draft: EXPENSE };

    it('opens on the Template tab with that template picked and the form filled', async () => {
      setLiveData({ draft: EXPENSE, templateList: [TEMPLATE_ROW, LUNCH] });

      const utils = await render(templateScreen({ templateId: 'tpl' }));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Rent');
      expect(utils.getByLabelText('Amount').props.value).toBe('1 050');
      expect(saveItem(navigation.setOptions)).toBeDefined();
    });

    it('fills again from another template picked after it', async () => {
      setLiveData({ draft: EXPENSE, templateList: [TEMPLATE_ROW, LUNCH] });

      const utils = await render(templateScreen({ templateId: 'tpl' }));

      await pickTemplate(utils, 't2');

      expect(utils.getByTestId('template-field')).toHaveTextContent('Lunch');
      expect(utils.getByLabelText('Amount').props.value).toBe('25');
      expect(utils.getByLabelText('Holding')).toHaveTextContent('Wallet USDHome');
    });

    it('keeps the values on Manual, and shows the tabs', async () => {
      setLiveData({ draft: EXPENSE, templateList: [TEMPLATE_ROW] });

      const utils = await render(templateScreen({ templateId: 'tpl' }));

      await fireEvent.press(within(utils.getByTestId('entry-tabs')).getByText('Manual'));

      expect(utils.getByLabelText('Amount').props.value).toBe('1 050');
    });

    it('shows the select with nothing picked, and no form, when the template is gone', async () => {
      setLiveData({ draft: EXPENSE, templateList: TEMPLATES });

      const utils = await render(templateScreen({ templateId: 'gone' }));

      expect(utils.getByTestId('template-field')).toHaveTextContent('Select a template');
      expect(utils.queryByLabelText('Amount')).toBeNull();
      expect(saveItem(navigation.setOptions)).toBeUndefined();

      await pickTemplate(utils, 't1');

      expect(utils.getByTestId('template-field')).toHaveTextContent('Rent');
      expect(utils.getByLabelText('Amount').props.value).toBe('1 050');
      expect(saveItem(navigation.setOptions)).toBeDefined();
    });
  });

  describe('where there are no tabs', () => {
    it.each([
      ['a Duplicate', { duplicateOfTransactionId: 'txn-1' }],
      ['an Edit', { transactionId: 'txn-1' }],
      ['an Add template', { newTemplate: true }],
      ['an Edit template', { editTemplateId: 'tpl' }],
    ] as const)('shows neither tabs nor select on %s', async (_name, params) => {
      setLiveData({ draft: EXPENSE, transactionRow: MANUAL_ROW, templateList: TEMPLATES });

      const utils = await render(templateScreen(params));

      expect(utils.queryByTestId('entry-tabs')).toBeNull();
      expect(utils.queryByTestId('template-field')).toBeNull();
      expect(utils.getByLabelText('Amount')).toBeTruthy();
    });
  });
});
