import { i18n } from '@kiko/i18n/init';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import { type TablePeriod, tablePeriodKey } from '@kiko/statistics/table-period';

import TablePeriodField from '.';

const OPTIONS: TablePeriod[] = [
  { kind: 'last12' },
  { kind: 'year', year: 2025 },
  { kind: 'year', year: 2024 },
];

const setup = async (period: TablePeriod = OPTIONS[0]) => {
  const onSelect = jest.fn();
  const utils = await render(
    <TablePeriodField period={period} options={OPTIONS} onSelect={onSelect} testID="period" />,
  );

  return { onSelect, ...utils };
};

describe('TablePeriodField', () => {
  it('shows the last 12 months as the picked period', async () => {
    const { getByTestId, getByText } = await setup();

    expect(getByTestId('period')).toHaveTextContent('Last 12 months', { exact: false });
    expect(getByText('Period')).toBeTruthy();
  });

  it('shows a picked year as its number', async () => {
    const { getByTestId } = await setup({ kind: 'year', year: 2024 });

    expect(getByTestId('period')).toHaveTextContent('2024', { exact: false });
  });

  it('lists the last 12 months, then each year, in the order given', async () => {
    const { getByTestId, getAllByTestId } = await setup();

    await fireEvent.press(getByTestId('period'));

    expect(
      getAllByTestId(/^period-option-/).map((node) => (node.props.testID as string).slice(14)),
    ).toEqual(OPTIONS.map(tablePeriodKey));
  });

  it('reports the period of the row that is tapped, not its key', async () => {
    const { getByTestId, onSelect } = await setup();

    await fireEvent.press(getByTestId('period'));
    await fireEvent.press(getByTestId(`period-option-${tablePeriodKey(OPTIONS[2])}`));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'year', year: 2024 });
  });

  it('reports the last 12 months when that row is tapped', async () => {
    const { getByTestId, onSelect } = await setup({ kind: 'year', year: 2025 });

    await fireEvent.press(getByTestId('period'));
    await fireEvent.press(getByTestId('period-option-last12'));

    expect(onSelect).toHaveBeenCalledWith({ kind: 'last12' });
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

    it('shows the label and the last 12 months in Ukrainian', async () => {
      const { getByTestId, getByText } = await setup();

      expect(getByTestId('period')).toHaveTextContent('Останні 12 місяців', { exact: false });
      expect(getByText('Період')).toBeTruthy();
    });
  });
});
