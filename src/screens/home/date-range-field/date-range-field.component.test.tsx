import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { formatDate } from '../../../dates/format';
import '../../../design-system/unistyles';
import DateRangeField from './date-range-field.component';

// The Text primitive's tone -> color mapping lives inside a react-native-unistyles
// variant, which the project's Jest mock (react-native-unistyles/mocks) strips
// out of the resolved style object before a test can inspect it. Mock Text here
// instead, stamping the resolved `tone` onto the rendered node's testID — the
// label text still renders as children, so getByText assertions are unaffected.
jest.mock('../../../design-system/components/text', () => {
  const { Text: RNText } = require('react-native');

  return {
    __esModule: true,
    default: ({ tone, children }: { tone?: string; children: ReactNode }) => (
      <RNText testID={`text-tone-${tone}`}>{children}</RNText>
    ),
  };
});

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// The 'YYYY-MM-DD' key react-native-calendars expects for minDate/maxDate,
// read off the Date in local time (matching the component's own formatting).
const iso = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

// The react-native-calendars mock (jest/setup.js) renders Calendar as a plain
// View that preserves `onDayPress` as a prop, so a test drives a day tap by
// calling that prop directly with a DateData-shaped object. Only year/month/day
// are read by the field; month is 1-based, matching react-native-calendars.
type ReactTestInstanceProps = { onDayPress: (day: unknown) => void };

const dayData = (date: Date): { year: number; month: number; day: number } => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
});

const ymd = (date: Date): [number, number, number] => [
  date.getFullYear(),
  date.getMonth() + 1,
  date.getDate(),
];

// Open the sheet, tap each of the given days in order, then press Apply, and
// return the [from, to] pair the field committed through onApply.
const pickAndApply = async (minDate: Date, maxDate: Date, taps: Date[]): Promise<[Date, Date]> => {
  const onApply = jest.fn();
  const { getByLabelText, getByText, getByTestId } = await render(
    <DateRangeField
      dateFrom={null}
      dateTo={null}
      minDate={minDate}
      maxDate={maxDate}
      onApply={onApply}
      onClear={jest.fn()}
    />,
  );

  await act(async () => {
    fireEvent.press(getByLabelText('Date range'));
  });

  const calendar = getByTestId('date-range-calendar');
  for (const tap of taps) {
    await act(async () => {
      (calendar.props as ReactTestInstanceProps).onDayPress(dayData(tap));
    });
  }

  await act(async () => {
    fireEvent.press(getByText('Apply'));
  });

  expect(onApply).toHaveBeenCalledTimes(1);

  return onApply.mock.calls[0] as [Date, Date];
};

// A day at local midnight, offset from `base` by whole days.
const dayOffset = (base: Date, days: number): Date => {
  const shifted = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  shifted.setDate(shifted.getDate() + days);

  return shifted;
};

describe('DateRangeField selectable bounds', () => {
  const today = new Date();

  it('accepts the earliest-data day as the selectable floor (inclusive)', async () => {
    const earliest = new Date(2005, 5, 1);
    const latest = new Date(2005, 7, 1);

    // A fresh single tap on the earliest day starts (and applies) a same-day
    // range, proving the floor itself is selectable.
    const [from] = await pickAndApply(earliest, latest, [earliest]);

    expect(ymd(from)).toEqual(ymd(earliest));
  });

  it('accepts today as the selectable ceiling (inclusive)', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);

    const [from] = await pickAndApply(earliest, latest, [today]);

    expect(ymd(from)).toEqual(ymd(today));
  });

  it('rejects a future day, keeping it out of the applied range', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
    const future = dayOffset(today, 30);
    const inRange = new Date(2000, 2, 10);

    // The future tap is ignored, so the following in-range tap starts a fresh
    // same-day range. Were the future tap honoured it would have become the
    // range's later bound (a future year), so the applied `to` proves rejection.
    const [, to] = await pickAndApply(earliest, latest, [future, inRange]);

    expect(ymd(to)).toEqual(ymd(inRange));
  });

  it('rejects a day earlier than the earliest data (a no-data past day)', async () => {
    const earliest = new Date(2005, 5, 1);
    const latest = new Date(2005, 7, 1);
    const tooEarly = new Date(2000, 0, 1);
    const inRange = new Date(2005, 6, 10);

    // The pre-earliest tap is ignored; the in-range tap starts a fresh range, so
    // the applied `from` is the in-range day, not the rejected 2000 day.
    const [from] = await pickAndApply(earliest, latest, [tooEarly, inRange]);

    expect(ymd(from)).toEqual(ymd(inRange));
  });

  it('applies a two-tap range when both days are in the selectable range', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
    const start = new Date(2000, 1, 1);
    const end = new Date(2000, 3, 1);

    const [from, to] = await pickAndApply(earliest, latest, [start, end]);

    expect(ymd(from)).toEqual(ymd(start));
    expect(ymd(to)).toEqual(ymd(end));
  });
});

describe('DateRangeField value tone', () => {
  it('renders the shown date span in the primary (white) tone', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
    const { getByText } = await render(
      <DateRangeField
        dateFrom={null}
        dateTo={null}
        minDate={earliest}
        maxDate={latest}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    const label = `${formatDate(earliest)} – ${formatDate(latest)}`;

    expect(getByText(label).props.testID).toBe('text-tone-textPrimary');
  });

  it('renders an active range span in the primary (white) tone', async () => {
    const from = new Date(2000, 1, 1);
    const to = new Date(2000, 3, 1);
    const { getByText } = await render(
      <DateRangeField
        dateFrom={from}
        dateTo={to}
        minDate={new Date(2000, 0, 1)}
        maxDate={new Date(2000, 5, 15)}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    const label = `${formatDate(from)} – ${formatDate(to)}`;

    expect(getByText(label).props.testID).toBe('text-tone-textPrimary');
  });
});

describe('DateRangeField calendar bounds', () => {
  it('forwards the selectable floor and ceiling to the calendar as ISO minDate/maxDate', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
    const today = new Date();
    const { getByLabelText, getByTestId } = await render(
      <DateRangeField
        dateFrom={null}
        dateTo={null}
        minDate={earliest}
        maxDate={latest}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });

    const calendar = getByTestId('date-range-calendar');

    // The floor is the earliest-data day; the ceiling is today (future days are
    // never selectable). Both are 'YYYY-MM-DD', not the DD.MM.YYYY display form.
    expect(calendar.props.minDate).toBe(iso(earliest));
    expect(calendar.props.maxDate).toBe(iso(today));
  });
});
