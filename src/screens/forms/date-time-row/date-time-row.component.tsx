import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import DateField from '@kiko/screens/forms/date-field';
import TimeField from '@kiko/screens/forms/time-field';

import { styles } from './date-time-row.styles';
import type { DateTimeRowProps } from './date-time-row.props';

// The Дата + Час pair, rendered SIDE BY SIDE in one row, not stacked
// full-width. Both fields read and
// write the SAME `time`/`onChangeTime`: a date pick preserves the existing
// time-of-day and a time pick preserves the existing day (DateField's and
// TimeField's own onChange contracts), so either field can move
// independently without clobbering the other. Every Дата+Час pair in the app
// (transaction-form's plain income/expense group, ExchangeFields,
// ConvertExchangeFields) renders through this ONE component, so the row
// layout lives in exactly one place.
const DateTimeRow: FC<DateTimeRowProps> = ({
  time,
  onChangeTime,
  maxDate,
  disabled,
  invalid,
  dateTestID,
  timeTestID,
}) => {
  const { t } = useTranslation();

  return (
    <Box direction="row" gap={3}>
      <View style={styles.field}>
        <DateField
          label={t('forms.fields.date')}
          sheetTitle={t('forms.fields.dateSheetTitle')}
          value={time}
          onChange={onChangeTime}
          maxDate={maxDate}
          disabled={disabled}
          invalid={invalid}
          placeholder={t('forms.fields.selectDatePlaceholder')}
          testID={dateTestID}
        />
      </View>

      <View style={styles.field}>
        <TimeField
          label={t('forms.fields.time')}
          sheetTitle={t('forms.fields.timeSheetTitle')}
          value={time}
          onChange={onChangeTime}
          disabled={disabled}
          invalid={invalid}
          placeholder={t('forms.fields.selectTimePlaceholder')}
          testID={timeTestID}
        />
      </View>
    </Box>
  );
};

export default DateTimeRow;
