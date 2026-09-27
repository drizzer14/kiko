import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import DateField from '@kiko/screens/forms/date-field';
import ChipRow from '@kiko/design-system/components/chip-row';
import TextField from '@kiko/design-system/components/text-field';
import SelectField from '@kiko/design-system/components/select-field';
import { bondKinds, bondCouponFrequencies } from '@kiko/holdings/holding-metadata';

import { couponFrequencyLabels } from '../bond-isin-section';

import type { ManualBondFieldsProps } from './manual-bond-fields.props';

const bondKindLabels = (t: TFunction) => ({
  government: t('forms.holding.government'),
  corporate: t('forms.holding.corporate'),
});

/**
 * The Manual-mode-only bond fields (face value, coupon %, maturity date,
 * bond kind, coupon frequency) — hidden in ISIN mode, where these five are
 * register-sourced instead. Renders nothing outside Manual mode.
 */
const ManualBondFields: FC<ManualBondFieldsProps> = ({
  bondMode,
  faceValue,
  onChangeFaceValue,
  faceValueError,
  faceValueFieldRef,
  faceValueInputRef,
  couponPct,
  onChangeCouponPct,
  couponPctError,
  couponPctFieldRef,
  couponPctInputRef,
  maturityDate,
  onChangeMaturityDate,
  maturityDateError,
  maturityDateFieldRef,
  bondKind,
  onSelectBondKind,
  couponFrequency,
  onSelectCouponFrequency,
  currencySuffix,
}) => {
  const { t } = useTranslation();

  if (bondMode !== 'manual') {
    return null;
  }

  return (
    <>
      <View ref={faceValueFieldRef}>
        <TextField
          label={t('forms.holding.faceValue')}
          value={faceValue}
          onChangeText={onChangeFaceValue}
          keyboardType="decimal-pad"
          placeholder={t('forms.holding.faceValuePlaceholder')}
          suffix={currencySuffix}
          required
          error={faceValueError}
          inputRef={faceValueInputRef}
        />
      </View>

      <View ref={couponPctFieldRef}>
        <TextField
          label={t('forms.holding.couponPct')}
          value={couponPct}
          onChangeText={onChangeCouponPct}
          keyboardType="decimal-pad"
          placeholder={t('forms.holding.couponPlaceholder')}
          suffix={t('forms.units.percent')}
          required
          error={couponPctError}
          inputRef={couponPctInputRef}
        />
      </View>

      <View ref={maturityDateFieldRef} testID="maturity-date-field">
        <DateField
          label={t('forms.holding.maturityDate')}
          sheetTitle={t('forms.holding.maturityDateSheetTitle')}
          value={maturityDate}
          onChange={onChangeMaturityDate}
          placeholder={t('forms.fields.selectDatePlaceholder')}
          required
          error={maturityDateError}
        />
      </View>

      <ChipRow
        label={t('forms.holding.bondKind')}
        options={bondKinds}
        selected={bondKind}
        onSelect={onSelectBondKind}
        labels={bondKindLabels(t)}
      />

      {/* One shared SelectField for coupon frequency everywhere it appears
          — Manual mode and the ISIN mode's unmapped-frequency picker
          (BondIsinSection) reuse the exact same control, `required` included
          on both. */}
      <SelectField
        label={t('forms.holding.couponFrequency')}
        sheetTitle={t('forms.holding.couponFrequencySheetTitle')}
        options={bondCouponFrequencies}
        selected={couponFrequency}
        onSelect={onSelectCouponFrequency}
        labels={couponFrequencyLabels(t)}
        placeholder={t('forms.holding.couponFrequencyPlaceholder')}
        required
        testID="manual-bond-coupon-frequency-field"
      />
    </>
  );
};

export default ManualBondFields;
