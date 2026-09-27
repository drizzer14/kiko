import type { FC } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import TextField from '@kiko/design-system/components/text-field';

import type { PropertySectionProps } from './property-section.props';

// The `property_item` create-only Cost field — the category select that
// used to sit alongside it moved to the Type slot on the main HoldingForm
// screen (`PropertyTypeField`): a `property` account's only holding type IS
// its category, so the two collapsed into one field. `PropertyFormBlock`
// only mounts this section at all in create mode (cost/quantity history is
// fixed at creation; a later revaluation goes through the dedicated "Update
// value" form instead), so this component itself never needs its own
// visibility gate.
const PropertySection: FC<PropertySectionProps> = ({
  cost,
  onChangeCost,
  currencySuffix,
  costError,
  costFieldRef,
  costInputRef,
}) => {
  const { t } = useTranslation();

  return (
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
  );
};

export default PropertySection;
