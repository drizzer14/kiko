import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
// Deep import, deliberately bypassing the app-wide `jest.mock('react-native-calendars', ...)`
// in jest/setup.js (which only intercepts the bare `'react-native-calendars'` specifier).
// These are the actual, unmocked day-cell renderers PffCalendar's `theme` and `markedDates`
// props drive — BasicDay for the single-day sheet (DateField, default markingType), PeriodDay
// for the range sheet (DateRangeField, markingType="period"). Rendering them for real is the
// only way to assert the *actual* text color a day cell paints, rather than just the marks
// data PFF hands the library (see jest.config.js's transformIgnorePatterns comment).
import BasicDay from 'react-native-calendars/src/calendar/day/basic';
import PeriodDay from 'react-native-calendars/src/calendar/day/period';
import { darkTheme } from '../../design-system/theme';

// Mirrors the exact token mapping PffCalendar hands react-native-calendars via its `theme`
// prop (pff-calendar.component.tsx's `calendarTheme`) — same tokens, not a parallel literal
// palette, so this test tracks the real component's wiring instead of drifting from it.
const calendarTheme = {
  dayTextColor: darkTheme.colors.textPrimary,
  todayTextColor: darkTheme.colors.accent,
  selectedDayTextColor: darkTheme.colors.textPrimary,
  selectedDayBackgroundColor: darkTheme.colors.accent,
  calendarBackground: darkTheme.colors.surfaceHigh,
};

const textColorOf = (node: { props: { style: unknown } }): unknown =>
  StyleSheet.flatten(node.props.style as never).color;

describe('day-cell text color precedence — DateField single-day sheet (BasicDay)', () => {
  it('renders the on-accent (white) text, not today’s marker color, when a day is both today and selected', async () => {
    const { getByText } = await render(
      <BasicDay
        theme={calendarTheme}
        state="today"
        marking={{ selected: true, selectedColor: darkTheme.colors.accent }}
        testID="d"
      >
        4
      </BasicDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.textPrimary);
  });

  it('renders the on-accent (white) text for a selected day that is not today', async () => {
    const { getByText } = await render(
      <BasicDay
        theme={calendarTheme}
        state="selected"
        marking={{ selected: true, selectedColor: darkTheme.colors.accent }}
        testID="d"
      >
        4
      </BasicDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.textPrimary);
  });

  it('keeps today’s own marker color for an unselected today', async () => {
    const { getByText } = await render(
      <BasicDay theme={calendarTheme} state="today" testID="d">
        4
      </BasicDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.accent);
  });
});

describe('day-cell text color precedence — DateRangeField range sheet (PeriodDay)', () => {
  // Shape mirrors date-range-field.component.tsx's `buildPeriodMarks` output: `color` fills
  // the day, `selected: true` is always set on every mark it builds.
  it('renders the on-accent (white) text, not today’s marker color, when a day is both today and inside the selected range', async () => {
    const { getByText } = await render(
      <PeriodDay
        theme={calendarTheme}
        state="today"
        marking={{
          color: darkTheme.colors.accent,
          startingDay: true,
          endingDay: true,
          selected: true,
        }}
        testID="d"
      >
        4
      </PeriodDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.textPrimary);
  });

  it('renders the on-accent (white) text for a day inside the selected range that is not today', async () => {
    const { getByText } = await render(
      <PeriodDay
        theme={calendarTheme}
        marking={{
          color: darkTheme.colors.accent,
          startingDay: true,
          endingDay: true,
          selected: true,
        }}
        testID="d"
      >
        4
      </PeriodDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.textPrimary);
  });

  it('keeps today’s own marker color for a today outside any marked range', async () => {
    const { getByText } = await render(
      <PeriodDay theme={calendarTheme} state="today" testID="d">
        4
      </PeriodDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.accent);
  });

  // Regression guard for the actual shipped bug: without `selected: true` on the mark (the
  // state before the fix), a today that is also range-filled keeps the today-blue text over
  // the accent-blue fill — invisible. Locks in that `buildPeriodMarks` must keep setting it.
  it('would leave today’s marker color (not on-accent) over the fill if a range mark omitted `selected`', async () => {
    const { getByText } = await render(
      <PeriodDay
        theme={calendarTheme}
        state="today"
        marking={{ color: darkTheme.colors.accent, startingDay: true, endingDay: true }}
        testID="d"
      >
        4
      </PeriodDay>,
    );

    expect(textColorOf(getByText('4'))).toBe(darkTheme.colors.accent);
  });
});
