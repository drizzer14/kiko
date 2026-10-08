import type { FC } from 'react';
import { useTranslation } from 'react-i18next';
import Box from '@kiko/design-system/components/box';
import Text from '@kiko/design-system/components/text';
import { currencySymbol } from '@kiko/currency/currency';
import Divider from '@kiko/design-system/components/divider';
import { groupAmount } from '@kiko/screens/forms/amount-format';

import MetalSection from '../metal-section';
import { fieldErrorMessage } from '../../field-error-message';

import type { MetalFormBlockProps } from './metal-form-block.props';

// The `type === 'metal'` details block as its own leaf component, keeping
// its own cognitive-complexity budget separate from the screen's.
const MetalFormBlock: FC<MetalFormBlockProps> = ({ fields, attemptedSave, isEdit }) => {
  const { t } = useTranslation();
  const { fieldErrors, refs } = fields;

  return (
    <Box gap={4}>
      <Divider testID="form-divider" />

      <Text variant="heading">{t('forms.holding.details')}</Text>

      <MetalSection
        form={fields.form}
        onSelectForm={fields.setForm}
        unit={fields.unit}
        onSelectUnit={fields.setUnit}
        purity={fields.purity}
        onChangePurity={fields.setPurity}
        purityError={fieldErrorMessage(t, attemptedSave, fieldErrors.purityError)}
        purityFieldRef={refs.purityFieldRef}
        purityInputRef={refs.purityInputRef}
        showFirstLot={!isEdit}
        quantity={fields.quantity}
        onChangeQuantity={(text) => fields.setQuantity(groupAmount(text))}
        cost={fields.cost}
        onChangeCost={(text) => fields.setCost(groupAmount(text))}
        currencySuffix={currencySymbol.UAH}
        quantityError={fieldErrorMessage(t, attemptedSave, fieldErrors.quantityError)}
        costError={fieldErrorMessage(t, attemptedSave, fieldErrors.costError)}
        quantityFieldRef={refs.quantityFieldRef}
        quantityInputRef={refs.quantityInputRef}
        costFieldRef={refs.costFieldRef}
        costInputRef={refs.costInputRef}
      />
    </Box>
  );
};

export default MetalFormBlock;
