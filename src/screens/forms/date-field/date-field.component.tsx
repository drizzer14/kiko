import { Pressable } from 'react-native';
import { formatDate } from '@kiko/dates';
import { type FC, useState } from 'react';
import maybe, { foldMap } from 'fnts/maybe';
import Box from '@kiko/design-system/components/box';
import { useUnistyles } from 'react-native-unistyles';
import Text from '@kiko/design-system/components/text';
import type { DateData } from 'react-native-calendars';
import KikoCalendar from '@kiko/calendar/kiko-calendar';
import SymbolIcon from '@kiko/design-system/components/symbol';
import FieldError from '@kiko/design-system/components/field-error';
import FieldLabel from '@kiko/design-system/components/field-label';
import BottomSheet from '@kiko/design-system/components/bottom-sheet';
import { deriveFieldTestID } from '@kiko/design-system/derive-field-test-id';

import { styles } from './date-field.styles';
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
  // A defined, non-empty `error` IS the invalid signal — same contract as
  // TextField's own `hasError` (see text-field.component.tsx).
  const hasError = error !== undefined && error !== '';

  const handleDayPress = (day: DateData): void => {
    // Move the DAY only, carrying over the existing value's time-of-day so a
    // paired TimeField pick is not clobbered back to midnight. When nothing is
    // picked yet (value === null) there is no time to preserve, so the fields
    // default to zero and the timestamp lands on local midnight as before.
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
    <Box gap={1}>
      <FieldLabel label={label} required={required} invalid={hasError || invalid} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        testID={testID}
      >
        <Box direction="row" gap={2} style={[styles.field, disabled && styles.fieldDisabled]}>
          <SymbolIcon name="calendar" size={theme.iconSizes.body} tone="textSecondary" />

          <Text variant="body" tone={disabled || value === null ? 'textSecondary' : 'textPrimary'}>
            {value === null ? placeholder : formatDate(value)}
          </Text>
        </Box>
      </Pressable>

      {/* REFLOW, not reserve (the reflow error model; see `FieldError`): no
        error node while valid — uniform
        with every other field type, fixing the DATE field's own
        inconsistency (it used to show a message with no outline while
        TextField showed an outline; now neither shows an outline). */}
      {hasError && <FieldError message={error} testID={deriveFieldTestID(testID, 'error')} />}

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
    </Box>
  );
};

export default DateField;
