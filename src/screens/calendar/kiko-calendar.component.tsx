import type { FC } from 'react';
import { Calendar } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';
import CalendarHeader from './calendar-header.component';
import type { KikoCalendarProps } from './kiko-calendar.props';

// react-native-calendars' own fixed per-cell heights (see
// node_modules/react-native-calendars/src/calendar/day/{basic,period}/style.js
// — both set an explicit numeric `base.height`, so it never grows with
// content) plus its default vertical margin per week row (weekVerticalMargin,
// node_modules/react-native-calendars/src/style.js). Mirrored here, not read
// from the library (it has no exported constant), so the grid height below
// can be pinned without guessing at a magic number.
const PERIOD_DAY_CELL_HEIGHT = 34; // markingType="period" (Home's range sheet)
const WEEK_VERTICAL_MARGIN = 7; // applied above and below every week row

// Six week-rows (matching `showSixWeeks` below) at the tallest cell height
// either marking type this component is used with can produce, so the grid
// claims the exact same amount of space every month for both call sites —
// the plain single-day sheet's slightly shorter 32px cells just leave a
// couple of extra pixels of calendarBackground-colored space, invisible
// against the sheet's own background.
const CALENDAR_GRID_HEIGHT = 6 * (PERIOD_DAY_CELL_HEIGHT + WEEK_VERTICAL_MARGIN * 2);

// The shared calendar used by both date sheets (Home's range picker and the
// forms' single-day picker). It centralizes three behaviors:
//   1. Fixed grid row count — `showSixWeeks` with `hideExtraDays` disabled
//      always renders six week-rows, so navigating between a 5-week and a
//      6-week month never changes the number of rows.
//   2. Fixed grid height — the six rows above already render at a constant
//      per-row height regardless of month or marking, but the month view is
//      additionally pinned to `CALENDAR_GRID_HEIGHT` (via the `theme` prop's
//      `stylesheet.calendar.main.monthView` override, the mechanism
//      react-native-calendars itself exposes for this — see
//      node_modules/react-native-calendars/src/calendar/style.js) so the
//      sheet can never resize even if a future library version changes a
//      cell's internal sizing.
//   3. Year jump — a custom header whose double-chevron controls step a full
//      year at a time, alongside the usual single-month arrows.
// It also applies the app's dark calendar theme so callers don't repeat it.
const KikoCalendar: FC<KikoCalendarProps> = ({
  testID,
  markedDates,
  markingType,
  initialDate,
  minDate,
  maxDate,
  onDayPress,
}) => {
  const { theme } = useUnistyles();

  // react-native-calendars reads this override through a flat, dotted string
  // key (see calendar/style.js: `theme['stylesheet.calendar.main']`) rather
  // than the nested shape its own `Theme` type declares — a known mismatch
  // between the library's types and its runtime lookup. Built as a separate,
  // untyped object (rather than inline in the `theme` prop below) so that
  // mismatch doesn't trip an excess-property error against `CalendarProps`'s
  // `Theme` type: extra keys on an object assigned through a variable are
  // structurally fine against a type with no index signature, only a fresh
  // object literal at the prop site would be checked that strictly.
  const calendarTheme = {
    calendarBackground: theme.colors.surfaceHigh,
    monthTextColor: theme.colors.textPrimary,
    dayTextColor: theme.colors.textPrimary,
    textSectionTitleColor: theme.colors.textSecondary,
    todayTextColor: theme.colors.accent,
    arrowColor: theme.colors.accent,
    selectedDayBackgroundColor: theme.colors.accent,
    selectedDayTextColor: theme.colors.textPrimary,
    'stylesheet.calendar.main': {
      monthView: {
        backgroundColor: theme.colors.surfaceHigh,
        height: CALENDAR_GRID_HEIGHT,
        overflow: 'hidden',
      },
    },
  };

  return (
    <Calendar
      testID={testID}
      initialDate={initialDate}
      minDate={minDate}
      maxDate={maxDate}
      markingType={markingType}
      markedDates={markedDates}
      onDayPress={onDayPress}
      hideExtraDays={false}
      showSixWeeks
      customHeader={CalendarHeader}
      theme={calendarTheme}
    />
  );
};

export default KikoCalendar;
