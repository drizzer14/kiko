import { fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { i18n } from '@kiko/i18n/init';
import { formatDate } from '@kiko/dates';
import { Money } from '@kiko/currency/money';
import { formatMoney } from '@kiko/currency/format';
import type { RecurringSeries } from '@kiko/recurring/detection';

import RecurringSeriesRow from '.';

const FIFTEENTH_OF_OCTOBER = new Date(2026, 9, 15, 9, 30).getTime();
const FIRST_OF_MAY = new Date(2026, 4, 1, 8, 0).getTime();
const TENTH_OF_JUNE = new Date(2026, 5, 10, 8, 0).getTime();

const seriesWith = (overrides: Partial<RecurringSeries>): RecurringSeries => ({
  id: 'netflix-1',
  merchantKey: 'netflix',
  name: 'Netflix',
  currency: 'UAH',
  period: 'monthly',
  recurrence: { kind: 'onDay', day: 15 },
  chargeIds: ['netflix-3', 'netflix-2', 'netflix-1'],
  lastChargeTime: FIFTEENTH_OF_OCTOBER,
  lastChargeAmountMinorUnits: 29900,
  lastChargeHoldingId: 'holding-1',
  isStopped: false,
  quiet: null,
  ...overrides,
});

describe('RecurringSeriesRow', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the name, the recurrence line, the last charge and its amount under its own testID', async () => {
    const { getByTestId, getByText } = await render(
      <RecurringSeriesRow series={seriesWith({})} onPress={jest.fn()} />,
    );

    expect(getByTestId('recurring-series-row-netflix-1')).toBeTruthy();
    expect(getByText('Netflix')).toBeTruthy();
    expect(getByText('Monthly, on day 15')).toBeTruthy();
    expect(getByText(`Last charge ${formatDate(FIFTEENTH_OF_OCTOBER)}`)).toBeTruthy();
    expect(getByText(formatMoney(Money.of('UAH', 29900)))).toBeTruthy();
  });

  it('hands its series to onPress when it is tapped', async () => {
    const series = seriesWith({});
    const onPress = jest.fn();
    const { getByTestId } = await render(<RecurringSeriesRow series={series} onPress={onPress} />);

    expect(onPress).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId('recurring-series-row-netflix-1'));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledWith(series);
  });

  it('shows the amount in the currency of the series', async () => {
    const { getByText } = await render(
      <RecurringSeriesRow
        series={seriesWith({ currency: 'USD', lastChargeAmountMinorUnits: 1500 })}
        onPress={jest.fn()}
      />,
    );

    expect(getByText(formatMoney(Money.of('USD', 1500)))).toBeTruthy();
  });

  it('shows the no-charge-since line of a stopped series', async () => {
    const { getByText } = await render(
      <RecurringSeriesRow
        series={seriesWith({ isStopped: true, lastChargeTime: FIRST_OF_MAY })}
        onPress={jest.fn()}
      />,
    );

    expect(getByText(`No charge since ${formatDate(FIRST_OF_MAY)}`)).toBeTruthy();
  });

  it('shows the quiet line of a series whose holding has no newer rows', async () => {
    const { getByText, queryByText } = await render(
      <RecurringSeriesRow
        series={seriesWith({
          isStopped: true,
          lastChargeTime: FIRST_OF_MAY,
          quiet: { since: TENTH_OF_JUNE, holdingName: 'Wallet' },
        })}
        onPress={jest.fn()}
      />,
    );

    expect(
      getByText(`Wallet: no newer transactions since ${formatDate(TENTH_OF_JUNE)}`),
    ).toBeTruthy();
    expect(queryByText(`No charge since ${formatDate(FIRST_OF_MAY)}`)).toBeNull();
  });

  describe('a marked series', () => {
    const MARKED = seriesWith({
      recurrence: { kind: 'marked' },
      lastChargeAmountMinorUnits: 26000,
      marks: [{ currency: 'UAH', amountMinorUnits: 25000, period: 'monthly' }],
      markedSpan: { lowest: 25000, highest: 26000 },
    });

    it('shows its marked line and the amount of its last real charge, never a stored amount', async () => {
      const { getByText, queryByText } = await render(
        <RecurringSeriesRow series={MARKED} onPress={jest.fn()} />,
      );

      expect(getByText('Marked: monthly')).toBeTruthy();
      expect(getByText(`Last charge ${formatDate(FIFTEENTH_OF_OCTOBER)}`)).toBeTruthy();
      expect(getByText(formatMoney(Money.of('UAH', 26000)))).toBeTruthy();
      expect(queryByText(formatMoney(Money.of('UAH', 25000)))).toBeNull();
    });

    it('hands the series with its marks to onPress, which the list reads the lowest of', async () => {
      const onPress = jest.fn();
      const { getByTestId } = await render(
        <RecurringSeriesRow series={MARKED} onPress={onPress} />,
      );

      await fireEvent.press(getByTestId('recurring-series-row-netflix-1'));

      expect(onPress).toHaveBeenCalledTimes(1);
      expect(onPress).toHaveBeenCalledWith(MARKED);
      expect(onPress.mock.calls[0][0].marks).toEqual(MARKED.marks);
    });
  });
});
