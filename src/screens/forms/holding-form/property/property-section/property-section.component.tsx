import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import Box from '@kiko/design-system/components/box';
import TextField from '@kiko/design-system/components/text-field';
import SelectField from '@kiko/design-system/components/select-field';
import { propertyCategories, type PropertyCategory } from '@kiko/holdings/holding-metadata';

import type { PropertySectionProps } from './property-section.props';

// The `property_item` create-form section: a category select field
// (editable in both create and edit mode; a `ChipRow` read oversized for 6
// long category names, converted to the
// `FieldTrigger`+`BottomSheet`+`SelectableRow` family, same shape as
// `AccountKindField`) and a Cost field (create-only — see
// `PropertySectionProps.showCost`'s own doc comment). One lot + one manual
// price point equal to this cost is what `usePropertyFields` builds from
// it on save; this component only collects and reports the two fields.
const PropertySection: FC<PropertySectionProps> = ({
  category,
  onSelectCategory,
  showCost,
  cost,
  onChangeCost,
  currencySuffix,
  costError,
  costFieldRef,
  costInputRef,
}) => {
  const { t } = useTranslation();

  const categoryLabels: Record<PropertyCategory, string> = {
    real_estate: t('forms.holding.propertyCategory.realEstate'),
    vehicle: t('forms.holding.propertyCategory.vehicle'),
    valuable: t('forms.holding.propertyCategory.valuable'),
    loan_given: t('forms.holding.propertyCategory.loanGiven'),
    business_share: t('forms.holding.propertyCategory.businessShare'),
    other: t('forms.holding.propertyCategory.other'),
  };

  return (
    <Box gap={4}>
      <SelectField
        label={t('forms.holding.category')}
        sheetTitle={t('forms.holding.categorySheetTitle')}
        options={propertyCategories}
        selected={category}
        onSelect={onSelectCategory}
        labels={categoryLabels}
        placeholder={t('forms.holding.categoryPlaceholder')}
        testID="property-category-field"
      />

      {showCost && (
        <View ref={costFieldRef}>
          <TextField
            label={t('forms.holding.propertyCost')}
            value={cost}
            onChangeText={onChangeCost}
            keyboardType="decimal-pad"
            placeholder={t('forms.holding.propertyCostPlaceholder')}
            suffix={currencySuffix}
            required
            error={costError}
            inputRef={costInputRef}
          />
        </View>
      )}
    </Box>
  );
};

export default PropertySection;
