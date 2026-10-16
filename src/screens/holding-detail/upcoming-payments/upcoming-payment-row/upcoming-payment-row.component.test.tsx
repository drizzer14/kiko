import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import EntryCard from '@kiko/design-system/components/entry-card';

import UpcomingPaymentRow from '.';

// Spies on the card's renders while still drawing it, so memoization is observable.
jest.mock('@kiko/design-system/components/entry-card', () => ({
  __esModule: true,
  default: jest.fn(jest.requireActual('@kiko/design-system/components/entry-card').default),
}));

const [installment] = loanInstallments({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000_00,
  startDate: new Date(2025, 0, 15).getTime(),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 360,
});

const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

const split = `Principal ${money(installment.principalMinorUnits)} · interest ${money(
  installment.interestMinorUnits,
)}`;

describe('UpcomingPaymentRow', () => {
  it('shows its due date above a card of the loan payment, its marker, and its split', async () => {
    const { getByText, getByTestId } = await render(
      <UpcomingPaymentRow installment={installment} currency="UAH" />,
    );
    const card = getByTestId(`upcoming-payment-${installment.index}`);

    expect(getByText(formatDate(installment.dueDate))).toBeTruthy();
    expect(within(card).getByText('Loan payment')).toBeTruthy();
    expect(within(card).getByText(money(-installment.paymentMinorUnits))).toBeTruthy();
    expect(within(card).getByText('Scheduled')).toBeTruthy();
    expect(within(card).getByText(split)).toBeTruthy();
  });

  it('reads as one accessibility element, in on-screen order', async () => {
    const { getByLabelText } = await render(
      <UpcomingPaymentRow installment={installment} currency="UAH" />,
    );

    expect(
      getByLabelText(
        [
          formatDate(installment.dueDate),
          'Loan payment',
          money(-installment.paymentMinorUnits),
          'Scheduled',
          split,
        ].join(', '),
      ).props.accessible,
    ).toBe(true);
  });

  it('does not re-render when its parent re-renders with the same installment and currency', async () => {
    const { rerender } = await render(
      <UpcomingPaymentRow installment={installment} currency="UAH" />,
    );

    expect(EntryCard).toHaveBeenCalledTimes(1);

    await rerender(<UpcomingPaymentRow installment={installment} currency="UAH" />);

    expect(EntryCard).toHaveBeenCalledTimes(1);
  });
});
