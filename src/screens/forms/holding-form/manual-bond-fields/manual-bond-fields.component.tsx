import type { FC } from 'react';
import { View } from 'react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import ChipRow from '../../chip-row';
import DateField from '../../date-field';
import { couponFrequencyLabels } from '../bond-isin-section';
import TextField from '../../../../design-system/components/text-field';
import { bondKinds, bondCouponFrequencies } from '../../../../holdings/holding-metadata';

import type { ManualBondFieldsProps } from './manual-bond-fields.props';

const bondKindLabels = (t: TFunction) => ({
  government: t('forms.holding.government'),
  corporate: t('forms.holding.corporate'),
});

/**
 * The Manual-mode-only bond fields (face value, coupon %, maturity date,
 * bond kind, coupon frequency) — hidden in ISIN mode, where these five are
 * register-sourced instead (spec 6.3). Renders nothing outside Manual mode.
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
          required
          error={couponPctError}
          inputRef={couponPctInputRef}
        />
      </View>

      <View ref={maturityDateFieldRef} testID="maturity-date-field">
        <DateField
          label={t('forms.holding.maturityDate')}
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

      <ChipRow
        label={t('forms.holding.couponFrequency')}
        options={bondCouponFrequencies}
        selected={couponFrequency}
        onSelect={onSelectCouponFrequency}
        labels={couponFrequencyLabels(t)}
      />
    </>
  );
};

export default ManualBondFields;
