import { formatDate } from '@kiko/dates';
import { type FC, useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import type { DateData } from 'react-native-calendars';
import KikoCalendar from '@kiko/calendar/kiko-calendar';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import FieldTrigger from '@kiko/design-system/components/field-trigger';

import type { DateFieldProps } from './date-field.props';

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// The 'YYYY-MM-DD' key react-native-calendars uses to mark the selected day,
// read off the Date in local time (never via toISOString, which shifts to UTC).
const toCalendarKey = (timestamp: number): string => {
  const date = new Date(timestamp);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

// A single labeled date field that opens a one-day calendar sheet. Displays the
// picked day as DD.MM.YYYY, mirroring the Home date-range field's calendar
// chrome. A day pick keeps the existing value's time-of-day (or local midnight
// when nothing is picked yet), so a paired TimeField can set the time-of-day
// independently without either field clobbering the other.
const DateField: FC<DateFieldProps> = ({
  label,
  sheetTitle,
  value,
  onChange,
  placeholder,
  maxDate,
  disabled = false,
  required,
  error,
  invalid = false,
  testID,
}) => {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const handleDayPress = (day: DateData): void => {
    // Move the DAY only, carrying over the existing value's time-of-day so a
    // paired TimeField pick is not clobbered back to midnight. When nothing is
    // picked yet (value === null) there is no time to preserve, so the fields
    // default to zero and the timestamp lands on local midnight.
    const previous = foldMap(maybe(value), (timestamp) => new Date(timestamp));

    onChange(
      new Date(
        day.year,
        day.month - 1,
        day.day,
        previous?.getHours() ?? 0,
        previous?.getMinutes() ?? 0,
        previous?.getSeconds() ?? 0,
      ).getTime(),
    );
    setOpen(false);
  };

  const markedDates = foldMap(maybe(value), (timestamp) => ({
    [toCalendarKey(timestamp)]: { selected: true, selectedColor: theme.colors.accent },
  }));

  // Open on the field's current value rather than letting react-native-calendars
  // default to the current month — same fix as the Home date-range field's
  // calendar (see date-range-field.component.tsx): reopening on an already-set
  // day showed no marks when that day was outside the current month. With no
  // value yet there is nothing to anchor on, so this falls back to today, matching
  // the range field's own no-active-range fallback (a defined day, not a blank
  // prop left for react-native-calendars to default itself).
  const initialDate = toCalendarKey(value ?? Date.now());

  return (
    <>
      <FieldTrigger
        label={label}
        icon="calendar"
        value={value === null ? placeholder : formatDate(value)}
        valueTone={disabled || value === null ? 'textSecondary' : 'textPrimary'}
        required={required}
        error={error}
        invalid={invalid}
        disabled={disabled}
        testID={testID}
        onPress={() => setOpen(true)}
      />

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={4}
        header={<Text variant="heading">{sheetTitle}</Text>}
      >
        <KikoCalendar
          testID={`${label} calendar`}
          markedDates={markedDates}
          initialDate={initialDate}
          maxDate={foldMap(maybe(maxDate), toCalendarKey)}
          onDayPress={handleDayPress}
        />
      </BottomSheet>
    </>
  );
};

export default DateField;
