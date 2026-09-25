import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  preciousMetals,
  metalForms,
  metalUnits,
  type Metal,
  type MetalForm,
  type MetalUnit,
} from '../../../../../holdings/holding-metadata';
import Box from '../../../../../design-system/components/box';
import ChipRow from '../../../../../design-system/components/chip-row';
import TextField from '../../../../../design-system/components/text-field';

import type { MetalSectionProps } from './metal-section.props';

// The `metal` create-form section: a metal-element ChipRow, a physical
// Form ChipRow, a Unit ChipRow, a Purity field (pre-filled `"0.9999"` — the
// standard bar/coin fineness, validated on Save as 0 < purity <= 1 in both
// create and edit mode), and the first-lot Quantity/Total cost
// fields (create-only — see `MetalSectionProps.showFirstLot`'s own doc
// comment). One lot is what `useMetalFields` builds from those two fields
// on save; this component only collects and reports the fields, mirroring
// PropertySection's shape.
const MetalSection: FC<MetalSectionProps> = ({
  metal,
  onSelectMetal,
  form,
  onSelectForm,
  unit,
  onSelectUnit,
  purity,
  onChangePurity,
  purityError,
  purityFieldRef,
  purityInputRef,
  showFirstLot,
  quantity,
  onChangeQuantity,
  cost,
  onChangeCost,
  currencySuffix,
  quantityError,
  costError,
  quantityFieldRef,
  quantityInputRef,
  costFieldRef,
  costInputRef,
}) => {
  const { t } = useTranslation();

  const metalLabels: Record<Metal, string> = {
    XAU: t('forms.holding.metalKind.gold'),
    XAG: t('forms.holding.metalKind.silver'),
    XPT: t('forms.holding.metalKind.platinum'),
    XPD: t('forms.holding.metalKind.palladium'),
  };

  const formLabels: Record<MetalForm, string> = {
    bar: t('forms.holding.metalFormBar'),
    coin: t('forms.holding.metalFormCoin'),
    bank_account: t('forms.holding.metalFormBankAccount'),
  };

  const unitLabels: Record<MetalUnit, string> = {
    g: t('forms.holding.metalUnitG'),
    oz: t('forms.holding.metalUnitOz'),
  };

  return (
    <Box gap={4}>
      <ChipRow
        label={t('forms.holding.metalKindLabel')}
        options={preciousMetals}
        selected={metal}
        onSelect={onSelectMetal}
        labels={metalLabels}
      />

      <ChipRow
        label={t('forms.holding.metalForm')}
        options={metalForms}
        selected={form}
        onSelect={onSelectForm}
        labels={formLabels}
      />

      <ChipRow
        label={t('forms.holding.metalUnit')}
        options={metalUnits}
        selected={unit}
        onSelect={onSelectUnit}
        labels={unitLabels}
      />

      <View ref={purityFieldRef}>
        <TextField
          label={t('forms.holding.purity')}
          value={purity}
          onChangeText={onChangePurity}
          keyboardType="decimal-pad"
          placeholder={t('forms.holding.purityPlaceholder')}
          required
          error={purityError}
          inputRef={purityInputRef}
        />
      </View>

      {showFirstLot && (
        <>
          <View ref={quantityFieldRef}>
            <TextField
              label={t('forms.holding.quantity')}
              value={quantity}
              onChangeText={onChangeQuantity}
              keyboardType="decimal-pad"
              placeholder={t('forms.holding.quantityPlaceholder')}
              required
              error={quantityError}
              inputRef={quantityInputRef}
            />
          </View>

          <View ref={costFieldRef}>
            <TextField
              label={t('forms.lot.totalCost')}
              value={cost}
              onChangeText={onChangeCost}
              keyboardType="decimal-pad"
              placeholder={t('forms.lot.totalCostPlaceholder')}
              suffix={currencySuffix}
              required
              error={costError}
              inputRef={costInputRef}
            />
          </View>
        </>
      )}
    </Box>
  );
};

export default MetalSection;
