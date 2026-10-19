import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { Money } from '@kiko/currency/money';

import AccountTotal from '.';

describe('AccountTotal', () => {
  it('shows the total with no caption when there is no base figure', async () => {
    const { getByText, queryByTestId } = await render(
      <AccountTotal total={Money.of('UAH', 100_000)} inBase={null} convertedTestID="converted" />,
    );

    expect(getByText(/1,000\.00 ₴/)).toBeTruthy();
    expect(queryByTestId('converted')).toBeNull();
  });

  it('shows the base figure under the total at the caption test id', async () => {
    const { getByText, getByTestId } = await render(
      <AccountTotal
        total={Money.of('USD', 10_000)}
        inBase={Money.of('UAH', 400_000)}
        convertedTestID="converted"
      />,
    );

    expect(getByText(/\$100\.00/)).toBeTruthy();
    expect(within(getByTestId('converted')).getByText(/4,000\.00 ₴/)).toBeTruthy();
  });
});
