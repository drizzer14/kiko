import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import TextField from '../../../design-system/components/text-field';
import DateField from '../date-field';
import HoldingSelectField from '../holding-select-field';
import TimeField from '../time-field';

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

      <HoldingSelectField
        label={counterpartLabel}
        placeholder={counterpartPlaceholder}
        options={counterpartOptions}
        selectedId={counterpartHoldingId}
        onSelect={onSelectCounterpart}
        required
      />

      <TextField
        label={counterpartAmountLabel}
        value={counterpartAmount}
        onChangeText={onChangeCounterpartAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        suffix={counterpartSuffix}
        required
      />

      <DateField label={t('forms.fields.date')} value={time} onChange={onChangeTime} />

      <TimeField label={t('forms.fields.time')} value={time} onChange={onChangeTime} />
    </>
  );
};

export default ConvertExchangeFields;
