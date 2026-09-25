import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

import PropertySection from '../property-section';
import Box from '../../../../../design-system/components/box';
import { fieldErrorMessage } from '../../field-error-message';
import Text from '../../../../../design-system/components/text';
import { currencySymbol } from '../../../../../currency/currency';
import { groupAmount } from '../../../amount-format/amount-format';
import Divider from '../../../../../design-system/components/divider';

import type { PropertyFormBlockProps } from './property-form-block.props';

// The `type === 'property_item'` details block as its own leaf component,
// mirroring `BondFormBlock`'s own extraction — kept out of the
// already-at-the-ceiling screen's own cognitive-complexity budget. The
// screen itself still gates this on `type === 'property_item'`, so this
// component always renders once mounted.
const PropertyFormBlock: FC<PropertyFormBlockProps> = ({ fields, attemptedSave, isEdit }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <PropertySection
        category={fields.category}
        onSelectCategory={fields.setCategory}
        showCost={!isEdit}
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
