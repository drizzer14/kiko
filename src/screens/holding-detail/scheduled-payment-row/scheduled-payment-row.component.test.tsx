import { formatDate } from '@kiko/dates';
import { StyleSheet } from 'react-native';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import { act, render, within } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { layoutOf } from '@kiko/test-support/layout-of';
import { loanInstallments } from '@kiko/holdings/loan-schedule';
import EntryCard from '@kiko/design-system/components/entry-card';
import mockTextVariantTone from '@kiko/test-support/mock-text-variant-tone';

import ScheduledPaymentRow from '.';

// The Text primitive's tone -> color mapping is stripped by the project's unistyles mock, so
// the amount's resolved tone is read from the host props this mock passes through. A getter,
// so `mockTextVariantTone` is read when `Text` is first used, after the import ran.
jest.mock('@kiko/design-system/components/text', () => ({
  __esModule: true,
  get default() {
    return mockTextVariantTone;
  },
}));

// Spies on the card's renders while still drawing it, so memoization is observable.
jest.mock('@kiko/design-system/components/entry-card', () => ({
  __esModule: true,
  default: jest.fn(jest.requireActual('@kiko/design-system/components/entry-card').default),
}));

const [first] = loanInstallments({
  kind: 'mortgage',
  principalMinorUnits: 1_200_000_00,
  startDate: new Date(2025, 0, 15).getTime(),
  schedule: 'annuity',
  annualRatePct: 12,
  termMonths: 360,
});

const installment = { ...first, remainderMinorUnits: 1_198_765_43 };

const money = (minorUnits: number): string => formatMoney(Money.of('UAH', minorUnits));

const split = `Principal ${money(installment.principalMinorUnits)} · interest ${money(
  installment.interestMinorUnits,
)}`;

const remaining = `Remaining ${money(installment.remainderMinorUnits)}`;

const dim = { opacity: 0.5 };

describe('ScheduledPaymentRow', () => {
  it('shows a card of the loan payment with its marker as a subtitle, its split, and what remains', async () => {
    const { getByTestId } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" />,
    );
    const card = within(getByTestId(`scheduled-payment-${installment.index}`));

    expect(card.getByText('Loan payment')).toBeTruthy();
    expect(card.getByText('Scheduled')).toBeTruthy();
    expect(card.queryByText('Loan payment · Scheduled')).toBeNull();
    expect(card.getByText(money(-installment.paymentMinorUnits))).toBeTruthy();
    expect(card.getByText(split)).toBeTruthy();
    expect(card.getByText(remaining)).toBeTruthy();
  });

  it('draws the amount signed and in the negative (red) tone, like a linked payment', async () => {
    const { getByTestId } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" />,
    );
    const amount = within(getByTestId(`scheduled-payment-${installment.index}`)).getByText(
      money(-installment.paymentMinorUnits),
    );

    expect(layoutOf(amount)).toEqual({
      variant: 'body',
      tone: 'negative',
      children: [money(-installment.paymentMinorUnits)],
    });
  });

  it('draws the marker once, not in the footer, and no date and no time of its own', async () => {
    const { getAllByText, queryByText } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" />,
    );

    expect(getAllByText(/Scheduled/)).toHaveLength(1);
    expect(queryByText(formatDate(installment.dueDate))).toBeNull();
    expect(queryByText(/^\d{2}:\d{2}$/)).toBeNull();
  });

  it('forwards the style it is given to its card, which dims it', async () => {
    const { getByTestId } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" style={dim} />,
    );

    expect(
      StyleSheet.flatten(getByTestId(`scheduled-payment-${installment.index}`).props.style),
    ).toMatchObject(dim);
  });

  it('draws no dimming when it is given no style', async () => {
    const { getByTestId } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" />,
    );

    expect(
      StyleSheet.flatten(getByTestId(`scheduled-payment-${installment.index}`).props.style),
    ).not.toHaveProperty('opacity');
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

    it('shows its title and what remains from the Ukrainian catalogue', async () => {
      const { getByText, queryByText } = await render(
        <ScheduledPaymentRow installment={installment} currency="UAH" />,
      );

      expect(getByText('Платіж за кредитом')).toBeTruthy();
      expect(getByText('Заплановано')).toBeTruthy();
      expect(queryByText('Платіж за кредитом · Заплановано')).toBeNull();
      expect(
        getByText(
          `Залишок ${formatMoney(Money.of('UAH', installment.remainderMinorUnits), 'uk-UA')}`,
        ),
      ).toBeTruthy();
      expect(queryByText('Loan payment')).toBeNull();
      expect(queryByText('Scheduled')).toBeNull();
      expect(queryByText(remaining)).toBeNull();
    });
  });

  it('reads as one accessibility element, in on-screen order, without the date', async () => {
    const { getByLabelText } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" />,
    );

    expect(
      getByLabelText(
        ['Loan payment', 'Scheduled', money(-installment.paymentMinorUnits), split, remaining].join(
          ', ',
        ),
      ).props.accessible,
    ).toBe(true);
  });

  describe('an installment with no interest', () => {
    const interestFree = { ...installment, interestMinorUnits: 0 };

    it('shows only the principal in the footer', async () => {
      const { getByText, queryByText } = await render(
        <ScheduledPaymentRow installment={interestFree} currency="UAH" />,
      );

      expect(getByText(`Principal ${money(interestFree.principalMinorUnits)}`)).toBeTruthy();
      expect(queryByText(/interest/)).toBeNull();
    });

    it('leaves the interest out of the accessibility label', async () => {
      const { getByLabelText } = await render(
        <ScheduledPaymentRow installment={interestFree} currency="UAH" />,
      );

      expect(
        getByLabelText(
          [
            'Loan payment',
            'Scheduled',
            money(-interestFree.paymentMinorUnits),
            `Principal ${money(interestFree.principalMinorUnits)}`,
            remaining,
          ].join(', '),
        ).props.accessible,
      ).toBe(true);
    });
  });

  it('does not re-render when its parent re-renders with the same installment, currency and style', async () => {
    const { rerender } = await render(
      <ScheduledPaymentRow installment={installment} currency="UAH" style={dim} />,
    );

    expect(EntryCard).toHaveBeenCalledTimes(1);

    await rerender(<ScheduledPaymentRow installment={installment} currency="UAH" style={dim} />);

    expect(EntryCard).toHaveBeenCalledTimes(1);
  });
});
