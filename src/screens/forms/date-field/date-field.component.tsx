import { type FC, useState } from 'react';
import { Pressable } from 'react-native';
import type { DateData } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';

import { formatDate } from '../../../dates/format';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import KikoCalendar from '../../calendar';

import type { DateFieldProps } from './date-field.props';
import { styles } from './date-field.styles';

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
  value,
  onChange,
  placeholder,
  disabled = false,
}) => {
  const { theme } = useUnistyles();
  const [open, setOpen] = useState(false);

  const handleDayPress = (day: DateData): void => {
    // Move the DAY only, carrying over the existing value's time-of-day so a
    // paired TimeField pick is not clobbered back to midnight. When nothing is
    // picked yet (value === null) there is no time to preserve, so the fields
    // default to zero and the timestamp lands on local midnight as before.
    const previous = value === null ? null : new Date(value);

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

  const markedDates =
    value === null
      ? undefined
      : { [toCalendarKey(value)]: { selected: true, selectedColor: theme.colors.accent } };

  // Open on the field's current value rather than letting react-native-calendars
  // default to the current month — same fix as the Home date-range field's
  // calendar (see date-range-field.component.tsx): reopening on an already-set
  // day showed no marks when that day was outside the current month. With no
  // value yet there is nothing to anchor on, so this falls back to today, matching
  // the range field's own no-active-range fallback (a defined day, not a blank
  // prop left for react-native-calendars to default itself).
  const initialDate = toCalendarKey(value ?? Date.now());

  return (
    <Box gap={1}>
      <Text variant="caption" tone="textSecondary">
        {label}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
      >
        <Box direction="row" gap={2} style={[styles.field, disabled && styles.fieldDisabled]}>
          <SymbolIcon name="calendar" size={18} tone="textSecondary" />

          <Text variant="body" tone={value === null ? 'textSecondary' : 'textPrimary'}>
            {value === null ? (placeholder ?? label) : formatDate(value)}
          </Text>
        </Box>
      </Pressable>

      <BottomSheet visible={open} onDismiss={() => setOpen(false)} gap={4}>
        <Text variant="heading">{label}</Text>

        <KikoCalendar
          testID={`${label} calendar`}
          markedDates={markedDates}
          initialDate={initialDate}
          onDayPress={handleDayPress}
        />
      </BottomSheet>
    </Box>
  );
};

export default DateField;
