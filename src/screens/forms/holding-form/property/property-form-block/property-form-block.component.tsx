import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Divider from '@kiko/design-system/components/divider';

import PropertySection from '../property-section';
import { fieldErrorMessage } from '../../field-error-message';
import { groupAmount } from '../../../amount-format/amount-format';

import type { PropertyFormBlockProps } from './property-form-block.props';

// The `type === 'property_item'` details block as its own leaf component,
// keeping its own cognitive-complexity budget separate from the screen's.
// The category select that used to render here moved to the Type slot
// (`PropertyTypeField`, on `HoldingFormScreen`), so the only field left is
// the CREATE-only Cost field — nothing to show in edit mode, so the whole
// block (including its own "Details" heading) renders nothing there.
const PropertyFormBlock: FC<PropertyFormBlockProps> = ({ fields, attemptedSave, isEdit }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  if (isEdit) {
    return null;
  }

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <PropertySection
        cost={fields.cost}
        onChangeCost={(text) => fields.setCost(groupAmount(text))}
        currencySuffix={currencySymbol[fields.currency]}
        costError={fieldErrorMessage(t, attemptedSave, fieldErrors.costError)}
        costFieldRef={refs.costFieldRef}
        costInputRef={refs.costInputRef}
      />
    </Box>
  );
};

export default PropertyFormBlock;
