import { Money } from '@kiko/currency/money';
import { formatDate } from '@kiko/dates/format';
import { formatMoney } from '@kiko/currency/format';
import { render } from '@testing-library/react-native';
import { loanInstallments } from '@kiko/holdings/loan-schedule';

import '../../../design-system/unistyles';

import UpcomingPayments from './upcoming-payments.component';

const installments = loanInstallments({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000_00,
  startDate: new Date(2025, 0, 15).getTime(),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 360,
});

const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

describe('UpcomingPayments', () => {
  it('renders nothing when no payment is upcoming', async () => {
    const { toJSON } = await render(<UpcomingPayments installments={[]} currency="UAH" />);

    expect(toJSON()).toBeNull();
  });

  it('shows each installment as its due date, its payment, and its principal / interest split', async () => {
    const [first] = installments;
    const { getByText, getByTestId } = await render(
      <UpcomingPayments installments={installments.slice(0, 2)} currency="UAH" />,
    );

    expect(getByText('Upcoming payments')).toBeTruthy();
    expect(getByText(formatDate(first.dueDate))).toBeTruthy();

    const row = getByTestId(`upcoming-payment-${first.index}`);

    expect(row).toHaveTextContent(money(first.paymentMinorUnits), { exact: false });
    expect(row).toHaveTextContent(
      `Principal ${money(first.principalMinorUnits)} · interest ${money(first.interestMinorUnits)}`,
      { exact: false },
    );
  });

  it('renders every row of a 360-installment mortgage', async () => {
    const { getAllByTestId } = await render(
      <UpcomingPayments installments={installments} currency="UAH" />,
    );

    expect(getAllByTestId(/^upcoming-payment-/)).toHaveLength(360);
  });
});
