import type { UnistylesThemes } from 'react-native-unistyles';

// The registered app theme — the same object `useUnistyles()` hands the
// component. Derived from the theme registration so it stays in sync.
type AppTheme = UnistylesThemes[keyof UnistylesThemes];

// react-native-calendars' own fixed per-cell heights (see
// node_modules/react-native-calendars/src/calendar/day/{basic,period}/style.js
// — both set an explicit numeric `base.height`, so it never grows with
// content) plus its default vertical margin per week row (weekVerticalMargin,
// node_modules/react-native-calendars/src/style.js). Mirrored here, not read
// from the library (it has no exported constant), so the grid height below
// can be pinned without guessing at a magic number.
const PERIOD_DAY_CELL_HEIGHT = 34; // markingType="period" (Home's range sheet)
const WEEK_VERTICAL_MARGIN = 7; // applied above and below every week row

// Six week-rows (matching `showSixWeeks` in the component) at the tallest cell
// height either marking type this component is used with can produce, so the
// grid claims the exact same amount of space every month for both call sites —
// the plain single-day sheet's slightly shorter 32px cells just leave a
// couple of extra pixels of calendarBackground-colored space, invisible
// against the sheet's own background.
const CALENDAR_GRID_HEIGHT = 6 * (PERIOD_DAY_CELL_HEIGHT + WEEK_VERTICAL_MARGIN * 2);

// Pure builder for the `theme` object KikoCalendar hands react-native-calendars.
// Extracted from the component (which pulls in the React tree — CalendarHeader,
// Text, unistyles mocks) so the token mapping can be unit-asserted in isolation.
//
// Note the untyped return: react-native-calendars reads the grid override
// through a flat, dotted string key (`theme['stylesheet.calendar.main']`)
// rather than the nested shape its own `Theme` type declares — a known
// mismatch between the library's types and its runtime lookup. Returning a
// plain object (not the library's `Theme`) keeps that extra key from tripping
// an excess-property error at the `theme` prop site.
export const buildCalendarTheme = (theme: AppTheme) => ({
  // Transparent, not an opaque surface: the calendar is presented inside a
  // glass BottomSheet, so it must let the sheet's material show through rather
  // than paint a flat card over it (iOS HIG materials; M1 in the HIG audit).
  calendarBackground: 'transparent',
  monthTextColor: theme.colors.textPrimary,
  dayTextColor: theme.colors.textPrimary,
  textSectionTitleColor: theme.colors.textSecondary,
  todayTextColor: theme.colors.accent,
  arrowColor: theme.colors.accent,
  selectedDayBackgroundColor: theme.colors.accent,
  // The selected/period-filled day sits on the accent fill, so its number
  // needs the always-white `onAccent` token, never `textPrimary`.
  selectedDayTextColor: theme.colors.onAccent,
  // Disabled (out-of-range) days: use the theme's muted-but-legible secondary
  // tone so they read dimmed yet visible, rather than react-native-calendars'
  // own near-invisible default.
  textDisabledColor: theme.colors.textSecondary,
  'stylesheet.calendar.main': {
    monthView: {
      backgroundColor: 'transparent',
      height: CALENDAR_GRID_HEIGHT,
      overflow: 'hidden',
    },
  },
});
