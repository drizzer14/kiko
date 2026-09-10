import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { formatDate } from '../../../dates/format';
import { ancestorWithStyle } from '../../../test-support/ancestor-with-style';
import '../../../design-system/unistyles';
import { i18n } from '../../../i18n';

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

// Like pickAndApply, but seeds an ACTIVE range first (dateFrom/dateTo) so the
// nearer-bound behavior can be exercised against a known [from, to] rather than
// the full-span default.
const pickRangeAndApply = async (
  dateFrom: Date,
  dateTo: Date,
  minDate: Date,
  maxDate: Date,
  taps: Date[],
): Promise<[Date, Date]> => {
  const onApply = jest.fn();
  const { getByLabelText, getByText, getByTestId } = await render(
    <DateRangeField
      dateFrom={dateFrom}
      dateTo={dateTo}
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

    // The full span [earliest, latest] seeds the draft; today is far past both,
    // so it moves the nearer `to` bound. A honoured tap proves today is
    // selectable (the ceiling is inclusive).
    const [, to] = await pickAndApply(earliest, latest, [today]);

    expect(ymd(to)).toEqual(ymd(today));
  });

  it('rejects a future day, keeping the seeded range unchanged', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
    const future = dayOffset(today, 30);

    // A future tap is ignored, so the seeded full span applies unchanged. Were
    // it honoured it would have moved the nearer `to` bound to the future day,
    // so the applied `to` staying on `latest` proves rejection.
    const [, to] = await pickAndApply(earliest, latest, [future]);

    expect(ymd(to)).toEqual(ymd(latest));
  });

  it('rejects a day earlier than the earliest data (a no-data past day)', async () => {
    const earliest = new Date(2005, 5, 1);
    const latest = new Date(2005, 7, 1);
    const tooEarly = new Date(2000, 0, 1);

    // A pre-earliest tap is ignored, so the seeded full span applies unchanged.
    // Were it honoured it would have moved the nearer `from` bound to 2000, so
    // the applied `from` staying on `earliest` proves rejection.
    const [from] = await pickAndApply(earliest, latest, [tooEarly]);

    expect(ymd(from)).toEqual(ymd(earliest));
  });
});

describe('DateRangeField nearer-bound picking', () => {
  const activeFrom = new Date(2020, 2, 1);
  const activeTo = new Date(2020, 8, 1);
  const earliest = new Date(2020, 0, 1);
  const latest = new Date();

  it('moves only the "from" bound when the pick is nearer to it', async () => {
    const nearFrom = new Date(2020, 2, 10);

    const [from, to] = await pickRangeAndApply(activeFrom, activeTo, earliest, latest, [nearFrom]);

    expect(ymd(from)).toEqual(ymd(nearFrom));
    // The other bound is untouched: the range shrinks from the near side only.
    expect(ymd(to)).toEqual(ymd(activeTo));
  });

  it('moves only the "to" bound when the pick is nearer to it', async () => {
    const nearTo = new Date(2020, 7, 20);

    const [from, to] = await pickRangeAndApply(activeFrom, activeTo, earliest, latest, [nearTo]);

    expect(ymd(from)).toEqual(ymd(activeFrom));
    expect(ymd(to)).toEqual(ymd(nearTo));
  });

  it('extends the "to" bound when the pick is outside and above the range', async () => {
    const above = new Date(2020, 10, 1);

    const [from, to] = await pickRangeAndApply(activeFrom, activeTo, earliest, latest, [above]);

    // The nearer bound (`to`) moves to the pick, extending the range; `from`
    // stays put.
    expect(ymd(from)).toEqual(ymd(activeFrom));
    expect(ymd(to)).toEqual(ymd(above));
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

describe('DateRangeField safe area', () => {
  it('pads the sheet clear of the home indicator (bottom safe-area inset)', async () => {
    const earliest = new Date(2000, 0, 1);
    const latest = new Date(2000, 5, 15);
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

    // Walk up from the calendar itself to the sheet Box that wraps it.
    const node = ancestorWithStyle(getByTestId('date-range-calendar'), 'paddingBottom');

    // The safe-area mock reports a 0 bottom inset by default, so the padding
    // collapses to the sheet's own base spacing(4) = 16 — this only proves the
    // inset is additive, not double-subtracted or dropped.
    expect(StyleSheet.flatten(node.props.style).paddingBottom).toBeGreaterThanOrEqual(16);
  });
});

describe('DateRangeField localization', () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('renders the heading and the open-ended "From" prefix from the Ukrainian catalog', async () => {
    await act(async () => {
      await i18n.changeLanguage('uk');
    });

    const from = new Date(2000, 1, 1);
    const { getByLabelText, getByText } = await render(
      <DateRangeField
        dateFrom={from}
        dateTo={null}
        minDate={new Date(2000, 0, 1)}
        maxDate={new Date(2000, 5, 15)}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    expect(getByText(`Від ${formatDate(from)}`)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByLabelText('Період дат'));
    });

    expect(getByText('Період дат')).toBeTruthy();
  });
});

describe('DateRangeField calendar initial month', () => {
  it('opens the calendar on the active range start', async () => {
    const { getByText, getByTestId } = await render(
      <DateRangeField
        dateFrom={new Date(2026, 2, 10)}
        dateTo={new Date(2026, 2, 20)}
        minDate={new Date(2025, 0, 1)}
        maxDate={new Date(2026, 8, 7)}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(getByText(/10\.03\.2026/));
    });

    expect(getByTestId('date-range-calendar').props.initialDate).toBe('2026-03-10');
  });

  it('falls back to a defined month when no range is set', async () => {
    const { getByTestId, getByLabelText } = await render(
      <DateRangeField
        dateFrom={null}
        dateTo={null}
        minDate={new Date(2025, 0, 1)}
        maxDate={new Date(2026, 8, 7)}
        onApply={jest.fn()}
        onClear={jest.fn()}
      />,
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Date range'));
    });

    expect(getByTestId('date-range-calendar').props.initialDate).toBeDefined();
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
