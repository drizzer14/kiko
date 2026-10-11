import { formatDate } from '@kiko/dates';
import { StyleSheet } from 'react-native';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { darkTheme } from '@kiko/design-system/theme';
import { layoutOf } from '@kiko/test-support/layout-of';
import { ancestorWithStyle } from '@kiko/test-support/ancestor-with-style';

import UpcomingPayments from './upcoming-payments.component';

// The Text primitive's tone -> color mapping is stripped by the project's unistyles mock, so
// the amount's resolved tone is read from the host props this mock passes through.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  default: jest.requireActual('@kiko/test-support/mock-text-variant-tone').default,
}));

const installments = loanInstallments({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000_00,
  startDate: new Date(2025, 0, 15).getTime(),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 360,
});

const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

const CARD_TEST_ID = /^upcoming-payment-/;

describe('UpcomingPayments', () => {
  it('renders nothing when no payment is upcoming', async () => {
    const { toJSON } = await render(<UpcomingPayments installments={[]} currency="UAH" />);

    expect(toJSON()).toBeNull();
  });

  it('shows each installment as a dated card of its payment, its marker, and its split', async () => {
    const [first] = installments;
    const { getByText, getByTestId } = await render(
      <UpcomingPayments installments={installments.slice(0, 2)} currency="UAH" />,
    );

    expect(getByText('Upcoming Payments')).toBeTruthy();
    expect(getByText(formatDate(first.dueDate))).toBeTruthy();

    const card = within(getByTestId(`upcoming-payment-${first.index}`));

    expect(card.getByText('Loan payment')).toBeTruthy();
    expect(card.getByText(money(first.paymentMinorUnits))).toBeTruthy();
    expect(card.getByText('Scheduled')).toBeTruthy();
    expect(
      card.getByText(
        `Principal ${money(first.principalMinorUnits)} · interest ${money(first.interestMinorUnits)}`,
      ),
    ).toBeTruthy();
  });

  it('stacks its heading, cards, and toggle with the ledger spacing(2) rhythm', async () => {
    const { getByTestId } = await render(
      <UpcomingPayments installments={installments} currency="UAH" />,
    );
    const section = getByTestId('upcoming-payments');
    const layout = layoutOf(section);

    expect(StyleSheet.flatten(section.props.style)).toMatchObject({ gap: darkTheme.spacing(2) });
    expect(typeof layout === 'string' ? undefined : layout.children.at(-1)).toMatchObject({
      testID: 'upcoming-payments-toggle',
    });
  });

  it('renders only the next 12 cards of a 360-installment mortgage, behind a Show all toggle', async () => {
    const { getAllByTestId, getByTestId } = await render(
      <UpcomingPayments installments={installments} currency="UAH" />,
    );

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(12);
    expect(within(getByTestId('upcoming-payments-toggle')).getByText('Show all')).toBeTruthy();
  });

  it('shows every card on Show all, and collapses back to 12 on Show less', async () => {
    const { getAllByTestId, getByTestId } = await render(
      <UpcomingPayments installments={installments} currency="UAH" />,
    );

    await fireEvent.press(getByTestId('upcoming-payments-toggle'));

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(360);
    expect(within(getByTestId('upcoming-payments-toggle')).getByText('Show less')).toBeTruthy();

    await fireEvent.press(getByTestId('upcoming-payments-toggle'));

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(12);
    expect(within(getByTestId('upcoming-payments-toggle')).getByText('Show all')).toBeTruthy();
  });

  it.each([1, 12])('shows no toggle for %i installments, which already fit', async (count) => {
    const { getAllByTestId, queryByTestId } = await render(
      <UpcomingPayments installments={installments.slice(0, count)} currency="UAH" />,
    );

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(count);
    expect(queryByTestId('upcoming-payments-toggle')).toBeNull();
  });

  it('shows a toggle for 13 installments and reveals the 13th on Show all', async () => {
    const { getAllByTestId, getByTestId } = await render(
      <UpcomingPayments installments={installments.slice(0, 13)} currency="UAH" />,
    );

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(12);

    await fireEvent.press(getByTestId('upcoming-payments-toggle'));

    expect(getAllByTestId(CARD_TEST_ID)).toHaveLength(13);
  });

  it('dims no card: every installment is in the future, so none reads as a faded estimate', async () => {
    const { getAllByTestId } = await render(
      <UpcomingPayments installments={installments} currency="UAH" />,
    );

    for (const card of getAllByTestId(CARD_TEST_ID)) {
      expect(() => ancestorWithStyle(card, 'opacity')).toThrow();
    }
  });

  it('reads each amount in the plain white tone, never red or green', async () => {
    const [first] = installments;
    const { getByTestId } = await render(
      <UpcomingPayments installments={installments.slice(0, 1)} currency="UAH" />,
    );
    const amount = within(getByTestId(`upcoming-payment-${first.index}`)).getByText(
      money(first.paymentMinorUnits),
    );

    expect(layoutOf(amount)).toEqual({
      variant: 'body',
      tone: 'textPrimary',
      children: [money(first.paymentMinorUnits)],
    });
  });

  describe('under the uk language', () => {
    beforeEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('uk');
      });
    });

    afterEach(async () => {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
    });

    it('labels each card and the toggle from the Ukrainian catalogue', async () => {
      const [first] = installments;
      const { getByTestId, queryByText } = await render(
        <UpcomingPayments installments={installments} currency="UAH" />,
      );
      const card = within(getByTestId(`upcoming-payment-${first.index}`));

      expect(card.getByText('Платіж за кредитом')).toBeTruthy();
      expect(card.getByText('Заплановано')).toBeTruthy();
      expect(
        within(getByTestId('upcoming-payments-toggle')).getByText('Показати всі'),
      ).toBeTruthy();
      expect(queryByText('Loan payment')).toBeNull();
      expect(queryByText('Scheduled')).toBeNull();
    });
  });
});
