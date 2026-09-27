import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import SelectField from '@kiko/design-system/components/select-field';
import { propertyCategorySymbol } from '@kiko/holdings/entity-symbols';
import type { PropertyCategory } from '@kiko/holdings/holding-metadata';

import type { PropertyTypeFieldProps } from './property-type-field.props';

// The DISPLAY order the brief asked for — distinct from `propertyCategories`'
// own declaration order in `holding-metadata.ts` (which stays whatever order
// the metadata parser and its tests were already written against).
const propertyTypeOptions: readonly PropertyCategory[] = [
  'real_estate',
  'vehicle',
  'valuable',
  'business_share',
  'loan_given',
  'other',
];

// A `property` account's Type field IS its category picker: `property_item`
// is that account kind's only holding type (`holdingTypesForAccountKind`), so
// a generic Type sheet would offer nothing but one fixed option — the
// category itself takes the Type slot instead of sitting in its own separate
// field. Reuses the SAME "Type" label/sheet-title/placeholder catalog keys
// the generic `HoldingTypeField` uses, so a property account's form still
// reads "Type" like every other account kind's holding form; never disabled
// (unlike the generic field in edit mode) — the category stays user-editable
// in both create and edit mode, mirroring the field it replaces.
const PropertyTypeField: FC<PropertyTypeFieldProps> = ({ selected, onSelect, testID }) => {
  const { t } = useTranslation();

  const labels: Record<PropertyCategory, string> = {
    real_estate: t('forms.holding.propertyCategory.realEstate'),
    vehicle: t('forms.holding.propertyCategory.vehicle'),
    valuable: t('forms.holding.propertyCategory.valuable'),
    business_share: t('forms.holding.propertyCategory.businessShare'),
    loan_given: t('forms.holding.propertyCategory.loanGiven'),
    other: t('forms.holding.propertyCategory.other'),
  };

  return (
    <SelectField
      label={t('forms.holding.type')}
      sheetTitle={t('forms.holding.typeSheetTitle')}
      options={propertyTypeOptions}
      selected={selected}
      onSelect={onSelect}
      labels={labels}
      icons={propertyCategorySymbol}
      placeholder={t('forms.holding.typePlaceholder')}
      testID={testID}
    />
  );
};

export default PropertyTypeField;
