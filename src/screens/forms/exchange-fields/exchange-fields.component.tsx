import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import FieldError from '../../../design-system/components/field-error';
import TextField from '../../../design-system/components/text-field';
import DateField from '../date-field';
import HoldingSelectField from '../holding-select-field';
import TimeField from '../time-field';

import type { ExchangeFieldsProps } from './exchange-fields.props';

// The Exchange-mode field group: an outgoing amount from the source holding,
// the destination picker, an incoming amount into it, and the shared Date and
// Time fields. Exchange has no category — both legs' descriptions are fixed,
// auto-generated copy — so this group renders no CategoryField. CREATE-ONLY
// (see the screen's `resolveModeOptions`): never reached in edit mode or on a
// read-only (synced) row, so none of its fields take a `disabled`/`editable`
// prop. Split into its own file/folder (kiko-code-style: one component per
// file) so the screen's own JSX branches on a single `isExchange &&`
// conditional instead of one per field, which is also its
// cognitive-complexity relief valve.
const ExchangeFields: FC<ExchangeFieldsProps> = ({
  valueOut,
  onChangeValueOut,
  valueOutSuffix,
  destinationOptions,
  destinationHoldingId,
  onSelectDestination,
  valueIn,
  onChangeValueIn,
  valueInSuffix,
  time,
  onChangeTime,
  valueOutError,
  destinationError,
  valueInError,
  valueOutFieldRef,
  destinationFieldRef,
  valueInFieldRef,
}) => {
  const { t } = useTranslation();

  return (
    <>
      <View ref={valueOutFieldRef}>
        <TextField
          label={t('forms.transaction.valueOut')}
          value={valueOut}
          onChangeText={onChangeValueOut}
          keyboardType="decimal-pad"
          placeholder={t('forms.transaction.valueOutPlaceholder')}
          suffix={valueOutSuffix}
          error={valueOutError}
          required
        />
      </View>

      <View ref={destinationFieldRef}>
        <HoldingSelectField
          label={t('forms.transaction.to')}
          placeholder={t('forms.transaction.selectHolding')}
          options={destinationOptions}
          selectedId={destinationHoldingId}
          onSelect={onSelectDestination}
          required
        />

        {destinationError !== undefined && <FieldError message={destinationError} />}
      </View>

      <View ref={valueInFieldRef}>
        <TextField
          label={t('forms.transaction.valueIn')}
          value={valueIn}
          onChangeText={onChangeValueIn}
          keyboardType="decimal-pad"
          placeholder={t('forms.transaction.valueInPlaceholder')}
          suffix={valueInSuffix}
          error={valueInError}
          required
        />
      </View>

      <DateField label={t('forms.fields.date')} value={time} onChange={onChangeTime} />

      <TimeField label={t('forms.fields.time')} value={time} onChange={onChangeTime} />
    </>
  );
};

export default ExchangeFields;
