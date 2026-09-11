import { darkTheme } from '@kiko/design-system/theme';
import type { RenderedElement } from '@kiko/test-support/rendered-element';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
// Deep import, deliberately bypassing the app-wide `jest.mock('react-native-calendars', ...)`
// in jest/setup.js (which only intercepts the bare `'react-native-calendars'` specifier).
// These are the actual, unmocked day-cell renderers KikoCalendar's `theme` and `markedDates`
// props drive — BasicDay for the single-day sheet (DateField, default markingType), PeriodDay
// for the range sheet (DateRangeField, markingType="period"). Rendering them for real is the
// only way to assert the *actual* text color a day cell paints, rather than just the marks
// data Kiko hands the library (see jest.config.js's transformIgnorePatterns comment).
import BasicDay from 'react-native-calendars/src/calendar/day/basic';
import type { MarkingProps } from 'react-native-calendars/src/calendar/day/marking';
import PeriodDay from 'react-native-calendars/src/calendar/day/period';
import type { DayState } from 'react-native-calendars/src/types';

import { buildCalendarTheme } from './kiko-calendar.theme';

// Mirrors the exact token mapping KikoCalendar hands react-native-calendars via its `theme`
// prop (kiko-calendar.component.tsx's `calendarTheme`) — same tokens, not a parallel literal
// palette, so this test tracks the real component's wiring instead of drifting from it.
const calendarTheme = {
  dayTextColor: darkTheme.colors.textPrimary,
  todayTextColor: darkTheme.colors.accent,
  selectedDayTextColor: darkTheme.colors.onAccent,
  selectedDayBackgroundColor: darkTheme.colors.accent,
  calendarBackground: 'transparent',
};

const textColorOf = (node: RenderedElement): unknown =>
  StyleSheet.flatten(node.props.style as never).color;

// The two day-cell describe blocks below each render the SAME cell twice —
// once for "today AND selected/in-range", once for "selected/in-range but not
// today" — asserting the identical on-accent-text outcome, differing only in
// `state`/`marking`. Sharing one render-plus-read-color helper per cell type
// keeps the JSX in exactly one place instead of copy-pasted per case.
const dayTextColor = async (
  Day: typeof BasicDay | typeof PeriodDay,
  state: DayState | undefined,
  marking: MarkingProps | undefined,
): Promise<unknown> => {
  const { getByText } = await render(
    <Day theme={calendarTheme} state={state} marking={marking} testID="d">
      4
    </Day>,
  );

  return textColorOf(getByText('4'));
};

describe('buildCalendarTheme — transparent over the glass sheet', () => {
  // The calendar sits inside a glass BottomSheet. An opaque background would
  // paint a flat card over the glass; a transparent background lets the sheet's
  // material show through (M1 in the iOS HIG audit).
  it('paints no opaque background, so the glass sheet shows through', () => {
    const built = buildCalendarTheme(darkTheme);

    expect(built.calendarBackground).toBe('transparent');
    expect(built['stylesheet.calendar.main'].monthView.backgroundColor).toBe('transparent');
  });
});

describe('buildCalendarTheme — disabled-day legibility', () => {
  // react-native-calendars' own default `textDisabledColor` (#d9e1e8) is ≈ the
  // light theme's `surfaceHigh` (#E5E5EA), which is also the calendar
  // background — so out-of-range days vanish on light unless the theme threads
  // its own muted-but-legible secondary tone.
  it('sets a legible disabled-day color from the theme’s secondary tone', () => {
    expect(buildCalendarTheme(darkTheme).textDisabledColor).toBe(darkTheme.colors.textSecondary);
  });
});

describe('day-cell text color precedence — DateField single-day sheet (BasicDay)', () => {
  it('renders the on-accent (white) text, not today’s marker color, when a day is both today and selected', async () => {
    const color = await dayTextColor(BasicDay, 'today', {
      selected: true,
      selectedColor: darkTheme.colors.accent,
    });

    expect(color).toBe(darkTheme.colors.onAccent);
  });

  it('renders the on-accent (white) text for a selected day that is not today', async () => {
    const color = await dayTextColor(BasicDay, 'selected', {
      selected: true,
      selectedColor: darkTheme.colors.accent,
    });

    expect(color).toBe(darkTheme.colors.onAccent);
  });

  it('keeps today’s own marker color for an unselected today', async () => {
    const color = await dayTextColor(BasicDay, 'today', undefined);

    expect(color).toBe(darkTheme.colors.accent);
  });
});

describe('day-cell text color precedence — DateRangeField range sheet (PeriodDay)', () => {
  // Shape mirrors date-range-field.component.tsx's `buildPeriodMarks` output: `color` fills
  // the day, `selected: true` is always set on every mark it builds.
  it('renders the on-accent (white) text, not today’s marker color, when a day is both today and inside the selected range', async () => {
    const color = await dayTextColor(PeriodDay, 'today', {
      color: darkTheme.colors.accent,
      startingDay: true,
      endingDay: true,
      selected: true,
    });

    expect(color).toBe(darkTheme.colors.onAccent);
  });

  it('renders the on-accent (white) text for a day inside the selected range that is not today', async () => {
    const color = await dayTextColor(PeriodDay, undefined, {
      color: darkTheme.colors.accent,
      startingDay: true,
      endingDay: true,
      selected: true,
    });

    expect(color).toBe(darkTheme.colors.onAccent);
  });

  it('keeps today’s own marker color for a today outside any marked range', async () => {
    const color = await dayTextColor(PeriodDay, 'today', undefined);

    expect(color).toBe(darkTheme.colors.accent);
  });

  // Regression guard for the actual shipped bug: without `selected: true` on the mark (the
  // state before the fix), a today that is also range-filled keeps the today-blue text over
  // the accent-blue fill — invisible. Locks in that `buildPeriodMarks` must keep setting it.
  it('would leave today’s marker color (not on-accent) over the fill if a range mark omitted `selected`', async () => {
    const color = await dayTextColor(PeriodDay, 'today', {
      color: darkTheme.colors.accent,
      startingDay: true,
      endingDay: true,
    });

    expect(color).toBe(darkTheme.colors.accent);
  });
});
