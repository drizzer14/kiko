import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import DateTimeRow from '@kiko/screens/forms/date-time-row';
import TextField from '@kiko/design-system/components/text-field';
import FieldError from '@kiko/design-system/components/field-error';
import HoldingSelectField from '@kiko/screens/forms/holding-select-field';

import type { ConvertExchangeFieldsProps } from './convert-exchange-fields.props';

// Convert-mode's single-counterpart field group (spec "Convert an existing
// transaction"): the existing leg is shown as a read-only fixed field (never
// re-written), followed by the ONE leg the user records — a holding picker, an
// amount field, and the shared Date and Time fields. Direction-dependent labels
// ('Value Out'/'To'/'Value In' for an expense-sourced convert, or
// 'Value In'/'From'/'Value Out' for an income-sourced convert) are supplied by
// the screen so this component stays direction-agnostic. Its own file/folder per
// kiko-code-style (one component per file), which also keeps the screen's JSX a
// single conditional branch.
const ConvertExchangeFields: FC<ConvertExchangeFieldsProps> = ({
  fixedLabel,
  fixedValue,
  fixedSuffix,
  counterpartLabel,
  counterpartSheetTitle,
  counterpartPlaceholder,
  counterpartOptions,
  counterpartHoldingId,
  onSelectCounterpart,
  counterpartAmountLabel,
  counterpartAmount,
  onChangeCounterpartAmount,
  counterpartSuffix,
  time,
  onChangeTime,
  counterpartError,
  counterpartAmountError,
  counterpartFieldRef,
  counterpartAmountFieldRef,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <TextField
        label={fixedLabel}
        value={fixedValue}
        onChangeText={() => undefined}
        editable={false}
        keyboardType="decimal-pad"
        suffix={fixedSuffix}
      />

      <View ref={counterpartFieldRef}>
        <Box gap={1}>
          <HoldingSelectField
            label={counterpartLabel}
            sheetTitle={counterpartSheetTitle}
            placeholder={counterpartPlaceholder}
            options={counterpartOptions}
            selectedId={counterpartHoldingId}
            onSelect={onSelectCounterpart}
            required
          />

          {counterpartError !== undefined && <FieldError message={counterpartError} />}
        </Box>
      </View>

      <View ref={counterpartAmountFieldRef}>
        <TextField
          label={counterpartAmountLabel}
          value={counterpartAmount}
          onChangeText={onChangeCounterpartAmount}
          keyboardType="decimal-pad"
          placeholder={t('forms.transaction.convertAmountPlaceholder')}
          suffix={counterpartSuffix}
          error={counterpartAmountError}
          required
        />
      </View>

      <DateTimeRow time={time} onChangeTime={onChangeTime} />
    </>
  );
};

export default ConvertExchangeFields;
