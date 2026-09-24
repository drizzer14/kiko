import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import ChipRow from '../../chip-row';
import DateField from '../../date-field';
import TextField from '../../../../design-system/components/text-field';

import type { ManualBondFieldsProps } from './manual-bond-fields.props';

/**
 * The Manual-mode-only bond fields (face value, coupon %, maturity date,
 * bond kind, coupon frequency) — hidden in ISIN mode, where these five are
 * register-sourced instead (spec 6.3). This component owns its OWN
 * `bondMode !== 'manual'` early return, rather than the caller gating
 * `{bondMode === 'manual' && <ManualBondFields .../>}` around it: that
 * conditional would nest inside the bond block's own outer
 * `{type === 'bond' && (...)}` gate in `holding-form.screen.tsx`, and a
 * nested JSX conditional costs more against Biome's
 * `noExcessiveCognitiveComplexity` than the SAME condition evaluated inside
 * a separate component's own budget (T25 review round 1, I4).
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
  bondKindOptions,
  bondKindLabels,
  couponFrequency,
  onSelectCouponFrequency,
  couponFrequencyOptions,
  couponFrequencyLabels,
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
          placeholder={t('forms.holding.selectDatePlaceholder')}
          required
          error={maturityDateError}
        />
      </View>

      <ChipRow
        label={t('forms.holding.bondKind')}
        options={bondKindOptions}
        selected={bondKind}
        onSelect={onSelectBondKind}
        labels={bondKindLabels}
      />

      <ChipRow
        label={t('forms.holding.couponFrequency')}
        options={couponFrequencyOptions}
        selected={couponFrequency}
        onSelect={onSelectCouponFrequency}
        labels={couponFrequencyLabels}
      />
    </>
  );
};

export default ManualBondFields;
