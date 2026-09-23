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

describe('ExampleTransaction', () => {
  it('renders the description and the formatted amount', async () => {
    const { getByText } = await render(<ExampleTransaction transaction={transaction} />);

    expect(getByText('Coffee shop')).toBeTruthy();
    expect(getByText(/123[.,]45/)).toBeTruthy();
  });
});
