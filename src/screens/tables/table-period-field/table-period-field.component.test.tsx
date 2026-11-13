import { i18n } from '@kiko/i18n/init';
import { StyleSheet } from 'react-native';
import { darkTheme } from '@kiko/design-system/theme';
import { act, fireEvent, render } from '@testing-library/react-native';
import '@kiko/design-system/unistyles';
import {
  type TablePeriod,
  tablePeriodKey,
  tablePeriodOptions,
} from '@kiko/statistics/table-period';

import TablePeriodField from '.';

const NOW = new Date(2026, 10, 15, 12).getTime();
const OPTIONS = tablePeriodOptions(new Date(2023, 8, 10).getTime(), NOW);
const THIS_YEAR: TablePeriod = { kind: 'year', year: 2026 };

const optionOf = (key: string): TablePeriod => {
  const found = OPTIONS.find((option) => tablePeriodKey(option) === key);

  if (found === undefined) {
    throw new Error(`no option ${key}`);
  }

  return found;
};

const setup = async (period: TablePeriod = THIS_YEAR, now = NOW) => {
  const onSelect = jest.fn();
  const utils = await render(
    <TablePeriodField
      period={period}
      options={OPTIONS}
      now={now}
      onSelect={onSelect}
      testID="period"
    />,
  );

  return { onSelect, ...utils };
};

const LABELS_IN_ENGLISH = [
  ['quarter-2026-4', 'This quarter'],
  ['quarter-2026-3', 'Last quarter'],
  ['quarter-2026-2', 'Q2 2026'],
  ['quarter-2026-1', 'Q1 2026'],
  ['half-2026-1', 'First half'],
  ['half-2026-2', 'Second half'],
  ['year-2026', 'This year'],
  ['year-2025', 'Last year'],
] as const;

const LABELS_IN_UKRAINIAN = [
  ['quarter-2026-4', 'Цей квартал'],
  ['quarter-2026-3', 'Минулий квартал'],
  ['quarter-2026-2', '2-й квартал 2026'],
  ['quarter-2026-1', '1-й квартал 2026'],
  ['half-2026-1', 'Перше півріччя'],
  ['half-2026-2', 'Друге півріччя'],
  ['year-2026', 'Цей рік'],
  ['year-2025', 'Минулий рік'],
] as const;

describe('TablePeriodField', () => {
  it('caps the trigger at the select trigger width, so a long label cannot push the layout', async () => {
    const { getByTestId } = await setup();

    expect(StyleSheet.flatten(getByTestId('period').props.style).maxWidth).toBe(
      darkTheme.layout.selectTriggerMaxWidth,
    );
  });

  it('shows this year as the picked period', async () => {
    const { getByTestId, getByText } = await setup();

    expect(getByTestId('period')).toHaveTextContent('This year', { exact: false });
    expect(getByText('Period: This year')).toBeTruthy();
  });

  it('shows the period as a pill reading "Period: This year"', async () => {
    const { getByTestId, getByLabelText } = await setup();
    const style = StyleSheet.flatten(getByTestId('period').props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors.surface);
    expect(style.minHeight).toBe(darkTheme.layout.filterPillHeight);
    expect(getByTestId('period')).toHaveTextContent('Period: This year');
    expect(getByLabelText('Period').props.accessibilityValue).toEqual({ text: 'This year' });
  });

  it.each([
    ['this year', THIS_YEAR, NOW, 'surface'],
    ['last year', { kind: 'year', year: 2025 }, NOW, 'accentSubtle'],
    ['a quarter', optionOf('quarter-2026-3'), NOW, 'accentSubtle'],
    ['a half', optionOf('half-2026-1'), NOW, 'accentSubtle'],
    [
      'a held year that is no longer this year',
      THIS_YEAR,
      new Date(2027, 0, 10).getTime(),
      'accentSubtle',
    ],
  ] as const)('tints the pill by whether %s is the default', async (_title, period, now, fill) => {
    const { getByTestId } = await setup(period, now);
    const style = StyleSheet.flatten(getByTestId('period').props.style);

    expect(style.backgroundColor).toBe(darkTheme.colors[fill]);
  });

  it('shows a picked quarter by its place in time', async () => {
    const { getByTestId } = await setup(optionOf('quarter-2026-3'));

    expect(getByTestId('period')).toHaveTextContent('Last quarter', { exact: false });
  });

  it('lists the periods in the order given', async () => {
    const { getByTestId, getAllByTestId } = await setup();

    await fireEvent.press(getByTestId('period'));

    expect(
      getAllByTestId(/^period-option-/).map((node) => (node.props.testID as string).slice(14)),
    ).toEqual(OPTIONS.map(tablePeriodKey));
  });

  it.each(LABELS_IN_ENGLISH)('names the option %s as "%s"', async (key, label) => {
    const { getByTestId } = await setup();

    await fireEvent.press(getByTestId('period'));

    expect(getByTestId(`period-option-${key}`)).toHaveTextContent(label, { exact: false });
  });

  it('reports the period of the row that is tapped, not its key', async () => {
    const { getByTestId, onSelect } = await setup();

    await fireEvent.press(getByTestId('period'));
    await fireEvent.press(getByTestId('period-option-half-2026-1'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'half', year: 2026, half: 1 });
  });

  it('reports this year when that row is tapped', async () => {
    const { getByTestId, onSelect } = await setup(optionOf('year-2025'));

    await fireEvent.press(getByTestId('period'));
    await fireEvent.press(getByTestId('period-option-year-2026'));

    expect(onSelect).toHaveBeenCalledWith(THIS_YEAR);
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

    it('shows the label and this year in Ukrainian', async () => {
      const { getByTestId, getByText } = await setup();

      expect(getByTestId('period')).toHaveTextContent('Цей рік', { exact: false });
      expect(getByText('Період: Цей рік')).toBeTruthy();
    });

    it.each(LABELS_IN_UKRAINIAN)('names the option %s as "%s"', async (key, label) => {
      const { getByTestId } = await setup();

      await fireEvent.press(getByTestId('period'));

      expect(getByTestId(`period-option-${key}`)).toHaveTextContent(label, { exact: false });
    });
  });
});
