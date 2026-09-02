import type { FC } from 'react';
import { Calendar } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';
import CalendarHeader from './calendar-header.component';
import type { PffCalendarProps } from './pff-calendar.props';

// The shared calendar used by both date sheets (Home's range picker and the
// forms' single-day picker). It centralizes two behaviors:
//   1. Fixed height — `showSixWeeks` with `hideExtraDays` disabled always
//      renders six week-rows, so navigating between a 5-week and a 6-week month
//      never changes the grid's height and the sheet no longer jumps.
//   2. Year jump — a custom header whose double-chevron controls step a full
//      year at a time, alongside the usual single-month arrows.
// It also applies the app's dark calendar theme so callers don't repeat it.
const PffCalendar: FC<PffCalendarProps> = ({
  testID,
  markedDates,
  markingType,
  initialDate,
  minDate,
  maxDate,
  onDayPress,
}) => {
  const { theme } = useUnistyles();

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
      theme={{
        calendarBackground: theme.colors.surfaceHigh,
        monthTextColor: theme.colors.textPrimary,
        dayTextColor: theme.colors.textPrimary,
        textSectionTitleColor: theme.colors.textSecondary,
        todayTextColor: theme.colors.accent,
        arrowColor: theme.colors.accent,
        selectedDayBackgroundColor: theme.colors.accent,
        selectedDayTextColor: theme.colors.textPrimary,
      }}
    />
  );
};

export default PffCalendar;
