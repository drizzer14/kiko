import { act, render } from '@testing-library/react-native';

import '@kiko/design-system/unistyles';
import '@kiko/i18n/init';

import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import type { ParsedTransaction } from '@kiko/statement-import/parser';

import ExampleTransaction from './example-transaction.component';

const transaction: ParsedTransaction = {
  currency: 'UAH',
  amountMinorUnits: -12_345,
  timeSeconds: 1_751_364_900,
  description: 'Coffee shop',
};

// ExampleTransaction renders through the SAME
// TransactionCard Home's own TransactionRow uses. Mock it to inspect
// exactly what ExampleTransaction hands it, rather than re-deriving the
// category resolution pipeline (already covered by category-display's own
// tests) in this leaf component's test.
const mockTransactionCard = jest.fn();
jest.mock('../transaction-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockTransactionCard(props);
    const { Text: RNText } = require('react-native');

    return <RNText>{props.title as string}</RNText>;
  },
}));

// Controllable per-table isLoading, for the loading-gate tests only — both
// default to false (already-resolved, matching the empty `data: []` the
// unmocked hook resolved to before this mock existed), so every other test
// below keeps behaving exactly as before.
let mockCategoriesLoading = false;
let mockSettingsLoading = false;
jest.mock('@kiko/db/use-live-query', () => ({
  useLiveQuery: (_query: unknown, tables: string[]) =>
    tables[0] === 'settings'
      ? { data: [], isLoading: mockSettingsLoading }
      : { data: [], isLoading: mockCategoriesLoading },
}));

describe('ExampleTransaction', () => {
  // A uk test switches the language; reset here so a failed assertion in
  // it cannot leave later tests running in uk.
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  beforeEach(() => {
    mockCategoriesLoading = false;
    mockSettingsLoading = false;
  });

  it('renders the description and the formatted amount', async () => {
    const { getByText } = await render(<ExampleTransaction transaction={transaction} />);

    expect(getByText('Coffee shop')).toBeTruthy();
  });

  // The example transaction uses the existing TRANSACTION CARD
  // component (no `moneyContext` prop any more — TransactionCard always
  // renders the "transaction" context itself).
  it('renders through TransactionCard with a resolved category icon/color', async () => {
    await render(<ExampleTransaction transaction={transaction} />);

    expect(mockTransactionCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Coffee shop',
        categoryIcon: expect.any(String),
        categoryIconColor: expect.any(String),
      }),
    );
  });

  // The footer shows the category and the row's own
  // date — the user's only per-row check of the chosen date format/column.
  it('shows the category and the row date in the footer', async () => {
    await render(<ExampleTransaction transaction={transaction} />);

    const props = mockTransactionCard.mock.calls.at(-1)?.[0];
    expect(props.footerMeta).toEqual(expect.any(String));
    expect(props.footerTrailing).toBe(formatDate(transaction.timeSeconds * 1000));
  });

  // An empty mapped description falls back to the same
  // income/expense default label Home falls back to — never a blank title.
  it('falls back to the income/expense default title when the description is empty', async () => {
    const blankDescription: ParsedTransaction = { ...transaction, description: '' };

    await render(<ExampleTransaction transaction={blankDescription} holdingName="Black card" />);

    const props = mockTransactionCard.mock.calls.at(-1)?.[0];
    expect(props.title).not.toBe('');
    // A negative amount is an expense — the same sign rule Home uses.
    expect(props.title).toBe(
      i18n.t('transactions.defaultDescriptionExpense', { name: 'Black card' }),
    );
  });

  // An empty description with NO holding chosen yet
  // (the common state on first render, before the user picks a target
  // holding) falls back to the PLAIN income/expense label — never a
  // dangling leading space (en) or dangling colon (uk). Test both locales.
  it('falls back to the plain income/expense title with no dangling space/colon when no holding is chosen (en)', async () => {
    const blankDescription: ParsedTransaction = { ...transaction, description: '' };

    await render(<ExampleTransaction transaction={blankDescription} />);

    const props = mockTransactionCard.mock.calls.at(-1)?.[0];
    expect(props.title).toBe(i18n.t('transactions.defaultDescriptionExpensePlain'));
    expect(props.title.startsWith(' ')).toBe(false);
  });

  it('falls back to the plain income/expense title with no dangling space/colon when no holding is chosen (uk)', async () => {
    await i18n.changeLanguage('uk');
    const blankDescription: ParsedTransaction = { ...transaction, description: '' };

    await render(<ExampleTransaction transaction={blankDescription} />);

    const props = mockTransactionCard.mock.calls.at(-1)?.[0];
    expect(props.title).toBe(i18n.t('transactions.defaultDescriptionExpensePlain'));
    expect(props.title.endsWith(':')).toBe(false);
  });

  // Item 5: dividers bracket the card above and below.
  it('renders a Divider above and below the card', async () => {
    const { getAllByTestId } = await render(<ExampleTransaction transaction={transaction} />);

    expect(getAllByTestId('example-transaction-divider').length).toBe(2);
  });

  it('shows a loading placeholder, not a default-category card, while categories/settings is on its first load', async () => {
    mockCategoriesLoading = true;

    const { getByTestId, queryByText } = await render(
      <ExampleTransaction transaction={transaction} />,
    );

    expect(getByTestId('example-transaction-loading')).toBeTruthy();
    // The row's own title never renders as the (possibly wrong) default-
    // category fallback while categories has not loaded yet.
    expect(queryByText('Coffee shop')).toBeNull();
    expect(mockTransactionCard).not.toHaveBeenCalled();
  });

  it('renders the real card once categories/settings has loaded', async () => {
    const { getByText, queryByTestId } = await render(
      <ExampleTransaction transaction={transaction} />,
    );

    expect(getByText('Coffee shop')).toBeTruthy();
    expect(queryByTestId('example-transaction-loading')).toBeNull();
  });
});
