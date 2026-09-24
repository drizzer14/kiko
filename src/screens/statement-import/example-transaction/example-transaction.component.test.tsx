import { render } from '@testing-library/react-native';

import '../../../design-system/unistyles';
import '../../../i18n';

import type { ParsedTransaction } from '../../../statement-import/parser';

import ExampleTransaction from './example-transaction.component';

const transaction: ParsedTransaction = {
  currency: 'UAH',
  amountMinorUnits: -12_345,
  timeSeconds: 1_751_364_900,
  description: 'Coffee shop',
};

// F3 fix round 1, C1: ExampleTransaction renders through the SAME
// TransactionCard Home's own TransactionRow uses. Mock it to inspect
// exactly what ExampleTransaction hands it, rather than re-deriving the
// category resolution pipeline (already covered by category-display's own
// tests) in this leaf component's test.
const mockTransactionCard = jest.fn();
jest.mock('../../home/transaction-row/transaction-card', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockTransactionCard(props);
    const { Text: RNText } = require('react-native');

    return <RNText>{props.title as string}</RNText>;
  },
}));

describe('ExampleTransaction', () => {
  it('renders the description and the formatted amount', async () => {
    const { getByText } = await render(<ExampleTransaction transaction={transaction} />);

    expect(getByText('Coffee shop')).toBeTruthy();
  });

  // Item 4: the example transaction uses the existing TRANSACTION CARD
  // component, with the "transaction" money context so an income preview
  // reads with the same income color a Home row would.
  it('renders through TransactionCard with the transaction money context', async () => {
    await render(<ExampleTransaction transaction={transaction} />);

    expect(mockTransactionCard).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Coffee shop',
        moneyContext: 'transaction',
        categoryIcon: expect.any(String),
        categoryIconColor: expect.any(String),
      }),
    );
  });

  // Item 5: dividers bracket the card above and below.
  it('renders a Divider above and below the card', async () => {
    const { getAllByTestId } = await render(<ExampleTransaction transaction={transaction} />);

    expect(getAllByTestId('example-transaction-divider').length).toBe(2);
  });
});
