import type { ComponentProps } from 'react';
import { Dimensions, StyleSheet } from 'react-native';
import {
  BANK,
  CARD,
  DOLLAR_CARD,
  chargeRowOf,
  createMarkLiveQueries,
  markWrites as mockWrites,
  settingsModuleWith as mockSettingsModuleWith,
  taggedQuery as mockTaggedQuery,
} from '@kiko/test-support/recurring-mark-live-queries';
import { EMPTY_DRAFT } from '@kiko/transaction-templates/draft';
import type { TransactionFormParams } from '@kiko/navigation/types';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { asNavigationProp, asRouteProp, navigationSpy } from '@kiko/test-support/navigation-props';
import { transactionFormDataLayer as mockDataLayer } from '@kiko/test-support/transaction-form-data-layer';
import '@kiko/design-system/unistyles';

import TransactionFormScreen from './transaction-form.screen';

// Where the convert button sits and how Type shares a row with Amount (Value Out in Exchange mode),
// on the real form with the same data layer as `transaction-form.recurring-mark.test.tsx`. The
// scroll-to-the-first-invalid-field pins stay in `transaction-form.screen.test.tsx`.

const mockLive = createMarkLiveQueries();
const mockWorld: { rows: object[] } = { rows: [] };

jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (
    query: { __kind?: string; transactionId?: string },
    tables: string[],
    enabled = true,
  ) => {
    const marked = mockLive.answer(query, tables, enabled);

    if (marked !== undefined) {
      return marked;
    }

    if (query?.__kind === 'byId') {
      return {
        data: mockWorld.rows.filter((row) => (row as { id: string }).id === query.transactionId),
      };
    }

    return { data: (mockFormData[tables[0]] ?? []) as unknown[], isLoading: false };
  },
}));
jest.mock('@kiko/transactions/repo', () => ({
  transactionsRepo: {
    ...mockDataLayer.transactionsRepo.transactionsRepo,
    getByIdQuery: (transactionId: string) => mockTaggedQuery('byId', { transactionId }),
    recurringLedgerQuery: () => mockTaggedQuery('recurringLedger'),
  },
}));
jest.mock('@kiko/holdings/repo', () => mockDataLayer.holdingsRepo);
jest.mock('@kiko/accounts/accounts.repo', () => mockDataLayer.accountsRepo);
jest.mock('@kiko/categories/repo', () => mockDataLayer.categoriesRepo);
jest.mock('@kiko/categories/category-rules-repo', () => mockDataLayer.categoryRulesRepo);
jest.mock('@kiko/settings', () => mockSettingsModuleWith(mockWrites.repo));

type FormProps = ComponentProps<typeof TransactionFormScreen>;

const ROW_ID = 'row';
const TEMPLATE_ID = 'template-1';
const PLAIN_SCALE = 1;
const ACCESSIBILITY_SCALE = 3;
const JEST_DEFAULT_SCALE = 2;
const CONVERT_LABEL = 'Exchange';

const formHolding = (holding: typeof CARD, type = 'card') => ({
  ...holding,
  type,
  balanceMinorUnits: 0,
});
const CASH_HOLDING = 'cash-wallet';
const mockFormData: Record<string, unknown[]> = {
  holdings: [
    formHolding(CARD),
    formHolding(DOLLAR_CARD),
    formHolding({ ...CARD, id: CASH_HOLDING, accountId: 'cash', name: 'Wallet' }, 'cash'),
  ],
  accounts: [
    { ...BANK, name: 'Bank' },
    { ...BANK, id: 'cash', name: 'Cash', kind: 'cash' },
  ],
  categories: [{ key: 'groceries', title: 'Groceries', icon: 'cart' }],
  transaction_templates: [
    {
      id: TEMPLATE_ID,
      name: 'Netflix',
      createdAt: 1,
      updatedAt: 1,
      draft: { ...EMPTY_DRAFT, holdingId: 'card', description: 'Netflix' },
    },
  ],
};

const STORED_ROW = {
  ...chargeRowOf(ROW_ID, 0, -14_400, { description: 'Netflix 4412', source: 'manual' }),
  category: 'groceries',
  comment: null,
  loanLinkSource: null,
};

const navigation = navigationSpy();

const setFontScale = (fontScale: number): void => {
  Dimensions.set({ window: { ...Dimensions.get('window'), fontScale } });
};

const open = async (params: TransactionFormParams, fontScale = PLAIN_SCALE) => {
  setFontScale(fontScale);
  mockWorld.rows = [STORED_ROW];

  return render(
    <TransactionFormScreen
      route={asRouteProp<FormProps['route']>('TransactionForm', params)}
      navigation={asNavigationProp<FormProps['navigation']>(navigation)}
    />,
  );
};

type Rendered = Awaited<ReturnType<typeof open>>;
type ReactTestInstance = NonNullable<ReturnType<Rendered['getByLabelText']>['parent']>;

const pickType = async (rendered: Rendered, mode: 'expense' | 'exchange'): Promise<void> => {
  await fireEvent.press(rendered.getByLabelText('Type'));
  await fireEvent.press(rendered.getByTestId(`transaction-type-field-option-${mode}`));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const styleOf = (node: ReactTestInstance): { flexDirection?: string; flex?: number } => {
  let host: ReactTestInstance | undefined = node;

  while (host !== undefined && typeof host.type !== 'string') {
    host = host.children.find((child): child is ReactTestInstance => typeof child !== 'string');
  }

  return StyleSheet.flatten(host?.props.style) ?? {};
};

const ancestorsOf = (node: ReactTestInstance): ReactTestInstance[] => {
  const chain: ReactTestInstance[] = [];

  for (let at = node.parent; at !== null; at = at.parent) {
    chain.push(at);
  }

  return chain;
};

// The lowest element holding both fields, with the child of it that holds each field.
const sharedParentOf = (first: ReactTestInstance, second: ReactTestInstance) => {
  const secondChain = ancestorsOf(second);
  const parent = ancestorsOf(first).find((ancestor) => secondChain.includes(ancestor));
  const cellOf = (field: ReactTestInstance) =>
    [field, ...ancestorsOf(field)].find((ancestor) => ancestor.parent === parent);

  return {
    parent: parent as ReactTestInstance,
    firstCell: cellOf(first) as ReactTestInstance,
    secondCell: cellOf(second) as ReactTestInstance,
  };
};

const expectRow = (first: ReactTestInstance, second: ReactTestInstance): void => {
  const { parent, firstCell, secondCell } = sharedParentOf(first, second);

  expect(styleOf(parent).flexDirection).toBe('row');
  expect(styleOf(firstCell).flex).toBe(1);
  expect(styleOf(secondCell).flex).toBe(1);
};

const expectStacked = (first: ReactTestInstance, second: ReactTestInstance): void => {
  const { parent, firstCell, secondCell } = sharedParentOf(first, second);

  expect(styleOf(parent).flexDirection).not.toBe('row');
  expect(parent.children.indexOf(firstCell)).toBeLessThan(parent.children.indexOf(secondCell));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLive.reset();
  mockWorld.rows = [];
  mockWrites.reset();
});

afterEach(() => {
  setFontScale(JEST_DEFAULT_SCALE);
});

describe('the convert button', () => {
  const body = (rendered: Rendered) => within(rendered.getByTestId('screen-scroll-view'));
  const footer = (rendered: Rendered) => within(rendered.getByTestId('screen-footer'));

  it('sits in the screen footer of a stored manual debit, and not in the form body', async () => {
    const rendered = await open({ transactionId: ROW_ID });

    expect(footer(rendered).getByRole('button', { name: CONVERT_LABEL })).toBeTruthy();
    expect(body(rendered).queryByRole('button', { name: CONVERT_LABEL })).toBeNull();
  });

  it('enters convert mode on a press', async () => {
    const rendered = await open({ transactionId: ROW_ID });

    await fireEvent.press(footer(rendered).getByRole('button', { name: CONVERT_LABEL }));

    expect(rendered.getByLabelText('Value in')).toBeTruthy();
    expect(rendered.queryByLabelText('Type')).toBeNull();
  });

  it.each<[string, TransactionFormParams]>([
    ['a create', {}],
    ['a holding add', { holdingId: 'card' }],
    ['a new template', { newTemplate: true }],
  ])('is absent on %s', async (_title, params) => {
    const rendered = await open(params);

    expect(rendered.queryByRole('button', { name: CONVERT_LABEL })).toBeNull();
  });

  it('is absent while converting', async () => {
    const rendered = await open({ transactionId: ROW_ID });

    await fireEvent.press(rendered.getByRole('button', { name: CONVERT_LABEL }));

    expect(rendered.queryByRole('button', { name: CONVERT_LABEL })).toBeNull();
  });

  it('is absent on a template edit, where the footer holds "Create transaction" alone', async () => {
    const rendered = await open({ editTemplateId: TEMPLATE_ID, transactionId: ROW_ID });

    expect(rendered.queryByRole('button', { name: CONVERT_LABEL })).toBeNull();
    expect(footer(rendered).getByText('Create transaction')).toBeTruthy();
    expect(footer(rendered).getAllByRole('button')).toHaveLength(1);
  });
});

describe('Type and Amount', () => {
  it('share one row at a plain text size, each in a flex 1 box', async () => {
    const rendered = await open({ holdingId: 'card' });

    expectRow(rendered.getByLabelText('Type'), rendered.getByLabelText('Amount'));
  });

  it('stack in the old order at an accessibility text size', async () => {
    const rendered = await open({ holdingId: 'card' }, ACCESSIBILITY_SCALE);

    expectStacked(rendered.getByLabelText('Type'), rendered.getByLabelText('Amount'));
  });

  it('leave Amount alone, with no Type, while converting', async () => {
    const rendered = await open({ transactionId: ROW_ID });

    await fireEvent.press(rendered.getByRole('button', { name: CONVERT_LABEL }));

    expect(rendered.queryByLabelText('Type')).toBeNull();
    expect(rendered.getByLabelText('Value in')).toBeTruthy();
  });
});

describe('Type and Value Out in Exchange mode', () => {
  it('share one row at a plain text size, each in a flex 1 box', async () => {
    const rendered = await open({ holdingId: CASH_HOLDING });

    await pickType(rendered, 'exchange');

    expectRow(rendered.getByLabelText('Type'), rendered.getByLabelText('Value out'));
  });

  it('stack with Type first at an accessibility text size', async () => {
    const rendered = await open({ holdingId: CASH_HOLDING }, ACCESSIBILITY_SCALE);

    await pickType(rendered, 'exchange');

    expectStacked(rendered.getByLabelText('Type'), rendered.getByLabelText('Value out'));
  });

  it('leaves Type the first child of a row across a switch from Expense and back', async () => {
    const rendered = await open({ holdingId: CASH_HOLDING });
    const expectTypeFirstInRow = (other: string): void => {
      const { parent, firstCell } = sharedParentOf(
        rendered.getByLabelText('Type'),
        rendered.getByLabelText(other),
      );

      expect(styleOf(parent).flexDirection).toBe('row');
      expect(parent.children.indexOf(firstCell)).toBe(0);
    };

    expectTypeFirstInRow('Amount');
    await pickType(rendered, 'exchange');
    expectTypeFirstInRow('Value out');
    await pickType(rendered, 'expense');
    expectTypeFirstInRow('Amount');
  });
});
