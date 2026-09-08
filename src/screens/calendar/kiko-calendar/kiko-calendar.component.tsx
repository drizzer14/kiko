import type { FC } from 'react';
import { Calendar } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';

import CalendarHeader from '../calendar-header';

import type { KikoCalendarProps } from './kiko-calendar.props';
import { buildCalendarTheme } from './kiko-calendar.theme';

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

  // The token→library-theme mapping lives in the pure `buildCalendarTheme`
  // builder (kiko-calendar.theme.ts) so it can be unit-asserted without the
  // React tree. It also documents the dotted `stylesheet.calendar.main`
  // override and its untyped return there.
  const calendarTheme = buildCalendarTheme(theme);

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
