import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import { deviceRegion } from '@kiko/i18n/device-region';
import { weekStartFor } from '@kiko/calendar/week-start';
import ChipRow from '@kiko/design-system/components/chip-row';
import FieldError from '@kiko/design-system/components/field-error';
import FieldLabel from '@kiko/design-system/components/field-label';
import { type Weekday, weekdayName, weekdaysInOrder } from '@kiko/reminders/schedule';

import type { WeekdayFieldProps } from './weekday-field.props';

const toggled = (selected: readonly Weekday[], weekday: Weekday): Weekday[] =>
  selected.includes(weekday)
    ? selected.filter((candidate) => candidate !== weekday)
    : [...selected, weekday];

// The days run in the region's week order, like the calendar, so the chips
// line up with the week the user knows.
const WeekdayField: FC<WeekdayFieldProps> = ({ label, selected, onChange, error, fieldRef }) => {
  const { t } = useTranslation();
  const weekdays = weekdaysInOrder(weekStartFor(deviceRegion()));
  const labels = Object.fromEntries(weekdays.map((weekday) => [weekday, weekdayName(weekday, t)]));

  return (
    <View ref={fieldRef}>
      <Box gap={1}>
        <FieldLabel label={label} required invalid={error !== undefined} />

        <ChipRow
          options={weekdays}
          labels={labels}
          selectedValues={selected}
          onToggle={(weekday) => onChange(toggled(selected, weekday))}
        />

        {error !== undefined && <FieldError message={error} />}
      </Box>
    </View>
  );
};

export default WeekdayField;
