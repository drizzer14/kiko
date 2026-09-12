import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { type FC, useState } from 'react';
import { Pressable } from 'react-native';

import { formatTime } from '../../../dates/format';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';

import type { TimeFieldProps } from './time-field.props';
import { styles } from './time-field.styles';

// Combine the DAY (year/month/date) of the current value with the picked
// time-of-day (hours/minutes) into a new unix-millis timestamp. Seconds and
// milliseconds reset to zero — the picker only offers minute granularity — and
// the day is taken from `value`, never from the picked Date, so choosing a time
// never moves the transaction to a different day.
const combineDayAndTime = (dayMillis: number, picked: Date): number => {
  const day = new Date(dayMillis);

  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    picked.getHours(),
    picked.getMinutes(),
  ).getTime();
};

// A single labeled time-of-day field that opens the native time picker in a
// bottom sheet. Displays the current value's time as HH:mm (24-hour) and, on a
// pick, keeps the value's DAY while replacing only its time-of-day — the mirror
// of DateField, which keeps the time-of-day while replacing only the day.
const TimeField: FC<TimeFieldProps> = ({
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  testID,
  backdropTestID,
}) => {
  const [open, setOpen] = useState(false);

  const handleChange = (_event: DateTimePickerEvent, picked?: Date): void => {
    if (picked === undefined || value === null) {
      return;
    }

    onChange(combineDayAndTime(value, picked));
  };

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
        testID={testID}
      >
        <Box direction="row" gap={2} style={[styles.field, disabled && styles.fieldDisabled]}>
          <SymbolIcon name="clock" size={18} tone="textSecondary" />

          <Text variant="body" tone={disabled || value === null ? 'textSecondary' : 'textPrimary'}>
            {value === null ? (placeholder ?? label) : formatTime(value)}
          </Text>
        </Box>
      </Pressable>

      <BottomSheet
        visible={open}
        onDismiss={() => setOpen(false)}
        gap={4}
        backdropTestID={backdropTestID}
      >
        <Text variant="heading">{label}</Text>

        <DateTimePicker
          testID={`${label} picker`}
          value={value === null ? new Date() : new Date(value)}
          mode="time"
          display="spinner"
          onChange={handleChange}
        />
      </BottomSheet>
    </Box>
  );
};

export default TimeField;
