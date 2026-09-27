import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import type { HoldingType } from '@kiko/holdings/holding-type';
import { holdingTypeSymbol } from '@kiko/holdings/entity-symbols';
import SelectField from '@kiko/design-system/components/select-field';
import { isMetal, type Metal, preciousMetals } from '@kiko/holdings/holding-metadata';

import type { MetalTypeFieldProps } from './metal-type-field.props';

type MetalTypeOption = HoldingType | Metal;

// The Type slot wherever a `metal` holding can be created or edited: each
// metal is its own row, so the user picks "Silver" directly instead of a
// generic "Metal" type followed by a separate metal picker. Reuses the SAME
// "Type" label/sheet-title/placeholder keys as `HoldingTypeField` and
// `PropertyTypeField`, and stays editable in edit mode (the metal is a
// metadata patch, not a type change).
const MetalTypeField: FC<MetalTypeFieldProps> = ({
  otherTypes,
  typeLabels,
  type,
  metal,
  onSelectType,
  onSelectMetal,
  testID,
}) => {
  const { t } = useTranslation();

  const labels: Record<MetalTypeOption, string> = {
    ...typeLabels,
    XAU: t('forms.holding.metalKind.gold'),
    XAG: t('forms.holding.metalKind.silver'),
    XPT: t('forms.holding.metalKind.platinum'),
    XPD: t('forms.holding.metalKind.palladium'),
  };

  const icons: Record<MetalTypeOption, string> = {
    ...holdingTypeSymbol,
    XAU: holdingTypeSymbol.metal,
    XAG: holdingTypeSymbol.metal,
    XPT: holdingTypeSymbol.metal,
    XPD: holdingTypeSymbol.metal,
  };

  const handleSelect = (option: MetalTypeOption): void => {
    if (isMetal(option)) {
      onSelectType('metal');
      onSelectMetal(option);

      return;
    }

    onSelectType(option);
  };

  return (
    <SelectField
      label={t('forms.holding.type')}
      sheetTitle={t('forms.holding.typeSheetTitle')}
      options={[...otherTypes, ...preciousMetals]}
      selected={type === 'metal' ? metal : type}
      onSelect={handleSelect}
      labels={labels}
      icons={icons}
      placeholder={t('forms.holding.typePlaceholder')}
      testID={testID}
    />
  );
};

export default MetalTypeField;
