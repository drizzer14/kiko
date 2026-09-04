import { type FC, useState } from 'react';
import { Pressable } from 'react-native';
import type { DateData } from 'react-native-calendars';
import { useUnistyles } from 'react-native-unistyles';
import { formatDate } from '../../../dates/format';
import BottomSheet from '../../../design-system/components/bottom-sheet';
import Box from '../../../design-system/components/box';
import SymbolIcon from '../../../design-system/components/symbol';
import Text from '../../../design-system/components/text';
import PffCalendar from '../../calendar';
import type { DateFieldProps } from './date-field.props';
import { styles } from './date-field.styles';

const pad2 = (value: number): string => value.toString().padStart(2, '0');

// The 'YYYY-MM-DD' key react-native-calendars uses to mark the selected day,
// read off the Date in local time (never via toISOString, which shifts to UTC).
const toCalendarKey = (timestamp: number): string => {
  const date = new Date(timestamp);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

// A single labeled date field that opens a one-day calendar sheet. Stores the
// picked day as a local-midnight unix-millis timestamp and displays it as
// DD.MM.YYYY, mirroring the Home date-range field's calendar chrome.
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
    onChange(new Date(day.year, day.month - 1, day.day).getTime());
    setOpen(false);
  };

  const markedDates =
    value === null
      ? undefined
      : { [toCalendarKey(value)]: { selected: true, selectedColor: theme.colors.accent } };

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

        <PffCalendar
          testID={`${label} calendar`}
          markedDates={markedDates}
          onDayPress={handleDayPress}
        />
      </BottomSheet>
    </Box>
  );
};

export default DateField;
